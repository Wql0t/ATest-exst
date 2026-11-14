import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import { initProject, findContractFiles, getContractMethods } from './contractUtils';
import { collectFilesForContracts, detectLanguage } from './dependencyUtils';
import { Language, LANGUAGE_NAMES, languageOf, runTest } from './languages';

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

interface TestCase {
  name: string;
  status: 'passed' | 'failed';
  message?: string;
}

interface WrittenFile {
  path: string;
  tests: number;
  passed: number;
  failed: number;
  error?: string;
  cases?: TestCase[];
  updatedAt?: number;
}

interface SkippedFile {
  path: string;
  reason: string;
}

const POLL_INTERVAL = 1000;
const JOB_TIMEOUT = 5 * 60 * 1000;
const HISTORY_KEY = 'atest.history';

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

// В C++ тест и реализация компилируются как один файл через #include.
// Если в реализации есть main(), получаем "redefinition of main" — переименовываем
// точку входа реализации на время include.
function namePattern(name: string): RegExp {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

// Проверяет, что тест действительно подключил реализацию и вызвал хотя бы один
// метод из контрактов, а не сгенерировал изолированную заглушку.
function referencesImplementation(
  content: string,
  files: { [path: string]: string },
  contracts: string[],
  methods: Set<string>
): boolean {
  const contractSet = new Set(contracts.map(file => path.normalize(path.resolve(file))));
  const implementationNames = Object.keys(files)
    .filter(file => !contractSet.has(path.normalize(path.resolve(file))))
    .map(file => path.basename(file, path.extname(file)))
    .filter(name => name && name !== 'index' && name !== '__init__');

  const hasImplementation = implementationNames.some(name => namePattern(name).test(content));
  const hasMethod = [...methods].some(name => namePattern(name).test(content));

  return hasImplementation && hasMethod;
}

function guardCppMain(content: string, testPath: string): string {
  if (!/\.(?:cpp|cc|cxx)$/i.test(testPath) || /#define\s+main\b/.test(content)) {
    return content;
  }

  return content.replace(
    /^([ \t]*#include\s+"([^"]+)"[^\n]*)$/gm,
    (line: string, _full: string, target: string) => {
      if (!/\.(?:cpp|cc|cxx)$/i.test(target)) {
        return line;
      }

      try {
        const source = fs.readFileSync(path.resolve(path.dirname(testPath), target), 'utf8');
        if (!/\b(?:int|void)\s+main\s*\(/.test(source)) {
          return line;
        }
      } catch {
        return line;
      }

      return `#define main atest_impl_main\n${line}\n#undef main`;
    }
  );
}

async function saveFiles(
  job: JobStatus,
  contracts: string[],
  language: Language,
  files: { [path: string]: string },
  methods: Set<string>
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

    const fileLanguage = languageOf(file.path);
    if (fileLanguage !== language) {
      skipped.push({
        path: file.path,
        reason: fileLanguage
          ? `другой язык: ${LANGUAGE_NAMES[fileLanguage]}, ожидался ${LANGUAGE_NAMES[language]}`
          : 'неизвестный язык'
      });
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

    if (!referencesImplementation(file.content, files, contracts, methods)) {
      skipped.push({ path: file.path, reason: 'тест не ссылается на реализацию' });
      continue;
    }

    const dir = vscode.Uri.file(path.dirname(uri.fsPath));
    const content = guardCppMain(file.content, uri.fsPath);
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));

    written.push({ path: file.path, tests: countTests(content), passed: 0, failed: 0, cases: [] });
  }

  return { written, skipped };
}

function vitestBin(root: string): string {
  return path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');
}

function exec(cmd: string, args: string[], cwd: string): Promise<number | undefined> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd });
    child.on('error', () => resolve(undefined));
    child.on('close', code => resolve(code ?? undefined));
  });
}

async function ensureVitest(root: string): Promise<boolean> {
  if (fs.existsSync(vitestBin(root))) {
    return true;
  }

  const choice = await vscode.window.showInformationMessage(
    'В проекте не найден vitest. Установить его, чтобы прогнать сгенерированные тесты?',
    'Установить',
    'Отмена'
  );
  if (choice !== 'Установить') {
    return false;
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'ATest: установка vitest' },
    async () => {
      if (!fs.existsSync(path.join(root, 'package.json'))) {
        await exec(npm, ['init', '-y'], root);
      }
      await exec(npm, ['install', '-D', '--no-audit', '--no-fund', 'vitest'], root);
      return fs.existsSync(vitestBin(root));
    }
  );
}

async function runVitest(root: string, files: WrittenFile[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const reportPath = path.join(os.tmpdir(), `atest-${Date.now()}.json`);
  const args = [
    'run', '--reporter=json', `--outputFile=${reportPath}`,
    ...files.map(f => path.resolve(root, f.path))
  ];

  const output = await new Promise<string>(resolve => {
    let data = '';
    const child = spawn(vitestBin(root), args, { cwd: root });
    child.stdout.on('data', chunk => (data += chunk));
    child.stderr.on('data', chunk => (data += chunk));
    child.on('error', () => resolve(data));
    child.on('close', () => resolve(data));
  });

  let raw = output;
  try {
    raw = fs.readFileSync(reportPath, 'utf8');
    fs.unlinkSync(reportPath);
  } catch {
  
  }

  let report: { testResults?: any[] } = {};
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      report = JSON.parse(raw.slice(start, end + 1));
    } catch {
      report = {};
    }
  }

  for (const file of files) {
    if (!report.testResults) {
      file.error = 'не удалось запустить vitest';
      continue;
    }

    const suite = report.testResults.find(item => path.resolve(item.name ?? '') === path.resolve(root, file.path));
    const assertions: {
      status?: string;
      title?: string;
      fullName?: string;
      failureMessages?: string[];
    }[] = suite?.assertionResults ?? [];

    file.passed = assertions.filter(item => item.status === 'passed').length;
    file.failed = assertions.filter(item => item.status === 'failed').length ||
      (suite?.status === 'failed' ? 1 : 0);
    file.cases = assertions.map(item => ({
      name: item.fullName || item.title || 'без названия',
      status: item.status === 'passed' ? 'passed' : 'failed',
      message: item.status === 'passed' ? undefined : item.failureMessages?.[0]
    }));

    if (assertions.length > 0) {
      file.tests = assertions.length;
    }
  }
}

function parseMarkers(output: string): { passed: number; failed: number; cases: TestCase[] } {
  let passed = 0;
  let failed = 0;
  const cases: TestCase[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('ATEST PASS')) {
      passed++;
      cases.push({ name: line.slice('ATEST PASS'.length).trim() || `test_${cases.length + 1}`, status: 'passed' });
    } else if (line.startsWith('ATEST FAIL')) {
      failed++;
      const rest = line.slice('ATEST FAIL'.length).trim();
      const separator = rest.indexOf(':');
      cases.push({
        name: (separator >= 0 ? rest.slice(0, separator) : rest).trim() || `test_${cases.length + 1}`,
        status: 'failed',
        message: separator >= 0 ? rest.slice(separator + 1).trim() : undefined
      });
    }
  }

  return { passed, failed, cases };
}

async function runTests(root: string, files: WrittenFile[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const vitestFiles = files.filter(file => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file.path));
  const otherFiles = files.filter(file => !vitestFiles.includes(file));

  if (vitestFiles.length > 0) {
    if (await ensureVitest(root)) {
      await runVitest(root, vitestFiles);
    } else {
      for (const file of vitestFiles) {
        file.error = 'vitest не установлен';
      }
    }
  }

  for (const file of otherFiles) {
    const result = await runTest(path.resolve(root, file.path), root);
    const found = parseMarkers(result.output);
    file.passed = found.passed;
    file.failed = found.failed;
    file.cases = found.cases;

    if (found.passed + found.failed > 0) {
      file.tests = found.passed + found.failed;

      if (result.exitCode !== 0) {
        file.error = `программа завершилась досрочно — результаты неполные (${result.error ?? 'ненулевой код выхода'})`;
      }
    } else {
      file.error = result.error ?? 'нет строк ATEST PASS/FAIL';
    }
  }
}

type HistoryMap = { [path: string]: WrittenFile };

function readHistory(state: vscode.Memento): HistoryMap {
  return state.get<HistoryMap>(HISTORY_KEY, {});
}

async function saveHistory(state: vscode.Memento, files: WrittenFile[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const history = readHistory(state);
  const updatedAt = Date.now();
  for (const file of files) {
    history[file.path] = { ...file, updatedAt };
  }
  await state.update(HISTORY_KEY, history);
}

function listHistory(state: vscode.Memento): WrittenFile[] {
  return Object.values(readHistory(state)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
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
      if (msg.command === 'openFile' && typeof msg.path === 'string') {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        const uri = root ? safePath(root, msg.path) : undefined;
        if (uri) {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
        }
        return;
      }

      if (msg.command === 'getHistory') {
        panel.webview.postMessage({ command: 'historyReady', data: listHistory(context.workspaceState) });
        return;
      }

      if (msg.command !== 'getAllFiles') {
        return;
      }

      try {
        const files = await collectFilesForContracts();
        const contracts = (await findContractFiles()).map(uri => uri.fsPath);
        const methods = new Set<string>();

        for (const contract of contracts) {
          const text = files[contract];
          if (text !== undefined) {
            getContractMethods(text).forEach(name => methods.add(name));
          }
        }

        const language = await detectLanguage(files, contracts);
        const languageName = LANGUAGE_NAMES[language];
        const base = process.env.PROMPT ?? '';
        const prompt = base.includes('{language}')
          ? base.replace(/\{language\}/g, languageName)
          : `${base}\n\nЯзык проекта: ${languageName}.`;

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

        const { written, skipped } = await saveFiles(job, contracts, language, files, methods);
        if (written.length === 0 && skipped.length === 0) {
          throw new Error('модель не вернула ни одного файла');
        }

        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
          await runTests(root, written);
        }

        await saveHistory(context.workspaceState, written);
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