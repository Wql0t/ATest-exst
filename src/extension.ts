import * as vscode from 'vscode';
import { mockTestReport } from './mocks';
import * as dotenv from 'dotenv';
import { initProject, findContractFiles } from './contractUtils';
import { collectFilesForContracts } from './dependencyUtils';

let autoMode = false;


interface JobAccepted {
  id: string;
  status: string;
  files: number;
}

async function sendToServer(
  files: { [path: string]: string },
  contracts: string[],
  prompt: string
): Promise<JobAccepted> {
  const baseUrl = process.env.SERVER_URL ?? 'http://localhost:8080';

  const res = await fetch(`${baseUrl}/api/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, contracts, prompt })
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<JobAccepted>;
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
      }



      if (msg.command === 'getAllFiles') {
        try {
          const files = await collectFilesForContracts();
          const contracts = (await findContractFiles()).map(uri => uri.fsPath);
          const prompt = process.env.PROMPT ?? '';
          const fileCount = Object.keys(files).length;

          console.log(Object.keys(files));
          vscode.window.showInformationMessage(
            `Файлов: ${fileCount}, контрактов: ${contracts.length}`
          );

          panel.webview.postMessage({
            command: 'filesReady',
            data: files
          });

          const accepted = await sendToServer(files, contracts, prompt);
          vscode.window.showInformationMessage(
            `#${accepted.id} отправлено (${accepted.files} файлов)`
          );

          panel.webview.postMessage({
            command: 'jobQueued',
            data: accepted
          });
        } catch (err) {
          vscode.window.showErrorMessage(`ошибка отправки: ${err}`);
        }
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
