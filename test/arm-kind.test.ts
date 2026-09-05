
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

/**
 * `keyDead` — the ONE condition that paints a node red — travels the same
 * three-place road as `armKind`, and fails the same silent way: declared on one
 * side, never assigned or never read on the other, and the diagram simply stays
 * green while a credential is dead. The `cli` case on 09/01 is what that looks
 * like when nobody is watching. → `office.ts §keyDeadOf`
 */
test('🔴 `keyDead` is declared on BOTH sides of the wire', () => {
  assert.match(read('src/core/office.ts'), /keyDead\?:\s*string;/, 'missing on the server CanvasNode');
  assert.match(read('web/src/lib/types.ts'), /keyDead\?:\s*string;/, 'missing on the browser CanvasNode');
});

test('🔴 the server ACTUALLY assigns `keyDead`, and reads it from the OAuth store', () => {
  const src = read('src/core/office.ts');
  // Declaring the field and never filling it in leaves a diagram that can
  // never go red — the exact third rung of "spec says done · code exists ·
  // has anyone called it".
  assert.match(src, /const keyDead = n\.server \? keyDeadOf\(n\.server\)/, 'the node never gets the field');
  assert.match(src, /oauth\?\.\[s\]\?\.dead/, 'keyDeadOf does not read `dead` from the OAuth store');
});

test('🔴 the browser ACTUALLY paints it — a field nobody renders is a field that lies', () => {
  assert.match(read('web/src/canvas/Canvas.tsx'), /is-keydead/, 'no class is put on the node');
  assert.match(read('web/src/canvas/canvas.css'), /\.node\.is-keydead \.node-box/, 'the class has no style');
  // The border alone is a riddle: the node has to SAY why it went red.
  assert.match(read('web/src/canvas/NodeShape.tsx'), /node\.armKeyDead/, 'the node never states the reason');
});
