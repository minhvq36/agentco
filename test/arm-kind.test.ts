
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');

function union(src: string, re: RegExp, where: string): string[] {
  const m = re.exec(src);
  assert.ok(m, `arm-kind declaration not found in ${where} — was it renamed?`);
  const found = [...m![1]!.matchAll(/'([a-z]+)'/g)].map((x) => x[1]!);
  assert.ok(found.length >= 2, `${where}: read out ${found.length} values, that's surely wrong`);
  return found;
}

const PLACES: { where: string; values: string[] }[] = [
  {
    where: 'src/core/office.ts §armKind (the server decides the node shape on the diagram)',
    values: union(read('src/core/office.ts'), /armKind\?:\s*([^;]+);/, 'office.ts'),
  },
  {
    where: 'web/src/lib/types.ts §CanvasNode.armKind (browser-side type)',
    values: union(read('web/src/lib/types.ts'), /armKind\?:\s*([^;]+);/, 'types.ts'),
  },
  {
    where: 'web/src/components/ArmIcon.tsx §ArmKind (the place that PICKS the icon)',
    values: union(read('web/src/components/ArmIcon.tsx'), /type ArmKind\s*=\s*([^;]+);/, 'ArmIcon.tsx'),
  },
];

test('the three arm-kind declarations match value for value', () => {
  const [first, ...rest] = PLACES;
  for (const p of rest) {
    assert.deepEqual(
      [...p.values].sort(),
      [...first!.values].sort(),
      `mismatch:\n  ${first!.where}\n    → ${first!.values.join(' | ')}\n  ${p.where}\n    → ${p.values.join(' | ')}`,
    );
  }
});

test("'cli' is present in all three — this is exactly the value that got missed on 09/01", () => {
  for (const p of PLACES) assert.ok(p.values.includes('cli'), `'cli' missing in ${p.where}`);
});

test('🔴 the server ACTUALLY assigns `cli`, not just declares the type', () => {
  const src = read('src/core/office.ts');
  assert.match(src, /armKind:\s*isCliArm\(/, 'office.ts does not assign `cli` for a CLI declaration');
  assert.match(src, /import \{ isCliArm \} from '\.\/cli-arm\.js'/, 'missing import — this will break at build time');
});
