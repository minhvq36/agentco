/**
 * The website half of a release, run by the maintainer after approving the npm
 * version. → docs/SPEC-packaging.md §3.6 · docs/CLAUDE.md §The release sequence
 *
 * 🔴 IT RUNS ON THIS MACHINE AND NOWHERE ELSE, BECAUSE IT SIGNS. The key that
 * vouches for `stable.json` to every installed copy must not be reachable from
 * CI — the same reasoning as npm's stage-only publisher: a taken-over pipeline
 * gets a queue, never a signature.
 *
 * In order, refusing at the first thing that is not true:
 *   1. GitHub: release v<version> exists, is neither a draft nor a pre-release,
 *      and is what `releases/latest` resolves to — the download button and the
 *      manifest must announce the same version.
 *   2. npm: `latest` is <version>, i.e. the staged version was approved.
 *   3. `RELEASE_INFO` in the website's `config/site.ts` gets the version and size.
 *   4. `public/releases/stable.json` is written, those exact bytes are signed
 *      with the working key, and the signature is checked against the public
 *      keys compiled into the app BEFORE anything is written to disk.
 * It commits nothing and pushes nothing: the diff is for a person to read.
 *
 * Run: node --experimental-strip-types scripts/release-web.ts [--web ../agentco-web] [--key <file>]
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RELEASE_PUBLIC_KEYS } from '../src/core/release-keys.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

const VERSION = pkg.version;
const WEB = path.resolve(flag('web', path.join(ROOT, '..', 'agentco-web')));
const KEY_FILE = path.resolve(flag('key', path.join(os.homedir(), '.agentco-release', 'working.key')));
const REPO = 'minhvq36/agentco';
const ASSET = 'AgentCo-win-x64-setup.exe';

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) fail(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

console.log(`\nRelease v${VERSION} → website at ${WEB}\n`);

// ── 1. GitHub
interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  assets: Array<{ name: string; size: number }>;
}
const release = await getJson<Release>(`https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}`);
if (release.draft || release.prerelease) fail(`v${VERSION} is a draft or a pre-release — releases/latest skips it`);
const latestRelease = await getJson<{ tag_name: string }>(`https://api.github.com/repos/${REPO}/releases/latest`);
if (latestRelease.tag_name !== `v${VERSION}`) {
  fail(`releases/latest is ${latestRelease.tag_name}, not v${VERSION} — the button would serve a different version than the manifest announces`);
}
const asset = release.assets.find((a) => a.name === ASSET);
if (!asset) fail(`v${VERSION} has no ${ASSET}`);
console.log(`  ✓ GitHub release v${VERSION} is latest · ${ASSET} ${asset.size} bytes`);

// ── 2. npm
const registry = await getJson<{ 'dist-tags': Record<string, string> }>(
  `https://registry.npmjs.org/${pkg.name.replace('/', '%2f')}`,
);
if (registry['dist-tags']['latest'] !== VERSION) {
  fail(`npm latest is ${registry['dist-tags']['latest']}, not ${VERSION} — approve the staged version on npmjs.com first`);
}
console.log(`  ✓ npm latest is ${VERSION}`);

// ── the key, and the website checkout
if (!fs.existsSync(KEY_FILE)) fail(`no signing key at ${KEY_FILE} (scripts/release-keys.ts makes it; --key points elsewhere)`);
const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
const siteFile = path.join(WEB, 'config', 'site.ts');
if (!fs.existsSync(siteFile)) fail(`no website checkout at ${WEB} (--web points elsewhere)`);

// ── 3. RELEASE_INFO
const sizeMB = (Math.round((asset.size / 1024 / 1024) * 10) / 10).toFixed(1);
const site = fs.readFileSync(siteFile, 'utf8');
const block = /export const RELEASE_INFO = \{[\s\S]*?\} as const;/;
if (!block.test(site)) fail(`no RELEASE_INFO block in ${siteFile} — the website changed shape; update this script`);
const nextSite = site.replace(block, `export const RELEASE_INFO = {\n  version: '${VERSION}',\n  sizeMB: ${sizeMB},\n} as const;`);

// ── 4. the manifest: sign, then prove the app would accept it
const manifest = Buffer.from(
  JSON.stringify({ version: VERSION, released_at: release.published_at.slice(0, 10) }, null, 2) + '\n',
  'utf8',
);
const signature = crypto.sign(null, manifest, privateKey);
const vouching = RELEASE_PUBLIC_KEYS.find((k) =>
  crypto.verify(
    null,
    manifest,
    crypto.createPublicKey({ key: Buffer.from(k.spki, 'base64'), format: 'der', type: 'spki' }),
    signature,
  ),
);
if (!vouching) fail(`${KEY_FILE} is not one of the keys compiled into the app — every installed copy would reject this manifest`);

const outDir = path.join(WEB, 'public', 'releases');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(siteFile, nextSite, 'utf8');
fs.writeFileSync(path.join(outDir, 'stable.json'), manifest);
fs.writeFileSync(path.join(outDir, 'stable.json.sig'), signature.toString('base64') + '\n', 'utf8');

console.log(`  ✓ RELEASE_INFO → ${VERSION}, ${sizeMB} MB`);
console.log(`  ✓ public/releases/stable.json signed with the ${vouching.name} key, verified against the app's keys`);
console.log('\nNext, in the website checkout:');
console.log(`  git -C "${WEB}" diff`);
console.log(`  git -C "${WEB}" add config/site.ts public/releases`);
console.log(`  git -C "${WEB}" commit -m "Website shows v${VERSION}"`);
console.log(`  git -C "${WEB}" push\n`);
