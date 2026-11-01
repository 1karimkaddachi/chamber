import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

function bindingName() {
  const arch = process.arch;
  if (process.platform === 'linux') {
    const report = process.report?.getReport?.();
    const musl = report?.header ? report.header.glibcVersionRuntime === undefined : false;
    return `rollup-linux-${arch}-${musl ? 'musl' : 'gnu'}`;
  }
  if (process.platform === 'darwin') return `rollup-darwin-${arch}`;
  if (process.platform === 'win32') return `rollup-win32-${arch}-msvc`;
  return null;
}

function installedRollupVersion() {
  const packagePath = path.join(repoRoot, 'node_modules', 'rollup', 'package.json');
  if (!existsSync(packagePath)) return null;
  return JSON.parse(readFileSync(packagePath, 'utf8')).version;
}

const binding = bindingName();
const version = installedRollupVersion();

if (!binding || !version) {
  console.log('rollup binding: nothing to do');
  process.exit(0);
}

if (existsSync(path.join(repoRoot, 'node_modules', '@rollup', binding))) {
  console.log(`rollup binding: ${binding} already installed`);
  process.exit(0);
}

// npm only records the Rollup binary for the platform that resolved the
// lockfile, so a Linux install from a Windows-authored lock has none.
console.log(`rollup binding: installing @rollup/${binding}@${version}`);
execFileSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--no-save', '--no-audit', '--no-fund', `@rollup/${binding}@${version}`],
  { cwd: repoRoot, stdio: 'inherit' },
);
