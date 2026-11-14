import * as vscode from 'vscode';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { initProject, findContractFiles } from './contractUtils';
import { collectFilesForContracts } from './dependencyUtils';

let autoMode = false;

interface JobAccepted {
  id: string;
  status: string;
  files: number;
}

interface GeneratedFile {
  path: string;
  content: string;
}

interface JobStatus {
  id: string;
  status: string;
  files?: GeneratedFile[];
  error?: string;
}

interface WrittenFile {
  path: string;
  tests: number;
}

interface SkippedFile {
  path: string;
  reason: string;
}

const POLL_INTERVAL = 1000;
const JOB_TIMEOUT = 5 * 60 * 1000;

function serverUrl(): string {
  return (process.env.SERVER_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
}

async function sendToServer(
  files: { [path: string]: string },
  contracts: string[],
  prompt: string
): Promise<JobAccepted> {
  const res = await fetch(`${serverUrl()}/api/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, contracts, prompt })
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<JobAccepted>;
}

async function getJob(id: string): Promise<JobStatus> {
  const res = await fetch(`${serverUrl()}/api/v1/jobs/${encodeURIComponent(id)}`);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<JobStatus>;
}

async function waitForJob(id: string): Promise<JobStatus> {
  const started = Date.now();

  for (;;) {
    const job = await getJob(id);
    if (job.status === 'done' || job.status === 'failed') {
      return job;
    }
    if (Date.now() - started > JOB_TIMEOUT) {
      throw new Error('сервер не ответил за 5 минут');
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

function safePath(root: vscode.Uri, relative: string): vscode.Uri | undefined {
  const rel = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = rel.split('/');

  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    return undefined;
  }

  const target = vscode.Uri.joinPath(root, ...parts);
  const rootPath = path.resolve(root.fsPath);
  const targetPath = path.resolve(target.fsPath);

  if (targetPath !== rootPath && !targetPath.startsWith(rootPath + path.sep)) {
    return undefined;
  }

  return target;
}

function isContractFile(relative: string, contracts: string[], root: vscode.Uri): boolean {
  const rel = relative.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (rel === 'contracts' || rel.startsWith('contracts/')) {
    return true;
  }

  const target = path.resolve(root.fsPath, relative);
  return contracts.some(contract => path.resolve(contract) === target);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.File;
  } catch {
    return false;
  }
}

function countTests(content: string): number {
  return (content.match(/\b(?:it|test|specify)\s*\(/g) ?? []).length;
}

async function saveFiles(
  job: JobStatus,
  contracts: string[]
): Promise<{ written: WrittenFile[]; skipped: SkippedFile[] }> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    throw new Error('папка проекта не найдена');
  }

  const written: WrittenFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const file of job.files ?? []) {
    if (isContractFile(file.path, contracts, root)) {
      skipped.push({ path: file.path, reason: 'контракт' });
      continue;
    }

    const uri = safePath(root, file.path);
    if (!uri) {
      skipped.push({ path: file.path, reason: 'небезопасный путь' });
      continue;
    }

    if (await exists(uri)) {
      skipped.push({ path: file.path, reason: 'уже есть' });
      continue;
    }

    const dir = vscode.Uri.file(path.dirname(uri.fsPath));
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, 'utf8'));

    written.push({ path: file.path, tests: countTests(file.content) });
  }

  return { written, skipped };
}

function postReport(panel: vscode.WebviewPanel, files: WrittenFile[], skipped: SkippedFile[]) {
  panel.webview.postMessage({
    command: 'reportReady',
    data: {
      files,
      skipped,
      totalFiles: files.length,
      totalTests: files.reduce((sum, file) => sum + file.tests, 0)
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  dotenv.config({ path: vscode.Uri.joinPath(context.extensionUri, '.env').fsPath });

  const createDashboard = async () => {
    const panel = vscode.window.createWebviewPanel(
      'atestDashboard',
      'ATest Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.html');
    const htmlContent = (await vscode.workspace.fs.readFile(htmlPath)).toString();
    panel.webview.html = htmlContent;

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'tgleAutoMode') {
        autoMode = !autoMode;
        vscode.window.showInformationMessage('Авторежим: ' + autoMode);
        return;
      }

      if (msg.command === 'openFile' && typeof msg.path === 'string') {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        const uri = root ? safePath(root, msg.path) : undefined;
        if (uri) {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
        }
        return;
      }

      if (msg.command !== 'getAllFiles') {
        return;
      }

      try {
        const files = await collectFilesForContracts();
        const contracts = (await findContractFiles()).map(uri => uri.fsPath);
        const prompt = process.env.PROMPT ?? '';

        panel.webview.postMessage({ command: 'filesReady', data: files });
        if (Object.keys(files).length === 0) {
          return;
        }

        const accepted = await sendToServer(files, contracts, prompt);
        panel.webview.postMessage({ command: 'jobQueued', data: accepted });

        const job = await waitForJob(accepted.id);
        if (job.status === 'failed') {
          throw new Error(job.error || 'сервер вернул ошибку без описания');
        }

        const { written, skipped } = await saveFiles(job, contracts);
        if (written.length === 0 && skipped.length === 0) {
          throw new Error('модель не вернула ни одного файла');
        }

        postReport(panel, written, skipped);
        if (written.length > 0) {
          vscode.window.showInformationMessage(
            `Готово: файлов ${written.length}, тестов ${written.reduce((sum, f) => sum + f.tests, 0)}`
          );
        } else {
          vscode.window.showInformationMessage('Новых тестов нет — файлы уже существуют');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        panel.webview.postMessage({ command: 'error', message });
        vscode.window.showErrorMessage(`ATest: ${message}`);
      }
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('atest.openDashboard', () => {
      createDashboard();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('atest.Init', () => {
     initProject(context);
     vscode.window.showInformationMessage('Иницилизация прошла успешно');
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('atest.generateTests', () => {
      createDashboard();
    })
  );
}

export function deactivate() {}
