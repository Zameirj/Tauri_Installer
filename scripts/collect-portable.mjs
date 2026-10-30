// Copies the --no-bundle release exe to release/ImportCentre_<version>_portable.exe
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const { mainBinaryName } = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const source = `src-tauri/target/release/${mainBinaryName}.exe`;

if (!existsSync(source)) {
  console.error(`Build output not found: ${source}`);
  process.exit(1);
}

mkdirSync('release', { recursive: true });
const target = `release/SetupInstaller_${version}_portable.exe`;
copyFileSync(source, target);
console.log(`Portable build: ${target} (${(statSync(target).size / 1048576).toFixed(1)} MB)`);
