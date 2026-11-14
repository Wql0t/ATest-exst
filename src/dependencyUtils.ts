import * as vscode from 'vscode';
import * as path from 'path';
import { findContractFiles, getContractMethods } from './contractUtils';

export type FileMap = { [key: string]: string };

export async function collectFilesForContracts(): Promise<FileMap> {
    const files: FileMap = {};
    const methods = new Set<string>();

    for (const contract of await findContractFiles()) {
        const text = await read(contract);
        if (text === undefined) {
            continue;
        }

        files[contract.fsPath] = text;
        getContractMethods(text).forEach(name => methods.add(name));
    }

    for (const file of await findFunctionFiles(methods)) {
        await getFileWithDeps(file, files);
    }

    return files;
}

async function findFunctionFiles(methods: Set<string>): Promise<string[]> {
    if (methods.size === 0) {
        return [];
    }

    const patterns = new Map(
        [...methods].map(name => [name, definitionPattern(name)])
    );
    const found = new Set<string>();
    const sources = await vscode.workspace.findFiles(
        '**/*.{ts,tsx,js,jsx}',
        '**/{node_modules,out,dist,build,contracts,Tests,.git}/**'
    );

    for (const source of sources) {
        const text = await read(source);
        if (text === undefined) {
            continue;
        }

        for (const pattern of patterns.values()) {
            if (pattern.test(text)) {
                found.add(source.fsPath);
                break;
            }
        }
    }

    return [...found];
}

function definitionPattern(name: string): RegExp {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(
        `\\b(function|const|let|var)\\s+${escaped}\\b` +
        `|\\b${escaped}\\s*(?:<[^>]*>)?\\s*\\([^()]*\\)\\s*(?::[^;{]+)?\\{`,
        'm'
    );
}

export async function getFileWithDeps(filePath: string, files: FileMap = {}): Promise<FileMap> {
    const file = path.normalize(path.resolve(filePath));

    if (files[file] || isExcluded(file)) {
        return files;
    }

    const text = await read(vscode.Uri.file(file));
    if (text === undefined) {
        return files;
    }

    files[file] = text;

    for (const match of text.matchAll(/(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('.')) {
            continue;
        }

        const dependency = await resolveDependency(file, match[1]);
        if (dependency) {
            await getFileWithDeps(dependency, files);
        }
    }

    return files;
}

async function resolveDependency(fromFile: string, specifier: string): Promise<string | undefined> {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const withoutJsExtension = base.replace(/\.(js|jsx|mjs|cjs)$/, '');

    const candidates = [
        base,
        withoutJsExtension + '.ts',
        withoutJsExtension + '.tsx',
        base + '.ts',
        base + '.tsx',
        base + '.js',
        base + '.jsx',
        base + '/index.ts',
        base + '/index.js'
    ];

    for (const candidate of candidates) {
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
            if (stat.type === vscode.FileType.File) {
                return candidate;
            }
        } catch (err) {
        }
    }

    return undefined;
}

function isExcluded(file: string): boolean {
    return /[\\/](node_modules|out|dist|build|contracts|Tests|\.git)[\\/]/i.test(path.resolve(file));
}

async function read(uri: vscode.Uri): Promise<string | undefined> {
    try {
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    } catch (err) {
        return undefined;
    }
}
