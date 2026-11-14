import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

export type Language = 'ts' | 'cpp' | 'python' | 'go' | 'rust' | 'java' | 'csharp';

export const LANGUAGE_NAMES: Record<Language, string> = {
  ts: 'TypeScript',
  cpp: 'C++',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  csharp: 'C#'
};

export const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,cpp,cc,cxx,h,hpp,py,go,rs,java,cs}';
export const EXCLUDE_GLOB = '**/{node_modules,out,dist,build,contracts,Tests,tests,target,bin,obj,venv,.venv,__pycache__,.git}/**';

const EXTENSIONS: Record<string, Language> = {
  '.ts': 'ts', '.tsx': 'ts', '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.cjs': 'ts',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.cs': 'csharp'
};

const COMMANDS: Record<string, string> = {
  '.cpp': 'g++ -std=c++17 "{file}" -o "{tmp}/test" && "{tmp}/test"',
  '.cc': 'g++ -std=c++17 "{file}" -o "{tmp}/test" && "{tmp}/test"',
  '.cxx': 'g++ -std=c++17 "{file}" -o "{tmp}/test" && "{tmp}/test"',
  '.py': 'python3 "{file}"',
  '.go': 'go run "{file}"',
  '.rs': 'rustc --edition 2021 "{file}" -o "{tmp}/test" && "{tmp}/test"',
  '.java': 'javac -sourcepath "{root}" -d "{tmp}" "{file}" && java -cp "{tmp}" Main',
  '.cs': 'dotnet run "{file}"'
};

export function languageOf(file: string): Language | undefined {
  return EXTENSIONS[path.extname(file).toLowerCase()];
}

export interface RunResult {
  output: string;
  error?: string;
  exitCode?: number | null;
}

export async function runTest(file: string, root: string): Promise<RunResult> {
  const ext = path.extname(file).toLowerCase();
  const tmp = path.join(os.tmpdir(), `atest-${process.pid}-${Date.now()}`);
  const command = ext === '.go' && file.endsWith('_test.go')
    ? 'go test -v "{dir}"'
    : COMMANDS[ext];

  if (!command) {
    return { output: '', error: `нет команды для ${ext || file}` };
  }

  fs.mkdirSync(tmp, { recursive: true });
  const prepared = command
    .replace(/\{file\}/g, file.replace(/"/g, '\\"'))
    .replace(/\{root\}/g, root.replace(/"/g, '\\"'))
    .replace(/\{dir\}/g, path.dirname(file).replace(/"/g, '\\"'))
    .replace(/\{tmp\}/g, tmp);

  try {
    return await exec(prepared, root);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function exec(command: string, cwd: string): Promise<RunResult> {
  return new Promise(resolve => {
    const child = spawn(command, { cwd, shell: true });
    let output = '';

    child.stdout.on('data', chunk => {
      output += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      output += chunk.toString();
    });
    child.on('error', err => {
      resolve({ output, error: err.message, exitCode: null });
    });
    child.on('close', (code, signal) => {
      const lines = output.trim().split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      const reason = signal
        ? `процесс убит сигналом ${signal}`
        : `код ${code ?? 'неизвестен'}`;
      const detail = last && !last.startsWith('ATEST ') ? `: ${last}` : '';

      resolve({
        output,
        exitCode: code,
        error: code === 0 ? undefined : reason + detail
      });
    });
  });
}
