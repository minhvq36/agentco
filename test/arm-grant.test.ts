
/**
 * A CREDENTIAL FOLLOWS THE WIRE. → `core/worker.ts §keysFor` · SPEC-arms §7a
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MEASURED 08/09, IN THE USER'S OWN COMPANY: Notion, GitHub and Linear all │
 * │ answered 401 at the same time, and every symptom pointed somewhere else. │
 * │                                                                          │
 * │ The store HELD the tokens. The ledger NAMED them. `roles/tooler.yaml`    │
 * │ had the arms in `mcp:`. And across all twenty roles in that company, not │
 * │ one had a `secrets:` line — because `role.secrets` is written by         │
 * │ `Office.grantArm` (the Connections dialog) and NOT by `LayoutStore.save` │
 * │ (dragging the wire on the diagram). Two doors, one of them carrying the  │
 * │ credential.                                                              │
 * │                                                                          │
 * │ The worker then launched with `${NOTION_OAUTH_…}` unfilled, the server   │
 * │ answered 401, the SDK registered no tools, and the model reported *"no   │
 * │ Notion tool"* — a statement about CAPABILITY produced by a broken WIRE.  │
 * │                                                                          │
 * │ So the test is on the READER, like the fix: whoever draws the wire, and  │
 * │ whatever they forget to write, the launch asks for the arm's own key.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { keysFor } from '../dist/core/secrets.js';

const ARMS = {
  notion: { secrets: ['NOTION_OAUTH_AF'] },
  github: { secrets: ['GITHUB_OAUTH_8D'] },
  files: { secrets: [] },
  cli: {},
};

const role = (mcp: string[], secrets: string[] = []) => ({ mcp, secrets });

test('🔴 a role that declares NO `secrets:` still gets its wired arm’s credential', () => {
  // Exactly the shape on disk: `mcp:` written by the diagram, `secrets:` absent.
  assert.deepEqual(keysFor(ARMS, role(['notion'])), ['NOTION_OAUTH_AF']);
});

test('🔴 EVERY wired arm is covered — the warning must not miss one of three', () => {
  const got = keysFor(ARMS, role(['files', 'notion', 'github', 'cli']));
  assert.deepEqual(got.sort(), ['GITHUB_OAUTH_8D', 'NOTION_OAUTH_AF']);
});

test('🔴 PER ARM, one arm cannot see another’s token', () => {
  // The stdio branch of `injectSecrets` merges the key map into the process
  // environment, so a pooled grant hands the filesystem server the Notion
  // token. Narrower than before this fix, not wider.
  assert.deepEqual(keysFor(ARMS, role(['files', 'notion']), 'files'), []);
  assert.deepEqual(keysFor(ARMS, role(['files', 'notion']), 'notion'), ['NOTION_OAUTH_AF']);
});

test('a key granted to the PERSON still travels to every arm they use', () => {
  // `role.secrets` keeps its old meaning: keys the user handed to this
  // employee, independent of any connection.
  assert.deepEqual(keysFor(ARMS, role(['files'], ['MEMORY_PATH']), 'files'), ['MEMORY_PATH']);
});

test('an arm the role is NOT wired to contributes nothing', () => {
  assert.deepEqual(keysFor(ARMS, role(['files'])), []);
});

test('a name is asked for once, however many arms need it', () => {
  const shared = { a: { secrets: ['K'] }, b: { secrets: ['K'] } };
  assert.deepEqual(keysFor(shared, role(['a', 'b'])), ['K']);
});

test('an arm that is wired but no longer in the ledger is not a crash', () => {
  // The orphan case the diagram draws in red — it must still launch the rest.
  assert.deepEqual(keysFor(ARMS, role(['gone', 'notion'])), ['NOTION_OAUTH_AF']);
});

/**
 * 🔴 THE CHECKER AND THE FILLER MUST ASK THE SAME QUESTION.
 *
 * `missingSecretRefs` scanned the whole config while `injectSecrets` filled
 * only `headers`, so a blank field was reported forever and never filled. The
 * rule that came out of it — **the scope of the function that FILLS equals the
 * scope of the function that CHECKS** — is what these two gates hold in place
 * now that the diagram has a red state for a missing key.
 */
test('🔴 the red-node gate asks `keysFor`, not its own copy of the ledger', () => {
  const office = fs.readFileSync(
    path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'src', 'core', 'office.ts'),
    'utf8',
  );
  assert.match(
    office,
    /const keyGoneOf[\s\S]{0,400}?keysFor\(this\.loaded\.company\.arms/,
    'the check has grown its own idea of which keys an arm needs — that is the pair that drifts',
  );
  assert.match(
    office,
    /keyGoneOf\(n\.server\)/,
    'the fact is computed and never reaches a node — a gate nothing displays is a promise',
  );
});

test('🔴 a node with NO key stored is painted red, the same red as a dead one', () => {
  const canvas = fs.readFileSync(
    path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'web', 'src', 'canvas', 'Canvas.tsx'),
    'utf8',
  );
  assert.match(
    canvas,
    /n\.keyDead \|\| n\.keyGone \? ' is-keydead' : ''/,
    'the arm cannot run and nothing on the diagram says so',
  );
});
