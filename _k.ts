/**
 * Phân loại comment tiếng Việt theo LOẠI, để trả lời câu "xoá hết thì mất gì".
 *
 * Ba nhóm, và chúng khác nhau về giá trị chứ không chỉ về hình dạng:
 *  · box    — khối `┌─ … ─┐`: nơi repo này ghi ca hỏng, số đo, quyết định
 *  · jsdoc  — `/** … *\/` thường: hợp đồng của hàm, cạm bẫy, lý do
 *  · line   — `//` một dòng: phần lớn là chú giải cục bộ
 *
 * Đếm thêm dấu hiệu "đắt": dòng có số tiền, ngày tháng, số đo, hoặc trích lời user.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const VN =
  /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/;

/** Dấu hiệu một dòng mang BẰNG CHỨNG, không chỉ mang lời giải thích. */
const EVIDENCE = [
  /\$\d/, // số tiền thật
  /\d{2}\/\d{2}\b/, // ngày ca hỏng
  /\bđo\b|\bĐo\b|\bĐO\b/, // "đo được"
  /\d[\d.,]*\s*(token|lượt|dòng|ký tự|tool)/i,
  /\*"/, // trích nguyên văn lời user
  /user chốt|user báo|ca thật|CA THẬT|bug đã|đã dẫm|hồi quy/i,
];

const roots = process.argv.slice(2);
const files: string[] = [];
for (const r of roots) {
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  })(r);
}

let box = 0;
let jsdoc = 0;
let line = 0;
let evidence = 0;
let evidenceInBox = 0;

for (const f of files) {
  if (f.includes(`${path.sep}i18n${path.sep}`)) continue;
  const text = fs.readFileSync(f, 'utf8');
  const raw = text.split(/\r?\n/);
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const inString = new Set<number>();
  const visit = (n: ts.Node): void => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n) ||
      ts.isJsxText(n)
    ) {
      const s = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
      const e = sf.getLineAndCharacterOfPosition(n.getEnd()).line;
      for (let l = s; l <= e; l++) inString.add(l + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  let insideBox = false;
  raw.forEach((l, i) => {
    if (/[┌╔]─|[┌╔]═/.test(l)) insideBox = true;
    const wasBox = insideBox;
    if (/[└╚]─|[└╚]═/.test(l)) insideBox = false;
    if (!VN.test(l) || inString.has(i + 1)) return;
    const isEvidence = EVIDENCE.some((re) => re.test(l));
    if (isEvidence) evidence++;
    if (wasBox) {
      box++;
      if (isEvidence) evidenceInBox++;
    } else if (/^\s*(\/\*\*|\*)/.test(l)) jsdoc++;
    else line++;
  });
}

const total = box + jsdoc + line;
const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
console.log(`${'loai'.padEnd(28)} ${'dong'.padStart(7)} ${'ty le'.padStart(7)}`);
console.log(`${'khoi khung ┌─┐'.padEnd(28)} ${String(box).padStart(7)} ${pct(box).padStart(7)}`);
console.log(`${'jsdoc thuong'.padEnd(28)} ${String(jsdoc).padStart(7)} ${pct(jsdoc).padStart(7)}`);
console.log(`${'// mot dong'.padEnd(28)} ${String(line).padStart(7)} ${pct(line).padStart(7)}`);
console.log(`${'TONG'.padEnd(28)} ${String(total).padStart(7)}`);
console.log(
  `\nmang BANG CHUNG (tien/ngay/so do/loi user): ${evidence} dong (${pct(evidence)})` +
    `\n  trong do nam trong khoi khung: ${evidenceInBox}`,
);
