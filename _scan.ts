import fs from 'node:fs';
import ts from 'typescript';

const VN =
  /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/;

const f = process.argv[2]!;
const text = fs.readFileSync(f, 'utf8');
const raw = text.split(/\r?\n/);
const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lines = new Set<number>();
const visit = (n: ts.Node): void => {
  if (
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateHead(n) ||
    ts.isTemplateMiddle(n) ||
    ts.isTemplateTail(n) ||
    ts.isJsxText(n)
  ) {
    if (VN.test(n.getText(sf))) {
      const s = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
      const e = sf.getLineAndCharacterOfPosition(n.getEnd()).line;
      for (let l = s; l <= e; l++) {
        if (VN.test(raw[l] ?? '') && !/i18n-allow-vietnamese/.test(raw[l] ?? '')) lines.add(l + 1);
      }
    }
  }
  ts.forEachChild(n, visit);
};
visit(sf);
const sorted = [...lines].sort((a, b) => a - b);
const blocks: number[][] = [];
for (const l of sorted) {
  const last = blocks[blocks.length - 1];
  if (last && l <= last[last.length - 1]! + 2) last.push(l);
  else blocks.push([l]);
}
for (const b of blocks) {
  console.log(`\n@@ ${b[0]}-${b[b.length - 1]}`);
  for (let l = b[0]!; l <= b[b.length - 1]!; l++) console.log(`${l}: ${raw[l - 1]}`);
}
console.log(`\nTOTAL ${lines.size} lines in ${blocks.length} blocks`);
