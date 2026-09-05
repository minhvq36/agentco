
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { probeArm } from '../src/core/probe.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsargs-'));

const spaced = path.join(root, 'thu muc co dau cach');
const plain = path.join(root, 'thuong');
fs.mkdirSync(spaced, { recursive: true });
fs.mkdirSync(plain, { recursive: true });
const oneFile = path.join(plain, 'mot-file.txt');
fs.writeFileSync(oneFile, 'noi dung', 'utf8');

const arm = (...args: string[]) => ({ files: { command: 'npx', args: ['-y', PKG, ...args] } as never });

async function ca(label: string, args: string[]) {
  const r = await probeArm(arm(...args));
  const line = `${label.padEnd(34)} ${r.status.padEnd(10)} tools=${String(r.tools.length).padStart(2)}`;
  console.log(r.error ? `${line}\n     └─ ${r.error.split('\n')[0]}` : line);
  return r;
}

console.log(`test root: ${root}\n`);

console.log('── A · a space in the directory name');
await ca('bare (no quotes)', [spaced]);
await ca('wrapped in double quotes', [`"${spaced}"`]);

console.log('\n── B · passing a FILE as the root');
await ca('a single .txt file', [oneFile]);

console.log('\n── C · multiple directories');
await ca('two directories', [plain, spaced]);

console.log('\n── D · POSIX-style slashes on Windows');
await ca('using "/" instead of "\\"', [spaced.replace(/\\/g, '/')]);

fs.rmSync(root, { recursive: true, force: true });
console.log('\n↩ removed test directory');
