
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'oauth.ts');

const ALLOWED_IMPORTS: readonly RegExp[] = [
  /^node:/,
  /^\.\.\/i18n\/index\.js$/,
];

test('⭐ oauth.ts only imports from the allowlist — the escape hatch stays intact', () => {
  const code = fs.readFileSync(SRC, 'utf8');
  const bad: string[] = [];
  for (const m of code.matchAll(/(?:^|\s)(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1]!;
    if (!ALLOWED_IMPORTS.some((re) => re.test(spec))) bad.push(spec);
  }
  assert.deepEqual(bad, [], `oauth.ts pulls in a dependency outside the allowlist: ${bad.join(', ')}`);
});

test('oauth.ts does not mention any model vendor name — not even in types', () => {
  const code = fs.readFileSync(SRC, 'utf8');
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const vendor of ['anthropic', 'claude-agent-sdk', 'openai', 'groq']) {
    assert.equal(
      noComments.toLowerCase().includes(vendor),
      false,
      `oauth.ts code mentions "${vendor}" — it must stay neutral about which agent runtime runs it`,
    );
  }
});
