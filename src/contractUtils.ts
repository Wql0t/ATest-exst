import * as vscode from 'vscode';

export function findContractFiles(): Thenable<vscode.Uri[]> {
    return vscode.workspace.findFiles('**/contracts/**/*.ts', '**/node_modules/**');
}

export function getContractMethods(text: string): string[] {
    const methods = new Set<string>();

    for (const match of text.matchAll(/([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^()]*\)\s*(?::|;)/g)) {
        if (match[1] !== 'constructor') {
            methods.add(match[1]);
        }
    }

    return [...methods];
}

export async function initProject(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Папка проекта не найдена');
        return;
    }

    const contractsDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'contracts');
    const testsDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'Tests');

    try {
        await vscode.workspace.fs.createDirectory(contractsDir);
        await vscode.workspace.fs.createDirectory(testsDir);

        const exampleContent = `/**
 * Dexigen:
 * Позитив: Метод должен возвращать статус 'success'.
 * Негатив: Метод должен возвращать ошибку при пустых входных данных.
 */
export interface MyContract {
    doSomething(data: string): Promise<string>;
}`;

        const filePath = vscode.Uri.joinPath(contractsDir, 'example.ts');
        await vscode.workspace.fs.writeFile(filePath, Buffer.from(exampleContent));

        vscode.window.showInformationMessage('Проект успешно инициализирован');
    } catch (err) {
        vscode.window.showErrorMessage(`Ошибка инициализации: ${err}`);
    }
}
