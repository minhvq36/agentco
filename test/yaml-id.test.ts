
/**
 * AN ID THAT YAML READS BACK AS SOMETHING OTHER THAN A STRING.
 * → `office.ts §roleTemplate` · `company.ts §officeTemplate` · `config.ts §loadOffice`
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ REPORTED 09/09: an employee named `1` — the bare number — was created,
 * │ the button worked, and nothing ever appeared on the diagram.
 * │
 * │ `isSafeId('1')` passes: it guards the CHARACTER SET, not the YAML
 * │ parser's reading of it. The template wrote `id: 1` unquoted, the parser
 * │ handed back the number 1, the schema wanted a string, the role was
 * │ skipped with a warning on stderr that nobody sees — and the office
 * │ carried on as if nothing had happened.
 * │
 * │ ⚠ Same trap, worse blast radius one level up: an OFFICE named `1` makes
 * │ `loadOffice` THROW instead of skip.
 * └──────────────────────────────────────────────────────────────────────────
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import YAML from 'yaml';

import { roleTemplate } from '../dist/core/office.js';
import { isSafeId, slugId } from '../dist/core/paths.js';

/** Every scalar a real name can slug into that YAML does NOT read as a string. */
const TRAPS = ['1', '123', 'true', 'false', 'null', '0x1f', '1e5'];

test('🔴 premise: `isSafeId` lets every one of these through — it guards characters, not types', () => {
  for (const id of TRAPS) {
    assert.equal(isSafeId(id), true, `${id} is rejected now — this test's premise has moved`);
  }
  // …and they really are what a typed name turns into.
  assert.equal(slugId('1'), '1');
  assert.equal(slugId('True'), 'true');
});

test('🔴 a role file written for id `1` reads back as the STRING "1"', () => {
  for (const id of TRAPS) {
    const parsed = YAML.parse(roleTemplate(id, 'x', 'y', 'standard')) as { id: unknown };
    assert.equal(
      typeof parsed.id,
      'string',
      `id ${id} came back as ${typeof parsed.id} — the schema rejects it and the employee never appears`,
    );
    assert.equal(parsed.id, id);
  }
});

test('an ordinary id is untouched by the quoting', () => {
  const parsed = YAML.parse(roleTemplate('nguoi-viet', 'Writer', 'writes', 'eco')) as { id: string };
  assert.equal(parsed.id, 'nguoi-viet');
});

/**
 * The read side, which is what SELF-HEALS the files already on disk: the file
 * name is the identity and it overwrites whatever the file says. A `??=` only
 * fired when the key was absent — the one case that was never broken.
 */
test('🔴 the loader takes the id from the FILE NAME, unconditionally', () => {
  const src = fs.readFileSync(
    path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'src', 'core', 'config.ts'),
    'utf8',
  );
  assert.match(src, /roleRaw\['id'\] = file\.replace/, 'a role file that says `id: 1` is skipped again');
  assert.match(src, /rawCfg\['id'\] = officeId;/, 'an office named `1` throws on load again');
  assert.doesNotMatch(src, /\['id'\] \?\?=/, 'the fallback is back — it only covers the case that worked');
});

test('🔴 no template interpolates an id into YAML unquoted', () => {
  const root = url.fileURLToPath(new URL('..', import.meta.url));
  for (const f of ['src/core/office.ts', 'src/core/company.ts']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(
      src,
      /`id: \$\{id\}/,
      `${f} writes a bare id into YAML again — quote it, like display_name beside it`,
    );
  }
});
