import * as vscode from 'vscode';
import { mockTestReport } from './mocks';
import * as dotenv from 'dotenv';
import { initProject } from './contractUtils';
import { getFileWithDeps } from './dependencyUtils';

let autoMode = false;

export function activate(context: vscode.ExtensionContext) {
  dotenv.config({ path: vscode.Uri.joinPath(context.extensionUri, '.env').fsPath });

  const createDashboard = async (fileName: string = 'Файл не выбран') => {
    const panel = vscode.window.createWebviewPanel(
      'atestDashboard',
      'ATest Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.html');
    const htmlContent = (await vscode.workspace.fs.readFile(htmlPath)).toString();
    panel.webview.html = htmlContent.replace('__FILE_NAME__', fileName);

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'tgleAutoMode') {
        autoMode = !autoMode;
        vscode.window.showInformationMessage('Авторежим изменен: ' + autoMode);
      }

      if (msg.command === 'generate') {
        vscode.window.showInformationMessage('Генерация для файла: ' + fileName);

        if (process.env.USE_MOCKS === 'true') {
          setTimeout(() => {
            panel.webview.postMessage({
              command: 'reportReady',
              data: mockTestReport
            });
          }, 1000);
        }
      }

      if (msg.command === 'getAllFiles') {
        const foundFiles = await vscode.workspace.findFiles('contracts/**/*', '**/node_modules/**');
        let filesMap: { [key: string]: string } = {};

        for (let f of foundFiles) {
          filesMap = await getFileWithDeps(f.fsPath, filesMap);
        }

        vscode.window.showInformationMessage('Найдено файлов с зависимостями: ' + Object.keys(filesMap).length);
        panel.webview.postMessage({
          command: 'filesReady',
          data: filesMap
        });
      }

      if (msg.command === 'init') {
        initProject(context);
      }
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('atest.openDashboard', () => {
      createDashboard();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('atest.generateTests', (uri?: vscode.Uri) => {
      const fileName = uri ? uri.fsPath.split(/[\\/]/).pop() : 'Файл не выбран';
      createDashboard(fileName);
    })
  );
}

export function deactivate() {}
