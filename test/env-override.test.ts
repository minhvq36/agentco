/**
 * Which config key an environment variable addresses. → `core/config.ts`
 *
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ 🔴 MEASURED IN A RUNNING CONTAINER, 18/09/2026:
 * │
 * │   env AGENTCO_RUNTIME_PUBLIC_URL : "http://127.0.0.1:7319"
 * │   config.runtime.public_url      : ""
 * │
 * │ The variable was set, spelled exactly as three separate places in this
 * │ repo tell you to spell it, and it reached the process. It just could not
 * │ reach the config: the override mechanism split on `_`, so `public_url`
 * │ became the path `runtime.public.url`, which the schema does not have and
 * │ zod therefore dropped.
 * │
 * │ The bill was not a setting. An empty `public_url` on a daemon bound to
 * │ `0.0.0.0` is branch ③ of `redirectBase` — REFUSE — so no web-flow OAuth
 * │ arm could be connected through the Docker door at all. GitHub kept
 * │ working and hid it, because a device flow has no redirect_uri.
 * └────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ Everything is synchronous. The runner cancels pending tests whenever the
 * event loop drains. → `test/port.test.ts`
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { configPathForEnv } from '../dist/core/config.js';
import { CompanyConfigSchema } from '../dist/core/types.js';

/** Every key the schema declares, as `a.b.c` paths. */
function schemaPaths(): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out.push([...prefix, k].join('.'));
      walk(v, [...prefix, k]);
    }
  };
  walk(CompanyConfigSchema.parse({}), []);
  return out;
}

test('🔴 the one that cost the Docker door: AGENTCO_RUNTIME_PUBLIC_URL', () => {
  assert.deepEqual(configPathForEnv('AGENTCO_RUNTIME_PUBLIC_URL'), ['runtime', 'public_url']);
});

test('⭐ EVERY key with an underscore is reachable from its environment spelling', () => {
  /*
   * The rule, not a list: 19 keys were unreachable and nothing said so. Stating
   * it over the schema means a key added next year is covered without anyone
   * remembering this file exists.
   *
   * ⚠ Only lowercase keys. `mcpServers` cannot be addressed from an env name
   * either way, because the name is lowercased before matching — that is
   * unchanged behaviour, not something this gate is claiming to fix.
   */
  const underscored = schemaPaths().filter(
    (p) => p.includes('_') && p === p.toLowerCase(),
  );
  assert.ok(underscored.length > 10, `expected many, found ${underscored.length}`);

  for (const p of underscored) {
    const env = `AGENTCO_${p.split('.').join('_').toUpperCase()}`;
    assert.deepEqual(configPathForEnv(env), p.split('.'), `${env} cannot reach ${p}`);
  }
});

test('the schema map is really built — an empty one would silently restore the bug', () => {
  /*
   * `knownKeys()` swallows a throw from `CompanyConfigSchema.parse({})` and
   * degrades to the old split-on-every-underscore behaviour, because throwing
   * before `safeParse` would crash somewhere that cannot explain itself. This
   * is the gate that makes that degradation loud instead of silent: if the map
   * were empty, `public_url` would come back as `['public', 'url']`.
   */
  assert.notDeepEqual(configPathForEnv('AGENTCO_RUNTIME_PUBLIC_URL'), ['runtime', 'public', 'url']);
});

test('a variable that already worked keeps its exact path', () => {
  // Single-word leaves were never affected; this change must not touch them.
  assert.deepEqual(configPathForEnv('AGENTCO_RUNTIME_PORT'), ['runtime', 'port']);
  assert.deepEqual(configPathForEnv('AGENTCO_UPDATES_CHECK'), ['updates', 'check']);
  assert.deepEqual(configPathForEnv('AGENTCO_MODELS_ECO'), ['models', 'eco']);
  assert.deepEqual(configPathForEnv('AGENTCO_LANGUAGE'), ['language']);
});

test('an unknown name falls through unchanged — it can only wake a dead variable, never move a live one', () => {
  /*
   * Nothing in the schema is called `foo`, so the old behaviour applies
   * verbatim: the parts become the path and zod strips the result. Keeping
   * this identical is what makes the change safe to ship without auditing
   * every deployment's environment.
   */
  assert.deepEqual(configPathForEnv('AGENTCO_FOO_BAR'), ['foo', 'bar']);
  assert.deepEqual(configPathForEnv('AGENTCO_RUNTIME_NOPE_NOPE'), ['runtime', 'nope', 'nope']);
});

test('process-control variables never reach the company config', () => {
  // Paths, secrets and output format belong to the process. → `NOT_CONFIG`
  for (const n of [
    'AGENTCO_COMPANY_DIR',
    'AGENTCO_TOKEN',
    'AGENTCO_HEADLESS',
    'AGENTCO_LOG_LEVEL',
    'AGENTCO_FORMAT',
    'AGENTCO_OFFICE',
  ]) {
    assert.equal(configPathForEnv(n), undefined, n);
  }
  // And a name that is not ours at all.
  assert.equal(configPathForEnv('PATH'), undefined);
  assert.equal(configPathForEnv('HOME'), undefined);
});

test('longest match wins, so the longer key is addressable at all', () => {
  /*
   * `budgets` holds `knowledge_node_tokens` AND `cold_knowledge_tokens`; the
   * greedy walk has to consume the whole name, not stop at the first segment
   * that happens to look like a key.
   */
  assert.deepEqual(configPathForEnv('AGENTCO_BUDGETS_KNOWLEDGE_NODE_TOKENS'), [
    'budgets',
    'knowledge_node_tokens',
  ]);
  assert.deepEqual(configPathForEnv('AGENTCO_LIBRARY_EXTRACT_TIMEOUT_MS'), [
    'library',
    'extract_timeout_ms',
  ]);
  assert.deepEqual(configPathForEnv('AGENTCO_ALLOW_CORE_PROMPT_EDIT'), ['allow_core_prompt_edit']);
});
