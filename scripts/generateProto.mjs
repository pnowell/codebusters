import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const PLATFORM_PACKAGES = {
  'darwin arm64 LE': ['@bufbuild/buf-darwin-arm64', 'bin/buf'],
  'darwin x64 LE': ['@bufbuild/buf-darwin-x64', 'bin/buf'],
  'linux arm64 LE': ['@bufbuild/buf-linux-aarch64', 'bin/buf'],
  'linux armv7 LE': ['@bufbuild/buf-linux-armv7', 'bin/buf'],
  'linux x64 LE': ['@bufbuild/buf-linux-x64', 'bin/buf'],
  'win32 arm64 LE': ['@bufbuild/buf-win32-arm64', 'bin/buf.exe'],
  'win32 x64 LE': ['@bufbuild/buf-win32-x64', 'bin/buf.exe'],
};

const platformKey = `${process.platform} ${os.arch()} ${os.endianness()}`;
const entry = PLATFORM_PACKAGES[platformKey];
if (!entry) {
  throw new Error(`Unsupported platform for @bufbuild/buf: ${platformKey}`);
}

const bufBin = require.resolve(`${entry[0]}/${entry[1]}`);
const nodeBinDir = path.dirname(process.execPath);
const localBinDir = path.join(appRoot, 'node_modules', '.bin');
const mergedPath = [localBinDir, nodeBinDir, process.env.PATH ?? '']
  .filter(Boolean)
  .join(path.delimiter);

execFileSync(bufBin, ['generate'], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: mergedPath,
  },
});
console.log('✓ Generated Protobuf bindings in src/proto');
