import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('atest.openDashboard', () => {
      const panel = vscode.window.createWebviewPanel(
        'atestDashborad',
        'ATestDashboard',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = `
                <!DOCTYPE html>
                <html lang="ru">
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            font-family: sans-serif;
                            padding: 20px;
                            color: var(--vscode-foreground);
                            background: var(--vscode-editor-background);
                        }
                        button {
                            padding: 10px 15px;
                            background: var(--vscode-button-background);
                            color: var(--vscode-button-foreground);
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                        }
                    </style>
                </head>
                <body>
                    <h2>ATest</h2>
                    <p>Панель тестов</p>
                    <button onclick="tsClick()">Создать тесты</button>

                    <script>
                        const vscode = acquireVsCodeApi();
                        function tsClick() {
                            vscode.postMessage({ command: 'generate' });
                        }
                    </script>
                </body>
                </html>
            `;

      panel.webview.onDidReceiveMessage(message => {
        if (message.command === 'generate') {
          vscode.window.showInformationMessage('Подождите...');
          GenTest();
        }
      });

    }),

    vscode.commands.registerCommand('atest.generateTests', (uri?: vscode.Uri) => {
      const path = uri ? uri.fsPath : 'текущий файл';
      //vscode.window.showInformationMessage(`тест: ${path}`);
      GenTest(uri);
    })

    );
  function GenTest(uri?: vscode.Uri) {
    const filePath = uri ? uri.fsPath : vscode.window.activeTextEditor?.document.uri.fsPath || 'не выбран файл';

  vscode.window.showInformationMessage(`Подождите...: ${filePath}`);

        }
}

export function deactivate() {}
