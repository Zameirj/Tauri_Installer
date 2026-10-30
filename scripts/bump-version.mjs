// Asks for patch, minor or major and writes the new version to every file that holds it:
// package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml and the setup-installer entry in Cargo.lock.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const FILES = {
  pkg: 'package.json',
  conf: 'src-tauri/tauri.conf.json',
  cargo: 'src-tauri/Cargo.toml',
  lock: 'src-tauri/Cargo.lock',
};

const current = JSON.parse(readFileSync(FILES.conf, 'utf8')).version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) {
  console.error(`Current version "${current}" is not x.y.z`);
  process.exit(1);
}
const [major, minor, patch] = match.slice(1).map(Number);

const rl = createInterface({ input: process.stdin, output: process.stdout });
let kind = '';
while (!['patch', 'minor', 'major'].includes(kind)) {
  kind = (await rl.question(`Current version ${current}. Bump patch, minor or major? `)).trim().toLowerCase();
}
rl.close();

const next = {
  patch: `${major}.${minor}.${patch + 1}`,
  minor: `${major}.${minor + 1}.0`,
  major: `${major + 1}.0.0`,
}[kind];

// Each replacement must match exactly once, so a changed file layout fails loudly instead of silently.
function replaceOnce(file, pattern, replacement) {
  const text = readFileSync(file, 'utf8');
  const hits = text.match(new RegExp(pattern.source, 'gm'))?.length ?? 0;
  if (hits !== 1) {
    console.error(`Expected one version line in ${file}, found ${hits}. Nothing was changed.`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(pattern, replacement));
}

replaceOnce(FILES.pkg, /"version": "[^"]+"/, `"version": "${next}"`);
replaceOnce(FILES.conf, /"version": "[^"]+"/, `"version": "${next}"`);
replaceOnce(FILES.cargo, /^version = "[^"]+"/m, `version = "${next}"`);
replaceOnce(FILES.lock, /(name = "setup-installer"\r?\nversion = )"[^"]+"/, `$1"${next}"`);

console.log(`Version ${current} -> ${next}`);
console.log('Updated package.json, tauri.conf.json, Cargo.toml and Cargo.lock.');
