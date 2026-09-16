/**
 * The end-to-end rehearsal for the update button. → docs/SPEC-packaging.md §3.7
 *
 *   node --experimental-strip-types scripts/update-rig.ts [--next 9.9.9]
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 IT EXISTS SO THAT PROVING THE BUTTON DOES NOT COST A RELEASE.         │
 * │                                                                          │
 * │ The button can only be pressed by a build that HAS it, and it only moves │
 * │ to a version that is NEWER — so the obvious way to test it is to publish │
 * │ a version whose only purpose is to be a target. That is a real number    │
 * │ spent on a rehearsal, and a release that exists for no user.             │
 * │                                                                          │
 * │ Instead: build the real packaged tree, copy it, bump the copy's          │
 * │ package.json, pack THAT as a layer, sign a manifest naming it with the   │
 * │ real working key, and serve both from localhost. Every line of the apply │
 * │ path then runs for real — download, sha256, extract, probe on a free     │
 * │ port, flip `current`, restart — against a real install.                  │
 * │                                                                          │
 * │ ⚠ WHAT IT DOES NOT PROVE, stated so nobody thinks otherwise: that the    │
 * │ compiled-in URL is right, and that GitHub serves the layer. Those two    │
 * │ are covered elsewhere — `release.yml` re-downloads what it published and │
 * │ compares hashes, and `release-web.ts` verifies its own signature against │
 * │ the keys in the app before writing anything.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createTarGz } from '../src/core/archive.ts';
import { RELEASE_PUBLIC_KEYS } from '../src/core/release-keys.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const NEXT = argv[argv.indexOf('--next') + 1] ?? '9.9.9';
const STAGE_AS = argv.includes('--stage-as') ? argv[argv.indexOf('--stage-as') + 1] : undefined;
const KEY_FILE = path.join(os.homedir(), '.agentco-release', 'working.key');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `--stage-as <older>` — THE OTHER HALF, AND IT IS THE BETTER HALF.        │
 * │ (user, 17/09/2026)                                                       │
 * │                                                                          │
 * │ The rig below proves the applier against a manifest and a layer it made   │
 * │ itself, which is exactly what it cannot vouch for: the URL compiled into  │
 * │ the app, GitHub actually serving the layer, and the real signing run.     │
 * │                                                                          │
 * │ So: take THIS build, label it as an older version, install it, and let    │
 * │ it update to the real published one over the real channel. Every URL is   │
 * │ the shipped one and nothing is simulated.                                 │
 * │                                                                          │
 * │ ⚠ IT ONLY WORKS ONCE THE TARGET IS PUBLISHED, so it is the acceptance     │
 * │ test AFTER a release, not the rehearsal before one. The two are           │
 * │ complementary: the rehearsal stops a broken applier from costing a        │
 * │ version number, this proves the parts only a real release can have.       │
 * │                                                                          │
 * │ ⚠ The code is IDENTICAL on both sides, and that is a feature: the only    │
 * │ observable is the version number, so anything that moves was moved by the │
 * │ update mechanism and not by a change that happened to ship with it.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
if (STAGE_AS) {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-stage-'));
  console.log(`\n  building the real packaged tree (${pkg.version}) …`);
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', path.join(ROOT, 'scripts', 'package.ts'), '--out', install],
    { cwd: ROOT, stdio: 'pipe' },
  );

  // Relabel in place: the directory name, the package.json inside it, and the
  // pointer. `appVersion()` reads that package.json, `current` decides what the
  // launcher runs, and the directory name is what `current` names.
  const from = path.join(install, 'app', pkg.version);
  const to = path.join(install, 'app', STAGE_AS);
  fs.renameSync(from, to);
  const staged = JSON.parse(fs.readFileSync(path.join(to, 'package.json'), 'utf8')) as Record<string, unknown>;
  staged['version'] = STAGE_AS;
  fs.writeFileSync(path.join(to, 'package.json'), JSON.stringify(staged, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(install, 'current'), path.join('app', STAGE_AS), 'utf8');

  console.log(`
  staged ${pkg.version} as ${STAGE_AS}.

    install   ${install}

  Start it — NO manifest override, so it asks the real agent-co.app:

     & "${path.join(install, 'agentco.cmd')}" start --dir "${path.join(install, 'company')}"

  Wait 30 s, open Settings, press the button. It should fetch the published
  layer from GitHub and land on the real version.

     type "${path.join(install, 'current')}"
`);
  process.exit(0);
}

if (!fs.existsSync(KEY_FILE)) {
  console.error(`\n✗ no signing key at ${KEY_FILE} — the app only reads a manifest it can verify\n`);
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-rig-'));
const install = path.join(work, 'install');

console.log(`\n  building the real packaged tree (${pkg.version}) …`);
execFileSync(process.execPath, ['--experimental-strip-types', path.join(ROOT, 'scripts', 'package.ts'), '--out', install], {
  cwd: ROOT,
  stdio: 'pipe',
});

/*
 * ⚠ A COPY OF THE REAL TREE, with one number changed. A hand-made fake would
 * prove the rig works; this proves the thing that will actually be shipped
 * works, including every file `tar` has to carry.
 */
console.log(`  making a "${NEXT}" layer out of it …`);
const nextTree = path.join(work, 'next');
fs.cpSync(path.join(install, 'app', pkg.version), nextTree, { recursive: true });
const nextPkgFile = path.join(nextTree, 'package.json');
const nextPkg = JSON.parse(fs.readFileSync(nextPkgFile, 'utf8')) as Record<string, unknown>;
nextPkg['version'] = NEXT;
fs.writeFileSync(nextPkgFile, JSON.stringify(nextPkg, null, 2) + '\n', 'utf8');

const layerFile = path.join(work, `agentco-app-${NEXT}.tar.gz`);
await createTarGz(nextTree, layerFile);
const layerBytes = fs.readFileSync(layerFile);
const sha256 = crypto.createHash('sha256').update(layerBytes).digest('hex');

// ── serve the layer, then the manifest that names it
const server = http.createServer((req, res) => {
  if (req.url === `/agentco-app-${NEXT}.tar.gz`) {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    return void res.end(layerBytes);
  }
  if (req.url === '/stable.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return void res.end(manifest);
  }
  if (req.url === '/stable.json.sig') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return void res.end(signature.toString('base64') + '\n');
  }
  res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;

const manifest = Buffer.from(
  JSON.stringify(
    {
      version: NEXT,
      released_at: new Date().toISOString().slice(0, 10),
      layers: {
        app: { version: NEXT, url: `${base}/agentco-app-${NEXT}.tar.gz`, sha256, size: layerBytes.length },
      },
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
const signature = crypto.sign(null, manifest, crypto.createPrivateKey(fs.readFileSync(KEY_FILE)));

/*
 * ⚠ Verified here too, against the keys compiled into THIS build. Signing with
 * the wrong key would otherwise show up as "the update silently did nothing",
 * which is the one failure mode hardest to tell from a bug in the applier.
 */
const vouching = RELEASE_PUBLIC_KEYS.find((k) =>
  crypto.verify(null, manifest, crypto.createPublicKey({ key: Buffer.from(k.spki, 'base64'), format: 'der', type: 'spki' }), signature),
);
if (!vouching) {
  console.error('\n✗ the manifest does not verify against this build’s keys — the app would ignore it\n');
  process.exit(1);
}

// ⚠ Its own company, so the rehearsal cannot touch a real one.
const company = path.join(install, 'company');

console.log(`
  rig ready.

    install      ${install}
    layer        ${NEXT}  ${layerBytes.length} bytes  ${sha256.slice(0, 12)}…
    manifest     ${base}/stable.json   (signed with the ${vouching.name} key)

  1. start the packaged install, pointed at this manifest:

     $env:AGENTCO_MANIFEST_URL = "${base}/stable.json"
     & "${path.join(install, 'agentco.cmd')}" start --dir "${company}"

  2. wait 30 s, open Settings, and press the button beside the version.
     It should land on ${NEXT} and the page should come back on its own.

  3. check what moved:

     type "${path.join(install, 'current')}"
     dir  "${path.join(install, 'app')}"

  Ctrl+C here when you are done — it serves the layer.
`);
