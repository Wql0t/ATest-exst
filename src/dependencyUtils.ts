import * as vscode from 'vscode';
import * as path from 'path';

export async function getFileWithDeps(filePath: string, fileMap: { [key: string]: string } = {}) {
    if (fileMap[filePath]) {
        return fileMap;
    }

    try {
        const fileUri = vscode.Uri.file(filePath);
        const data = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(data).toString('utf-8');

        fileMap[filePath] = text;

        const regex = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const imp = match[1] || match[2];

            if (imp && imp.startsWith('.')) {
                const currentDir = path.dirname(filePath);
                const resolved = path.resolve(currentDir, imp);

                const exts = ['.ts', '.js', '/index.ts', '/index.js'];
                let target = '';

                for (let i = 0; i < exts.length; i++) {
                    const candidate = resolved.endsWith(exts[i]) ? resolved : resolved + exts[i];
                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
                        target = candidate;
                        break;
                    } catch (err) {

                    }
                }

                if (target) {
                    await getFileWithDeps(target, fileMap);
                }
            }
        }
    } catch (err) {
        console.log('Error reading file: ' + filePath);
    }

    return fileMap;
}
