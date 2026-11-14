import * as vscode from 'vscode';
import * as path from 'path';
import { Language, languageOf, SOURCE_GLOB, EXCLUDE_GLOB } from './languages';
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

function emptyCounts(): Record<Language, number> {
    return { ts: 0, cpp: 0, python: 0, go: 0, rust: 0, java: 0, csharp: 0 };
}

function bestLanguage(counts: Record<Language, number>): Language {
    let best: Language = 'ts';
    for (const language of Object.keys(counts) as Language[]) {
        if (counts[language] > counts[best]) {
            best = language;
        }
    }
    return best;
}

export async function detectLanguage(files?: FileMap, contracts: string[] = []): Promise<Language> {
    // В смешанных проектах язык определяется по реализациям методов из контрактов,
    // а не по количеству файлов во всём репозитории (фронтенд может перевесить бэкенд).
    if (files && Object.keys(files).length > 0) {
        const contractSet = new Set(contracts.map(file => path.normalize(path.resolve(file))));
        const counts = emptyCounts();

        for (const file of Object.keys(files)) {
            if (contractSet.has(path.normalize(path.resolve(file)))) {
                continue;
            }
            const language = languageOf(file);
            if (language) {
                counts[language]++;
            }
        }

        const best = bestLanguage(counts);
        if (counts[best] > 0) {
            return best;
        }
    }

    const sources = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB);
    const counts = emptyCounts();

    for (const source of sources) {
        const language = languageOf(source.fsPath);
        if (language) {
            counts[language]++;
        }
    }

    return bestLanguage(counts);
}

async function findFunctionFiles(methods: Set<string>): Promise<string[]> {
    if (methods.size === 0) {
        return [];
    }

    const patterns = new Map(
        [...methods].map(name => [name, definitionPattern(name)])
    );
    const found = new Set<string>();
    const sources = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB);

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
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_]?');

    return new RegExp(
        `\\b(function|const|let|var|def|func|fn)\\s+${escaped}\\b` +
        `|\\b${escaped}\\s*(?:<[^>]*>)?\\s*\\([^()]*\\)\\s*(?::[^;{]+)?\\{`,
        'im'
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

    for (const match of text.matchAll(/#include\s+"([^"]+)"/g)) {
        await getFileWithDeps(path.resolve(path.dirname(file), match[1]), files);
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
    return /[\\/](node_modules|out|dist|build|contracts|Tests|tests|target|bin|obj|venv|\.venv|__pycache__|\.git)[\\/]/i.test(path.resolve(file));
}

async function read(uri: vscode.Uri): Promise<string | undefined> {
    try {
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    } catch (err) {
        return undefined;
    }
}
