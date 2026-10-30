// Runs the Tauri CLI with Rust's cargo folder on PATH, so `pnpm run tauri:dev`
// works from any terminal (e.g. Git Bash) even when rustup did not add it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
const env = { ...process.env };
if (existsSync(cargoBin)) {
  // Windows env names are case-insensitive; reuse whichever spelling exists.
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[key] = `${cargoBin}${delimiter}${env[key] ?? ''}`;
}

const child = spawn('pnpm', ['exec', 'tauri', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 1));
