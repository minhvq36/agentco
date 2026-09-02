/**
 * CẮM MỘT CÁNH TAY — hộp thoại ba bước. → docs/SPEC-arms.md §6e–§6h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO BA BƯỚC, VÀ VÌ SAO BƯỚC 3 BẮT BUỘC                                │
 * │                                                                          │
 * │   1. Chọn        thẻ danh mục hiện SẴN ở màn đầu — đó là toàn bộ nghĩa    │
 * │                  của "rút ra xài được ngay". Không kéo thả: canvas có tự  │
 * │                  sắp + nút "Sắp xếp lại", nên kéo thả HỨA một quyền mà    │
 * │                  nút bên cạnh lấy lại. → §6e                             │
 * │   2. Chìa & Thử  KHÔNG cho Lưu khi chưa Thử thành công một lần. Người     │
 * │                  non-code không cần hiểu MCP — họ cần thấy dấu ✓.        │
 * │   3. Giao cho ai BẮT BUỘC. Node không dây là NODE CHẾT: hiện trên sơ đồ,  │
 * │                  trông như đã xong, không ai dùng được — và người dùng    │
 * │                  vừa bấm Lưu và thấy ✓ sẽ KHÔNG đoán ra là còn phải kéo   │
 * │                  một sợi dây. Đúng lớp lỗi "hệ thống nói dối về trạng     │
 * │                  thái của chính nó".                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, FolderOpen, Loader2, Trash2, TriangleAlert, X } from 'lucide-react';

import { ArmIcon } from '@/components/ArmIcon';
/**
 * KHỐI RIÊNG CỦA TỪNG HÃNG — mỗi cái một file trong `components/arm/`.
 * (user chốt 28/08: *"custom khá nhiều để khớp với từng provider… sắp xếp lại"*)
 *
 * Bốn khối này chỉ hiện khi mục danh mục **khai** thứ tương ứng (`deviceLogin`,
 * `scope`, `repoScan`) — tức chúng là **dữ liệu quyết định**, không phải nhánh
 * theo tên hãng. Tách ra để lần sau sửa GitHub thì mở đúng một file, và để hộp
 * thoại thôi vừa là bộ điều phối vừa là chỗ vẽ mọi thứ.
 */
import { DeviceCode } from '@/components/arm/DeviceCode';
import { OwnClient } from '@/components/arm/OwnClient';
import { RepoScan } from '@/components/arm/RepoScan';
import { ScopeBox } from '@/components/arm/ScopeBox';
import type { DeviceLogin, RepoScanState } from '@/components/arm/types';

import { Button } from '@/components/ui/button';
import { ConfirmDelete } from '@/components/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/misc';
import { api, ApiError } from '@/lib/api';
import {
  alignExample,
  blankAct,
  cliCount,
  cliDecl,
  cliProblems,
  declToDraft,
  draftToDecl,
  dupIds,
  isCliPaste,
  safeJson,
  sampleAct,
  slots,
  slugId,
  toArgv,
  type CliDraft,
} from '@/lib/cli-form';
import { fault, pretty, tokens } from '@/lib/json-paint';
import { actions, useApp } from '@/lib/store';
import type { CatalogArm, InstalledArm, OAuthAccount, ProbeResult } from '@/lib/types';

/** Câu phụ nói CÁI GIÁ — người dùng chọn theo công sức, không theo tên hãng. */
const PRICE_SAY: Record<CatalogArm['price'], string> = {
  none: 'không cần chìa',
  keys: 'cần 1 chìa',
  login: 'cần đăng nhập',
};

/**
 * Ba nấc quyền, nói bằng HẬU QUẢ chứ không bằng từ vựng MCP.
 *
 * Người dùng không biết `destructiveHint` là gì, và không cần biết. Thứ họ cần
 * quyết là *"nhân viên này có được sửa cái tôi đã viết không"*. → §6j
 */
/** Bản NGẮN của `TIER_SAY.name` — dùng cho huy hiệu trong danh sách chật. */
const LEVEL_SAY: Record<'read' | 'add' | 'full', string> = {
  read: 'chỉ đọc',
  add: 'đọc + thêm mới',
  full: 'toàn quyền',
};

const TIER_SAY: Record<'read' | 'add' | 'full', { name: string; help: string }> = {
  read: { name: 'Chỉ đọc', help: 'Tìm và đọc. Không tạo, không sửa, không xoá gì cả.' },
  add: {
    name: 'Đọc + Thêm mới',
    help: 'Tạo được trang/mục mới, nhưng không đụng tới thứ đã có sẵn.',
  },
  full: {
    name: 'Toàn quyền',
    help: '⚠ Sửa và xoá nội dung đang có.',
  },
};

/** Thẻ chọn LOẠI ở bước 1. Câu phụ nói người dùng phải làm gì tiếp, không nói kỹ thuật. */
function TypeCard({
  icon,
  name,
  say,
  onClick,
}: {
  /** Hình, KHÔNG phải emoji: cùng bộ với mọi nấc sau. → `ArmIcon.tsx` */
  icon: ReactNode;
  name: string;
  say: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-line px-3 py-4 text-left transition hover:border-accent hover:bg-accent-soft"
    >
      <div className="text-muted">{icon}</div>
      <div className="mt-1.5 text-[13px] font-medium">{name}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted">{say}</div>
    </button>
  );
}

/*
  `nextFreeId` đã BỎ (23/08). Nó tồn tại để né trùng mã khi mã là do người dùng
  đặt — giờ mã là BĂM cấu hình, nên "trùng" nghĩa là "đúng cùng một thứ", và
  câu trả lời không còn là đặt tên khác mà là DÙNG LẠI. → SPEC-arms.md §6i
*/

/** Thư mục người dùng rời đi lần trước — bộ chọn mở lại ĐÚNG ĐÓ, không về ổ đĩa. */
const LAST_DIR = 'agentco.lastBrowseDir';

/**
 * BỀ RỘNG DÙNG CHUNG của hai hộp thoại ở file này. (user 01/09: bộ chọn thư mục
 * *"hơi dài"* — nó đang 64rem trong khi hộp thoại mở ra nó chỉ 46rem.)
 *
 * ⚠ MỘT hằng số, không phải hai chuỗi giống nhau: bộ chọn **bật ra từ trong**
 * hộp thoại cắm cánh tay, nên một cái rộng hơn cái kia thì mỗi lần mở là cả
 * khung nhảy ra rồi thụt vào. Ràng buộc thật ở đây không phải "46rem" — nó là
 * *"bộ chọn không bao giờ rộng hơn hộp thoại đã mở nó"*, và cách duy nhất giữ
 * được một ràng buộc giữa hai giá trị là đừng có hai giá trị.
 * [[agentco-count-mechanisms]]
 */
const DIALOG_W = 'w-[min(46rem,94vw)]';

/** So như server: bỏ gạch chéo cuối, thống nhất `/`, bỏ phân biệt hoa thường. */
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Thư mục này đã là cánh tay nào của văn phòng NÀY chưa? Trả tên nó.
 *
 * Bản khách của `catalog.ts §coveredBy`. ⚠ Nó KHÔNG thay chốt server — client
 * bỏ qua được, nên luật thật vẫn phải nằm ở server. Nó chỉ dời câu trả lời từ
 * bước cuối lên bước một.
 */
function clashingArm(folder: string, installed: InstalledArm[], officeId: string | null): string | undefined {
  const want = normPath(folder);
  for (const a of installed) {
    if (!a.usedBy.some((u) => u.office === officeId)) continue;
    const args = (a.config as { args?: unknown })?.args;
    if (!Array.isArray(args)) continue;
    if (args.some((x) => typeof x === 'string' && normPath(x) === want)) return a.id;
  }
  return undefined;
}

/**
 * Danh sách "đã cắm ở văn phòng khác": lọc, rồi **ĐANG DÙNG LÊN TRÊN, MỒ CÔI
 * XUỐNG ĐÁY**. (user chốt 25/08)
 *
 * > *"để nó phía trên chiếm mất diện tích chú ý"*
 *
 * Đúng cách đọc về danh sách này: nó là chỗ **dùng lại**, không phải chỗ dọn
 * dẹp. Mục không ai dùng chỉ có mặt để còn xoá được — xếp lẫn vào giữa là bắt
 * người dùng lọc bằng mắt mỗi lần cắm.
 *
 * ⚠ Sắp theo HAI khoá. Thiếu khoá thứ hai thì hai mục cùng nhóm đổi chỗ nhau
 * giữa hai lần mở hộp thoại: `listArms` đi theo thứ tự khoá trong yaml, mà thứ
 * tự đó không có gì bảo đảm — và một danh sách tự nhảy chỗ là thứ làm người
 * dùng bấm nhầm.
 *
 * ⚠ MỘT hàm, hai chỗ gọi (lúc mở, và sau khi xoá hẳn). Sắp xếp ở một chỗ rồi
 * quên chỗ kia là danh sách tự sắp lại ngay dưới tay người vừa bấm.
 *
 * ⚠ Đây chỉ là thứ tự NỀN. Thứ tự người dùng thật sự nhìn thấy do `byKind` chốt
 * lúc vẽ, vì nó cần `catalog` — thứ chưa về lúc hàm này chạy.
 */
function forList(arms: InstalledArm[], officeId: string | null): InstalledArm[] {
  return arms
    .filter((a) => !a.usedBy.some((u) => u.office === officeId))
    .sort((a, b) => Number(a.orphan) - Number(b.orphan) || a.label.localeCompare(b.label, 'vi'));
}

/**
 * BA LOẠI, và một cánh tay đã cắm thuộc đúng một loại. → §6e
 *
 * Suy từ `catalog` chứ không từ hình dạng cấu hình: một mục danh mục có
 * `folders` thì nó LÀ cánh tay thư mục, kể cả khi mai ta đổi nó sang HTTP.
 * Không có `catalog` ⇒ người dùng tự dán ⇒ `custom`.
 */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ô DÁN JSON — tô màu, in lại cho dễ đọc, và CHỈ ĐÚNG CHỖ HỎNG. (user 31/08)│
 * │                                                                          │
 * │ Ba việc, và chỉ việc thứ ba mới báo lỗi được:                            │
 * │  ① màu    tên trường ≠ giá trị. Trung tính, không "hội chợ" — người dùng  │
 * │           là dân văn phòng, không phải lập trình viên đọc code cả ngày.   │
 * │  ② in lại xuống dòng + thụt lề 2. **CHỈ khi JSON hợp lệ** — không có cây  │
 * │           thì không in lại được, và tự sửa hộ một khối hỏng là cách chắc  │
 * │           chắn nhất làm họ mất chỗ đang dở.                              │
 * │  ③ lỗi    `JSON.parse` ném kèm **vị trí** ⇒ dòng/cột + một câu tiếng      │
 * │           người. Đây mới là thứ chỉ được chỗ hỏng; màu thì không.         │
 * │                                                                          │
 * │ ⚠ IN LẠI Ở ĐÂU: lúc **dán** và lúc **rời ô**, KHÔNG phải mỗi lần gõ —     │
 * │ in lại giữa lúc đang gõ là nhảy con trỏ, và người dùng mất chỗ.           │
 * │                                                                          │
 * │ ⚠ VÌ SAO PHẢI PHỦ MỘT LỚP `<pre>`: `<textarea>` không tô màu từng chữ     │
 * │ được — đó là giới hạn của thẻ, không phải lựa chọn. Nên chữ thật để trong │
 * │ suốt, lớp màu nằm ngay dưới, hai lớp phải **cùng font, cùng cỡ, cùng      │
 * │ padding, cùng `white-space`** và cuộn theo nhau. Lệch một thuộc tính là   │
 * │ chữ và màu rời nhau.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const TOK: Record<string, string> = {
  // Xanh = tên, nâu = giá trị. Token của theme, KHÔNG phải mã màu cứng — xem
  // khối chú thích ở `index.css §--color-jkey`.
  key: 'text-jkey',
  str: 'text-jval',
  num: 'text-jval',
  lit: 'text-jval',
  punc: 'text-muted',
  ws: '',
};

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 MỘT CHUỖI CLASS, HAI THẺ — bug user báo 01/09: *"text area + phủ bị   │
 * │ lỗi lòi chữ ra ngoài cái khung"*.                                        │
 * │                                                                          │
 * │ Ô tô màu là **hai lớp chồng khít**: `<pre>` vẽ màu, `<textarea>` trong    │
 * │ suốt nằm trên. Chồng khít chỉ đúng khi **mọi thứ quyết định chỗ xuống    │
 * │ dòng** giống hệt nhau: font · cỡ · leading · padding · viền · bo góc ·   │
 * │ và **bề rộng vùng chữ**. Bản trước gõ tay hai bộ class ⇒ chúng lệch ở ba │
 * │ chỗ (`rounded-md` vs `rounded-lg`, `text-sm` của `Textarea` bị đè bằng   │
 * │ một class khác, và không bên nào chừa chỗ cho thanh cuộn).               │
 * │                                                                          │
 * │ ⭐ Thủ phạm chính là vế cuối: khi chữ đủ dài, **textarea mọc thanh cuộn** │
 * │ ⇒ vùng chữ của nó hẹp lại ~15px, còn `<pre>` thì không ⇒ hai lớp xuống   │
 * │ dòng ở hai chỗ khác nhau, và độ lệch **cộng dồn theo từng dòng**. Đó là  │
 * │ thứ nhìn ra thành "chữ lòi khỏi khung". `scrollbar-gutter: stable` chừa  │
 * │ chỗ sẵn ở CẢ HAI, nên bề rộng không đổi dù có cuộn hay không.            │
 * │                                                                          │
 * │ ⇒ Một hằng số cho phần chung. Hai bản gõ tay của cùng một sự thật sớm    │
 * │ muộn cũng lệch — ở đây "sớm muộn" là ngay lần đầu có người dán một khối  │
 * │ JSON dài. [[agentco-count-mechanisms]]                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * 🔴 VÒNG HAI (01/09) — bản vá đầu KHÔNG đủ, và lý do đáng nhớ hơn bản vá.
 *
 * Bản đầu cho mỗi lớp một `scrollbar-gutter: stable` rồi tin là hai bề rộng sẽ
 * bằng nhau. Chúng **không** bằng: `<textarea>` là `overflow-y: auto` (một
 * scroll container thật, có gutter), `<pre>` là `overflow: hidden` — trình duyệt
 * **không chừa gutter** cho nó. Lệch ~15px, và độ lệch cộng dồn theo từng dòng
 * ⇒ đúng triệu chứng user tả: *"cái thực edit ngắn hơn một chút"*.
 *
 * ⇒ **Bỏ hẳn cuộc đua bề rộng thay vì đi đồng bộ nó: MỘT thanh cuộn, đặt trên
 * KHUNG CHUNG.** Textarea tự cao bằng nội dung (`overflow: hidden`), `<pre>` cao
 * theo nội dung, cả hai nằm trong một khung cuộn duy nhất. Bề rộng hai lớp bằng
 * nhau **theo cấu tạo**, không phải nhờ hai khai báo trùng khớp.
 *
 * 🎁 Và nó **xoá luôn một cơ chế**: không còn `onScroll` đồng bộ `scrollTop` —
 * hai lớp cuộn cùng nhau vì chúng ở trong cùng một khung. Một cơ chế đồng bộ
 * bị xoá là một chỗ hết lệch được. [[agentco-count-mechanisms]]
 *
 * ⚠ `<pre>` để `top-0 inset-x-0` chứ KHÔNG `inset-0`: `bottom-0` ép chiều cao
 * bằng **phần nhìn thấy** của khung cuộn, nên nội dung dài hơn sẽ bị cắt.
 */
const JSON_TEXT = 'font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words px-3 py-2';

/**
 * MỘT DÒNG CỦA FORM: **nhãn bên trái, ô nhập bên phải**. (user chốt 01/09)
 *
 * ⚠ `items-start` + `pt-2` chứ không `items-center`: ô bên phải có thể là một
 * `Textarea` hai dòng hoặc kéo theo một dãy chip argv, và căn giữa thì nhãn trôi
 * xuống giữa khối — mắt mất mốc quét dọc, thứ duy nhất làm bố cục hai cột đáng
 * giá hơn nhãn nằm trên.
 *
 * ⚠ Cột nhãn **rộng cố định**, không `auto`: `auto` cho mỗi dòng một bề rộng
 * theo chữ của chính nó, và khi đó hai cột không còn là hai cột.
 */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  /** Câu phụ dưới nhãn — chỗ nói *vì sao*, để nhãn giữ được một từ. */
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 grid grid-cols-[150px_1fr] gap-3">
      <div className="pt-2">
        <Label htmlFor={htmlFor} className="mb-0 text-ink">
          {label}
        </Label>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CÚ PHÁP CHƯA CÓ Ô TRỐNG — so nó với dòng Ví dụ để **CHỈ RA** chỗ nên có. │
 * │                                                                          │
 * │ Đây là chỗ ô Ví dụ trả lời được một câu mà không màn hình nào khác trả    │
 * │ lời được: *"cái nào trong dòng lệnh này là thứ thay đổi mỗi lần?"*        │
 * │ Người dùng biết câu trả lời — họ vừa chạy hai lần với hai giá trị — nhưng │
 * │ họ **không biết rằng ta cần biết**. Bắt họ tự nghĩ ra khái niệm "tham số" │
 * │ rồi tự gõ `{…}` là bắt họ học từ vựng của máy; so hai dòng lệnh thật thì  │
 * │ không.                                                                   │
 * │                                                                          │
 * │ ⚠ Nó CHỈ ĐƯỜNG, không tự sửa. Tự thay `{…}` vào cú pháp hộ là đổi thứ    │
 * │ người dùng vừa gõ, mà đây là một PHÉP ĐOÁN — cùng luật với `toArgv`:      │
 * │ đoán thì được, nhưng người dùng phải là người bấm.                       │
 * │                                                                          │
 * │ ⚠ Và nó im khi hai dòng giống hệt: một lệnh cố định là chuyện bình        │
 * │ thường, không phải thiếu sót cần nhắc.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ExampleNoSlot({ line, example }: { line: string; example: string }) {
  if (!example.trim() || !line.trim()) return null;
  const a = toArgv(line);
  const b = toArgv(example);
  if (a.length !== b.length) {
    return (
      <p className="mt-1 text-[11px] text-muted">
        Ví dụ có {b.length} mảnh, cú pháp có {a.length} — hai dòng này không cùng một lệnh.
      </p>
    );
  }
  const at = a.map((_, i) => i).filter((i) => a[i] !== b[i]);
  if (!at.length) return null;
  if (at.length > 1) {
    return (
      <p className="mt-1 text-[11px] text-muted">
        Hai dòng khác nhau ở {at.length} chỗ. Chỗ nào thay đổi mỗi lần chạy thì đổi nó thành{' '}
        <code className="rounded bg-accent-soft px-1">{'{ten_o_trong}'}</code> ở dòng Cú pháp.
      </p>
    );
  }
  const i = at[0]!;
  return (
    <p className="mt-1 text-[11px] text-muted">
      Khác cú pháp ở <code className="rounded bg-accent-soft px-1">{a[i]}</code> →{' '}
      <code className="rounded bg-accent-soft px-1">{b[i]}</code>. Nếu đây là chỗ thay đổi mỗi lần
      chạy, đổi nó thành <code className="rounded bg-accent-soft px-1">{'{ten_o_trong}'}</code> ở dòng
      Cú pháp — nhân viên sẽ điền vào đó.
    </p>
  );
}

function JsonBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const back = useRef<HTMLPreElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const bad = fault(value);
  const toks = tokens(value);

  /**
   * Textarea cao đúng bằng nội dung — nó KHÔNG được tự cuộn, vì khung ngoài mới
   * là chỗ cuộn. Đặt `auto` trước khi đọc `scrollHeight`, nếu không nó chỉ tăng
   * và không bao giờ co lại khi người dùng xoá bớt dòng.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const tidy = (): void => {
    const out = pretty(value);
    if (out !== null) onChange(out);
  };

  return (
    <div>
      <div className="relative max-h-64 overflow-y-auto rounded-lg border border-line bg-paper focus-within:border-accent">
        <pre
          ref={back}
          aria-hidden
          className={`${JSON_TEXT} pointer-events-none absolute inset-x-0 top-0 m-0`}
        >
          {toks.map((t, i) => (
            <span key={i} className={TOK[t.t]}>
              {t.v}
            </span>
          ))}
          {'\n'}
        </pre>
        <Textarea
          ref={box}
          rows={1}
          autoFocus
          spellCheck={false}
          /**
           * 🔴 `caret-ink`, KHÔNG phải `caret-fg`. (bug user bắt 31/08:
           * *"lúc click vào để edit không thấy con trỏ nhấp nháy"*)
           *
           * Theme này khai `--color-ink`, nên **không có** utility `caret-fg` —
           * class đó bị bỏ qua im lặng, `caret-color` không bao giờ được đặt, và
           * nó thừa hưởng `color` của chính ô — mà `color` ở đây là
           * `transparent` (chữ thật phải trong suốt để lớp màu bên dưới hiện ra).
           * ⇒ **Con trỏ trong suốt.** Một class sai chính tả trong Tailwind
           * không báo lỗi ở đâu cả; nó chỉ lặng lẽ không tồn tại.
           */
          className={`${JSON_TEXT} relative block w-full resize-none overflow-hidden rounded-none border-0 bg-transparent text-transparent caret-ink focus:border-0`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={tidy}
          onPaste={() => {
            // Sau khi trình duyệt đã ghi chữ vào ô. `requestAnimationFrame`
            // thay `setTimeout(0)`: nó chạy sau lượt vẽ, không đua với React.
            requestAnimationFrame(() => requestAnimationFrame(tidy));
          }}
          placeholder={'Dán khối cấu hình MCP từ README của server, ví dụ:\n{ "command": "npx", "args": ["-y", "..."] }'}
        />
      </div>
      {bad && value.trim() !== '' && (
        <p className="mt-1 text-xs text-danger">
          {bad.line > 0 ? `Dòng ${bad.line}, cột ${bad.col}: ` : ''}
          {bad.say}
        </p>
      )}
    </div>
  );
}


type Kind = 'files' | 'service' | 'custom' | 'browser' | 'cli';

/**
 * ⚠ `cli` LÀ MỘT LOẠI RIÊNG, không phải một dạng của `custom`. (user 01/09)
 *
 * > *"Bỏ tất cả custom MCP gợi ý ở CLI, chỉ gợi ý CLI, vì bây giờ nó tách ra làm
 * > 2 trường phái khác nhau rồi"*
 *
 * Đúng, và nó là hệ quả bắt buộc của việc tách tab: từ lúc có hai thẻ ở bước 1
 * thì danh sách "dùng lại" phải tách theo đúng đường đó — bằng không, tab Lệnh
 * gợi ý một cánh tay HTTP mà chính nó **từ chối dán** ở cửa kia.
 *
 * ⚠ Hỏi theo `type === 'cli'` trên **chính cấu hình** — cùng câu hỏi
 * `core/cli-arm.ts §isCliArm` và `isCliPaste` hỏi, không phải luật thứ ba. Và
 * hỏi **trước** `a.catalog`: một tờ khai CLI không bao giờ có mục danh mục, nên
 * thứ tự này không đổi câu trả lời — nó chỉ làm nhánh CLI đọc được thành một dòng.
 */
function kindOf(a: InstalledArm, catalog: CatalogArm[]): Kind {
  if ((a.config as { type?: unknown })?.type === 'cli') return 'cli';
  if (!a.catalog) return 'custom';
  const entry = catalog.find((c) => c.id === a.catalog);
  return entry?.shape === 'browser' ? 'browser' : entry?.folders ? 'files' : 'service';
}

/**
 * Logo hãng của một mục — lấy từ DANH MỤC, không từ một bảng trong thư mục web.
 *
 * Ô này rỗng là chuyện bình thường (hãng chưa có logo, hoặc mục không có hãng):
 * `ArmIcon` ngã về hình theo loại. → `catalog.ts §brand.mark` · §11c
 */
function markOf(catalogId: string | undefined, catalog: CatalogArm[]): string | undefined {
  return catalogId ? catalog.find((c) => c.id === catalogId)?.brand.mark : undefined;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THỨ TỰ TRONG DANH SÁCH DÙNG LẠI: **mồ côi → LOẠI → tên**. (user 27/08)   │
 * │                                                                          │
 * │ > *"trash (không được dùng) và không trash cũng order theo thứ tự: chứ   │
 * │ >  đừng để lộn xộn. sắp xếp theo type provider → file → custom"*         │
 * │                                                                          │
 * │ Khoá 1 giữ nguyên luật cũ (đang dùng lên trên, mồ côi xuống đáy — 25/08).│
 * │ Khoá 2 là thứ vừa thêm: TRONG mỗi nhóm, gom theo loại. Khoá 3 (tên) phải │
 * │ còn, vì `listArms` đi theo thứ tự khoá trong yaml — thiếu nó thì hai mục │
 * │ cùng loại đổi chỗ nhau giữa hai lần mở, và danh sách tự nhảy chỗ là thứ  │
 * │ làm người dùng bấm nhầm.                                                 │
 * │                                                                          │
 * │ ⚠ SẮP LÚC VẼ, không sắp lúc tải. `catalog` và `arms` về bằng HAI lượt    │
 * │ gọi mạng song song, nên sắp ngay sau `api.arms()` là sắp bằng một danh   │
 * │ mục còn rỗng ⇒ `kindOf` trả `custom` cho tất cả ⇒ đúng cái lộn xộn đang  │
 * │ phải sửa, và nó sẽ KHÔNG BAO GIỜ tự sắp lại. Vẽ lại thì rẻ; sai thứ tự   │
 * │ một lần rồi đứng im thì không sửa được.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const KIND_ORDER: Record<Kind, number> = { service: 0, browser: 1, files: 2, cli: 3, custom: 4 };

function byKind(arms: InstalledArm[], catalog: CatalogArm[]): InstalledArm[] {
  return [...arms].sort(
    (a, b) =>
      Number(a.orphan) - Number(b.orphan) ||
      KIND_ORDER[kindOf(a, catalog)] - KIND_ORDER[kindOf(b, catalog)] ||
      a.label.localeCompare(b.label, 'vi'),
  );
}

export function ArmDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const officeId = useApp((s) => s.officeId);
  const canvas = useApp((s) => s.canvas);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  /** Bước 1 có bốn mặt: chọn LOẠI → thư mục / dịch vụ / dán cấu hình. */
  const [pane, setPane] = useState<'type' | 'files' | 'catalog' | 'paste' | 'cli'>('type');
  /**
   * Tab **Lệnh** — soạn tờ khai CLI bằng form. → SPEC-arms §16
   *
   * ⚠ Nó KHÔNG đẻ đường lưu mới: form chỉ sinh ra **đúng chuỗi JSON** mà đường
   * dán đã dùng, rồi đi tiếp bằng chính `paste` + bước 2. Một đường lưu thứ hai
   * là chỗ hai màn hình sớm muộn lưu ra hai thứ khác nhau.
   */
  const [acts, setActs] = useState<CliDraft[]>([blankAct()]);
  /** Xem/sửa dạng JSON. Hai chiều — form là nguồn, JSON dán vào thì đọc ngược. */
  const [cliJson, setCliJson] = useState<string | null>(null);
  /**
   * Thư mục CHUNG của cả cánh tay CLI — xem `cli-form.ts §draftToDecl`.
   * `''` = thư mục văn phòng.
   */
  const [cliCwd, setCliCwd] = useState('');
  /**
   * Đã qua màn thư mục chưa. Hai state chứ không suy từ `cliCwd !== ''`: **"dùng
   * thư mục văn phòng"** là một câu trả lời hợp lệ và nó để `cliCwd` rỗng — suy
   * ra thì người bấm nút đó bị đá về lại đúng màn họ vừa trả lời xong.
   */
  const [cliReady, setCliReady] = useState(false);
  /** Bộ chọn thư mục của tab Lệnh đang mở. */
  const [browsing, setBrowsing] = useState(false);
  /**
   * Tờ khai đang xem ở tab JSON, đọc ngược. `null` = không đang xem JSON, hoặc
   * JSON hỏng. Dùng cho HAI việc: khoá nút "← Về form" khi `mixed`, và **nói
   * đúng thư mục** ở thanh trên.
   */
  const cliBack = cliJson === null ? null : declToDraft(safeJson(cliJson));
  const cliMixed = cliBack?.mixed === true;
  /**
   * 🔴 THƯ MỤC THANH TRÊN PHẢI ĐỌC TỪ THỨ ĐANG SỬA. (bug user bắt 01/09)
   *
   * Ở chế độ JSON, `cliDecl` lấy **khối JSON**, không lấy `cliCwd` — nên vẽ
   * `cliCwd` ở thanh trên là hiện một giá trị **không có tác dụng gì**, và tệ hơn
   * là nút "Đổi…" bên cạnh nó sửa đúng cái giá trị vô tác dụng ấy. Đó là giao
   * diện nói dối về trạng thái của chính nó — đúng lớp lỗi tôi vừa vá ở chỗ khác.
   */
  const shownCwd = cliJson === null ? cliCwd : (cliBack?.cwd ?? '');
  /**
   * Mã lệnh trùng nhau — tính trên **thứ sẽ được lưu**, nên nó đúng ở cả hai chế
   * độ (form và JSON) bằng một phép tính, không phải hai.
   *
   * ⚠ Đây là **hàng rào thứ nhất trong hai**. Hàng rào thật nằm ở
   * `server.ts §resolveArm → parseCliArm` — cửa CHUNG của nút Thử và nút Xong,
   * nên một tab bị treo/đua tay hay một client tự viết vẫn không lọt. Cái ở đây
   * chỉ để người dùng **thấy trước khi bấm**, không phải để giữ luật.
   */
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ĐIỀU KIỆN ĐI TIẾP — MỘT phép tính, dùng cho **cả** nút mờ/sáng lẫn các   │
   * │ dòng đỏ. (user 01/09: *"phải kiểm tra form khi tất cả các lệnh đều valid │
   * │ mới cho tiếp tục"*)                                                      │
   * │                                                                          │
   * │ Nút mờ theo một phép tính còn dòng đỏ theo một phép tính khác là ca "nút │
   * │ mờ mà không chỗ nào đỏ" — người dùng phải đi dò từng ô để đoán vì sao.   │
   * │                                                                          │
   * │ ⚠ Ở chế độ JSON, hàng để soi là **các lệnh đọc ngược từ khối JSON**, chứ │
   * │ không phải `acts`: thứ sắp được lưu là khối đó. Soi `acts` ở đó là soi   │
   * │ một bản nháp không ai lưu.                                               │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const cliOut = pane === 'cli' ? cliDecl(acts, cliCwd, cliJson) : null;
  const cliRows = cliJson === null ? acts : (cliBack?.acts ?? []);
  const cliBad = pane === 'cli' ? cliProblems(cliRows) : [];
  const badIds = dupIds(cliOut);
  /** Đủ điều kiện lưu chưa. `cliOut === null` = khối JSON đang hỏng. */
  const cliOk = cliCount(cliOut) > 0 && !cliBad.length && !badIds.length;
  const [catalog, setCatalog] = useState<CatalogArm[]>([]);
  const [installed, setInstalled] = useState<InstalledArm[]>([]);

  const [pick, setPick] = useState<CatalogArm | null>(null);
  /**
   * DÙNG LẠI một mục đã có trong sổ chung — mục thứ ba, ngang hàng với `pick`
   * và `paste`, chứ KHÔNG phải "dán cấu hình của nó rồi đi đường tự cắm".
   *
   * Bản cũ làm đúng cái sau, và nó hỏng ngay ở cánh tay HTTP đầu tiên (user
   * 25/08: Notion chạy ở *Cánh tay*, bấm dùng lại ở *Trợ lý cá nhân* → **401**).
   * Cấu hình trong sổ giữ ô trống `${NOTION_ACCESS_TOKEN}`; đường tự cắm không
   * biết nó là mục danh mục nào nên không hiện ô chìa nào; header bay đi nguyên
   * văn `Bearer ${…}`. → `company.ts §reuseArm`
   */
  const [reuse, setReuse] = useState<InstalledArm | null>(null);
  /** Đường B — dán cấu hình MCP. Không mục danh mục nào chặn ai. → §4c */
  const [paste, setPaste] = useState('');
  /**
   * Tên các server trong khối đang dán. `parsePaste` chỉ lấy **cái đầu** — khối
   * chú thích ở chỗ vẽ giải thích vì sao chuyện đó phải hiện lên màn hình.
   */
  const pasted = pane === 'paste' ? safeJson(paste) : null;
  const serverNames =
    pasted && pasted['mcpServers'] && typeof pasted['mcpServers'] === 'object'
      ? Object.keys(pasted['mcpServers'] as Record<string, unknown>)
      : [];
  const firstServer = serverNames[0] ?? '';
  const extraServers = serverNames.slice(1);
  /** Tài khoản đã đăng nhập cho mục đang chọn. Tên chìa, không bao giờ token. */
  const [accounts, setAccounts] = useState<OAuthAccount[]>([]);
  const [account, setAccount] = useState('');
  const [logging, setLogging] = useState(false);
  /**
   * Nấc quyền người dùng chọn. Mặc định **thấp nhất** — an toàn khi chưa ai chọn,
   * và nó cũng là nấc duy nhất luôn hợp lệ nếu server khai tử tế. → §6j
   */
  const [tier, setTier] = useState<'read' | 'add' | 'full'>('read');
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ NHÓM VIỆC ĐÃ TICK — và **chỉ hỏi ở nấc toàn quyền**. (user chốt 27/08)   │
   * │                                                                          │
   * │   *"default là chỉ đọc không cần pick gì, còn chọn toàn quyền thì có 1   │
   * │    list, default không tick"*                                            │
   * │                                                                          │
   * │ Vì sao đúng, chứ không chỉ vì user nói: **câu hỏi chỉ có sức nặng khi    │
   * │ được GHI**. Bắt người dùng cân nhắc năm ô lúc chỉ đọc là thu tiền chú ý  │
   * │ cho một quyết định không có hậu quả — họ tick bừa, và ta vừa dạy họ rằng │
   * │ mấy ô này tick bừa cũng được. Tới lúc nó thật sự nguy hiểm thì thói quen │
   * │ đã hình thành.                                                           │
   * │                                                                          │
   * │ Rỗng ⇒ **không gửi** ⇒ server rơi về nhóm `on: true` của danh mục        │
   * │ (`server.ts §armConfig`). Cố ý không gửi `[]`: rỗng ở đây nghĩa là "chưa  │
   * │ chọn", còn `[]` gửi đi lại có nghĩa "cấm hết" — hai chuyện khác nhau, và │
   * │ trộn chúng là dựng lại đúng ca *ô để trắng ≠ chìa rỗng* ở `filledKeys`.  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [groups, setGroups] = useState<string[]>([]);
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ Ô TICK CỦA MỤC — khác `groups` ở HAI chỗ, và cả hai đều cố ý:            │
   * │                                                                          │
   * │  ① Nó **có mặc định bật sẵn** (`option.on`), nên state phải được nạp lúc  │
   * │     chọn mục chứ không để rỗng. Rỗng ở đây KHÔNG có nghĩa "chưa chọn" —  │
   * │     người dùng bỏ tick hết là một lựa chọn hợp lệ, và phải gửi `[]` lên.  │
   * │  ② Nó hỏi ở **mọi nấc**, không riêng `full`: hai ô này nói về *cách chạy* │
   * │     chứ không về *quyền*, nên luật "chỉ hỏi khi được ghi" không áp vào.   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [options, setOptions] = useState<string[]>([]);
  /**
   * Trình duyệt và daemon có cùng máy không — dùng để **ẩn** ô `loopbackOnly`.
   *
   * ⚠ Đây CHỈ là chuyện giao diện. Cổng thật nằm ở server và đo bằng **địa chỉ
   * socket** (`server.ts §armCtx`), thứ client không giả được. Kiểm ở đây để nút
   * không thành câu đố; kiểm ở kia để nó không thành trang trí.
   */
  const sameMachine = /^(127\.|localhost$|\[::1\]$)/i.test(window.location.hostname);
  /**
   * Nạp mặc định cho ô tick mỗi khi đổi mục — **theo `pick`, không theo bốn chỗ
   * reset rải rác**. Bốn chỗ đó là bốn cơ hội quên một chỗ, và chỗ quên sẽ mang
   * lựa chọn của mục trước sang mục sau, im lặng.
   *
   * ⚠ Ô `loopbackOnly` không bao giờ được bật sẵn khi xem từ xa: nó sẽ bị server
   * từ chối, và người dùng chưa hề tick nó.
   */
  useEffect(() => {
    setOptions(
      (pick?.options ?? [])
        .filter((o) => o.on && (sameMachine || !o.loopbackOnly))
        .map((o) => o.id),
    );
  }, [pick, sameMachine]);
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BẢN CÀI APP — TRA TỰ ĐỘNG, 0 ký tự người dùng gõ. → SPEC-arms §5h·7o     │
   * │ (user chốt 27/08: *"Không gõ chữ gì, bấm thử ngay và thử tự động"*)      │
   * │                                                                          │
   * │ Ba trạng thái, và chúng **không gộp được**:                              │
   * │   `null`               chưa tra (chưa chọn tài khoản)                    │
   * │   `{failed:true}`      KHÔNG TRA ĐƯỢC → cho qua, nói thật                │
   * │   `{installed:[…]}`    tra được → rỗng thì CHẶN, có thì cho qua           │
   * │                                                                          │
   * │ Gộp `failed` với `installed: []` là hoặc chặn oan người đã cài (mạng      │
   * │ chập), hoặc thả người chưa cài. Hai chiều hỏng ngược nhau.                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [scan, setScan] = useState<RepoScanState>(null);
  const [scanning, setScanning] = useState(false);
  /**
   * Người dùng tự khẳng định đã cài, dù ta tra ra rỗng. → đường thoát bắt buộc.
   *
   * Vì sao phải có: `search user:<login>` **không thấy repo của tổ chức**, nên
   * "rỗng" không chứng minh "chưa cài gì cả". Chặn cứng ở đây là giam một người
   * đã làm đúng, mà giam thì không có đường ra nào khác ngoài đóng app.
   */
  const [anyway, setAnyway] = useState(false);
  /**
   * Ô "dùng app của bạn". `own` = công ty này đang đi bằng danh tính của HỌ.
   *
   * Hai state chứ không một: `clientId` là thứ đang gõ, `own` là thứ đã LƯU.
   * Suy `own` từ `clientId !== ''` thì huy hiệu "đang bật" sáng lên ngay lúc họ
   * mới gõ ký tự đầu — một cái nhãn nói về trạng thái chưa tồn tại.
   */
  const [clientId, setClientId] = useState('');
  const [own, setOwn] = useState(false);
  const [label, setLabel] = useState('');
  const [folders, setFolders] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});

  const [testing, setTesting] = useState(false);
  /** Đã chờ quá 6 giây — mốc để GIẢI THÍCH, không phải để đoán trước. */
  const [slow, setSlow] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState('');
  const [grant, setGrant] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** Mục mồ côi đang chờ xác nhận **xoá hẳn** — mức duy nhất không lấy lại được. */
  const [forget, setForget] = useState<InstalledArm | null>(null);
  /** Workspace đang chờ xác nhận GỠ. Server thu hồi chìa ở phía dịch vụ luôn. */
  const [dropWs, setDropWs] = useState<OAuthAccount | null>(null);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ XOÁ CHÌA KHỎI BỘ NHỚ NGAY KHI ĐÓNG — không đợi tới lần mở sau.           │
   * │ (user hỏi 26/08: *"đảm bảo nó không lưu bất cứ dấu vết gì trên FE"*)     │
   * │                                                                          │
   * │ Bản trước chỉ dọn lúc MỞ, nên giá trị chìa nằm lại trong state của React │
   * │ suốt cả phiên làm việc sau khi người dùng đã bấm Xong và đi làm việc      │
   * │ khác. Không có lý do nào để nó ở đó — hộp thoại đã gửi xong rồi.          │
   * │                                                                          │
   * │ ⚠ Nói cho đúng phạm vi, đừng bán quá lời: cái này KHÔNG chặn được kẻ đã  │
   * │ chạy mã trong tab của bạn (lúc đó họ đọc thẳng được ô input). Thứ nó thu │
   * │ hẹp là **cửa sổ thời gian** một chuỗi bí mật còn nằm trong heap và trong │
   * │ mọi bản chụp heap / công cụ dev / báo cáo lỗi tự động.                    │
   * │                                                                          │
   * │ Hàng rào THẬT nằm ở phía server và đã có: `listArms` trả **tên** chìa,   │
   * │ không bao giờ trả giá trị; `company.yaml` chỉ chứa ô trống `${TÊN}`; và  │
   * │ giá trị chỉ đi MỘT chiều — từ trình duyệt xuống `.state/secrets.json`,   │
   * │ không có route nào đọc ngược lên.                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  useEffect(() => {
    if (open) return;
    setKeys({});
    setPaste('');
    setProbe(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setPane('type');
    // Bộ chọn thư mục của tab Lệnh: mở lại hộp thoại mà nó còn treo thì người
    // dùng gặp một modal chồng modal chưa ai gọi.
    setBrowsing(false);
    setCliReady(false);
    setCliCwd('');
    setPick(null);
    setReuse(null);
    setPaste('');
    setLabel('');
    autoLabel.current = '';
    setFolders('');
    setKeys({});
    setProbe(null);
    setErr('');
    setGrant([]);
    setAccount('');
    setAccounts([]);
    setTier('read');
    setGroups([]);
    void api.armCatalog().then((r) => setCatalog(r.arms)).catch(() => undefined);
    /**
     * ⚠ LỌC NGAY Ở NGUỒN: chỉ giữ cánh tay văn phòng NÀY chưa có.
     *
     * Bản trước liệt kê cả sổ chung, nên mục văn phòng đang dùng vẫn hiện ra —
     * bấm vào thì đi qua chọn → thử ~20 giây → giao cho ai → rồi mới bị từ chối.
     * Bày ra một lựa chọn CHẮC CHẮN SAI rồi để người dùng đâm vào nó là tệ hơn
     * mọi câu báo lỗi viết khéo.
     */
    void api.arms().then((r) => setInstalled(forList(r.arms, officeId))).catch(() => undefined);
  }, [open, officeId]);

  const agents = (canvas?.nodes ?? []).filter((n) => n.kind === 'agent' && n.role);
  /** Workspace đang chọn — để màn cấu hình nói ra nó, chứ không chỉ ghi "Notion". */
  const pickedAccount = accounts.find((a) => a.name === account);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 TÊN MẶC ĐỊNH **ĐI THEO** TÀI KHOẢN — đổi tài khoản là đổi tên.        │
   * │ (bug user bắt 27/08)                                                     │
   * │                                                                          │
   * │ > *"Sao tôi đổi workspace account sang minhvuptitd14 mà node mcp server  │
   * │ >  vẫn tên là GitHub · minhvq36"* … *"bạn lấy được tên workspace mà, lúc │
   * │ >  tick đổi cái tên không đổi theo mà bị khoá?"*                          │
   * │                                                                          │
   * │ Bản cũ so `cur === pick.name` để biết *"nhãn còn là hàng tự sinh không"*. │
   * │ Phép so đó chỉ đúng ĐÚNG MỘT LẦN: ghi xong thì `cur` là                  │
   * │ *"GitHub · minhvq36"*, không còn bằng `pick.name` nữa ⇒ mọi lần đổi tài  │
   * │ khoản sau đều rơi vào nhánh *"người dùng đã tự đặt tên"* và bị bỏ qua.   │
   * │ Nhãn đóng băng ở tài khoản ĐẦU TIÊN trong khi cấu hình trỏ tài khoản mới │
   * │ — và trên sơ đồ đó là chỗ DUY NHẤT đọc được tên, nên lời nói dối không   │
   * │ có gì đối chứng.                                                         │
   * │                                                                          │
   * │ ⇒ Sửa bằng cách nhớ **chính chuỗi ta vừa tự ghi** (`autoLabel`) thay vì   │
   * │ suy ra nó. Còn khớp ⇒ hàng tự sinh, ghi đè thoải mái. Khác ⇒ người dùng  │
   * │ đã gõ tên riêng, ĐỪNG ĐỘNG VÀO. Cổng vẫn còn, chỉ là nó thôi hết hạn     │
   * │ sau lần đầu.                                                             │
   * │                                                                          │
   * │ ⚠ Vẫn **CHỈ tên tài khoản, KHÔNG kèm mức quyền**: nhãn đổi tự do, nên    │
   * │ mức quyền nằm trong đó là một lời hứa gỡ được bằng cách đổi tên. Mức     │
   * │ quyền sống ở huy hiệu, suy từ `level`. → §6j                             │
   * │                                                                          │
   * │ ⚠ Và nhãn KHÔNG PHẢI chỗ dựa duy nhất: node trên sơ đồ cắt tên còn 14 ký │
   * │ tự (*"GitHub · minhv…"*), nên nó vẫn vẽ thêm `via` ở dòng phụ — thứ do   │
   * │ server tra từ `arms[].secrets` mỗi lần đọc, không lỗi thời được.         │
   * │ → `canvas/NodeShape.tsx`                                                 │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const autoLabel = useRef('');
  useEffect(() => {
    if (!pick?.needsLogin || !pickedAccount?.label) return;
    // Người dùng đã gõ tên riêng ⇒ đứng yên. Ghi ref NGOÀI updater của `setLabel`:
    // updater phải thuần, React gọi nó hai lần ở StrictMode.
    if (label !== pick.name && label !== autoLabel.current) return;
    const next = `${pick.name} · ${pickedAccount.label}`;
    autoLabel.current = next;
    setLabel(next);
  }, [pick, pickedAccount, label]);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ DANH SÁCH "DÙNG LẠI" — **THEO ĐÚNG LOẠI CỦA TAB ĐANG MỞ**. (bug 26/08)   │
   * │                                                                          │
   * │ User báo: *"vào tab Dịch vụ có sẵn mà nó cũng đề xuất cánh tay đang cắm  │
   * │ ở văn phòng khác của các loại khác. Custom cũng vậy."*                    │
   * │                                                                          │
   * │ Bản cũ để khối này NGOÀI mọi nhánh `pane`, nên nó hiện ở cả ba màn cùng  │
   * │ một nội dung — người đang tìm Notion phải lướt qua bốn cánh tay thư mục. │
   * │ Một danh sách "gợi ý" mà không lọc theo ngữ cảnh thì không phải gợi ý,   │
   * │ nó là nhiễu có nhãn.                                                     │
   * │                                                                          │
   * │ ⚠ Mồ côi của **loại đó** vẫn phải hiện (user nêu rõ) — nó tụt xuống đáy  │
   * │ và mang thùng rác, chứ không bị giấu đi: đây là chỗ **duy nhất** dọn      │
   * │ được chúng mà không phải mở `company.yaml`.                              │
   * │                                                                          │
   * │ ⚠ ĐÍNH CHÍNH 26/08 — user bác, và bác đúng:                              │
   * │   *"trong modal có 3 lựa chọn đúng không, vẫn đề xuất hết như cũ (full   │
   * │    all mcp). Vào type riêng mới lọc theo type đó."*                      │
   * │                                                                          │
   * │ Bản trước tôi cắt sạch danh sách khỏi màn chọn LOẠI với lý lẽ *"ba thẻ   │
   * │ là toàn bộ câu hỏi"*. Sai ở chỗ: màn đó là **màn tiếp đất**, và người    │
   * │ quay lại cắm cái họ đã có không nên phải đoán xem nó nằm trong tab nào.  │
   * │ Lọc là để **thu hẹp khi đã biết mình tìm gì**, không phải để giấu.       │
   * │                                                                          │
   * │ ⇒ `kind` bỏ trống = hiện tất cả (màn tiếp đất). Có `kind` = đã vào một   │
   * │ loại, chỉ hiện loại đó.                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  function reuseList(kind?: Kind) {
    const list = byKind(
      kind ? installed.filter((a) => kindOf(a, catalog) === kind) : installed,
      catalog,
    );
    if (!list.length) return null;
    return (
      <>
        <div className="mt-4 text-[11px] uppercase tracking-wide text-muted">Đã cắm ở văn phòng khác</div>
        {/*
          ĐANG THỬ ⇒ KHOÁ DANH SÁCH. (user đề nghị 26/08)

          `runRef` đã lo phần đúng-sai (kết quả cũ không đè được kết quả mới).
          Khối này lo phần **đừng để người dùng rơi vào đó**: một danh sách bấm
          được trong lúc màn hình đang quay là một lời mời vào đúng cái bẫy.

          Làm mờ chứ không ẩn: ẩn thì bố cục nhảy, và cái nhảy đó xảy ra đúng
          lúc người dùng đang nhìn chỗ khác chờ kết quả.
        */}
        <div
          className={`mt-1.5 flex flex-col gap-1 transition-opacity ${
            testing ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          {list.map((a) => (
            <div key={a.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  /*
                    DÙNG LẠI ĐÚNG MỤC ĐÓ, không nhân bản cấu hình.

                    Danh tính là băm cấu hình, nên "chép sang một mã mới" không
                    còn nghĩa gì: cùng cấu hình ⇒ cùng băm ⇒ vẫn là nó. Cái
                    "clone" user muốn nằm ở tầng khác — SỰ HIỆN DIỆN theo từng
                    văn phòng (`role.mcp`), không phải bản sao cấu hình. → §6i

                    ⚠ VÀ ĐÓ CHÍNH LÀ THỨ BẢN CŨ Ở ĐÂY PHÁ HỎNG. Nó gọi
                    `setPaste(JSON.stringify(a.config))` — đẩy mục này sang
                    đường "TỰ CẮM", nơi không ai biết nó cần chìa gì. Cánh tay
                    stdio chưa lộ (chìa đi qua `env`, `filesystem` không cần
                    chìa); cánh tay HTTP đầu tiên thì hỏng ngay — ô trống bay
                    lên Notion nguyên văn → 401. → §6i-bis
                  */
                  resetConfig();
                  setPick(null);
                  setReuse(a);
                  setLabel(a.label);
                  setStep(2);
                }}
                className="flex flex-1 items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-[13px] hover:border-accent"
              >
                {/*
                  Hình theo HÃNG (ngã về LOẠI khi hãng chưa có logo) — cùng hàm
                  với lưới dịch vụ và thẻ chọn loại, nên một mục giữ nguyên hình
                  suốt từ màn tiếp đất tới bước 2. → `ArmIcon.tsx`
                */}
                <span className="shrink-0 text-muted">
                  <ArmIcon
                    mark={markOf(a.catalog, catalog)}
                    kind={kindOf(a, catalog)}
                    className="h-4 w-4"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.label}</span>
                  {/*
                    ┌────────────────────────────────────────────────────────┐
                    │ DÒNG PHỤ: WORKSPACE + MỨC QUYỀN. (user 26/08)         │
                    │                                                        │
                    │   *"1 loạt Notion thì biết là Notion nào"*             │
                    │                                                        │
                    │ Cả hai đều SUY TỪ DỮ LIỆU, không đọc chuỗi tên:        │
                    │  · `via`   ← server tra `arms[].secrets` ra tên         │
                    │              workspace trong kho OAuth                 │
                    │  · `level` ← `arms[].level`, thứ nằm trong chính băm    │
                    │                                                        │
                    │ Vì sao không nhét vào `label`: nhãn là của người dùng   │
                    │ và đổi tự do — nhét mức quyền vào chuỗi thì một cú đổi  │
                    │ tên tạo ra được "Notion (ghi được)" trên một cánh tay   │
                    │ chỉ đọc. Nhãn nói dối về đặc quyền. → §6j              │
                    └────────────────────────────────────────────────────────┘
                  */}
                  {(a.via || a.level) && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      {a.via && <span className="truncate">{a.via}</span>}
                      {a.via && a.level && <span>·</span>}
                      {a.level && (
                        <span className={a.level === 'full' ? 'text-danger' : undefined}>
                          {LEVEL_SAY[a.level]}
                        </span>
                      )}
                      {a.toolCount ? <span className="tabular-nums">· {a.toolCount} việc</span> : null}
                    </span>
                  )}
                </span>
                <span className="shrink-0 self-start text-[11px] text-muted">
                  {a.orphan ? 'không ai dùng' : 'dùng lại'}
                </span>
              </button>
              {/*
                XOÁ HẲN — chỉ hiện cho mục KHÔNG VĂN PHÒNG NÀO GIỮ. Tới hôm nay,
                gỡ một mục mồ côi khỏi sổ chỉ làm được bằng cách **mở
                `company.yaml` sửa tay** — một CHUÔNG BÁO (§6a).

                Điều kiện `a.orphan` đến từ SERVER, không tự suy từ `usedBy`:
                `usedBy` chỉ đếm sợi dây, nên một node đang nằm chờ trên sơ đồ
                ai đó sẽ trông như mồ côi. Server chặn lần nữa — nút này chỉ để
                không bày ra một lựa chọn chắc chắn bị từ chối.
              */}
              {a.orphan && (
                <button
                  type="button"
                  title="Xoá hẳn khỏi sổ chung"
                  aria-label={`Xoá hẳn ${a.label}`}
                  onClick={() => setForget(a)}
                  className="shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  /**
   * Cánh tay thư mục TỰ THỬ ngay khi chọn xong — người dùng không phải bấm gì.
   * Xem khối chú thích ở nút Thử để biết vì sao phép thử vẫn phải chạy.
   */
  useEffect(() => {
    if (step === 2 && pick?.folders && folders.trim() && !probe && !testing) void test();
    // Chỉ theo `folders`: thêm `probe`/`testing` vào đây là tự gọi lại chính mình.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, step]);

  const folderList = () => folders.split('\n').map((s) => s.trim()).filter(Boolean);

  /**
   * Mục này CÓ hỏi nhóm việc ở nấc đang chọn không?
   *
   * Chỉ hỏi ở `full`: xem khối chú thích ở state `groups`. Điều kiện `pick.groups`
   * là DỮ LIỆU của mục, nên mục nào không khai nhóm thì màn này im — không có
   * nhánh `id === 'github'` nào ở đây.
   */
  const needGroups = () => Boolean(pick?.groups?.length) && tier === 'full';

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 MỘT LỰA CHỌN Ở BƯỚC 1 = MỘT CẤU HÌNH MỚI TINH. (bug user bắt 26/08)  │
   * │                                                                          │
   * │ Luồng họ dựng lại: chọn thư mục A → thử ✓ → bấm một mục trong danh sách  │
   * │ gợi ý → **Quay lại** → bấm "Thư mục trên máy" ⇒ **nó tự thử lại thư mục  │
   * │ A**. Người dùng không chọn A ở lượt này, mà máy vẫn đi thử A.            │
   * │                                                                          │
   * │ Gốc rễ: `folders` (và `keys`, `tier`, `account`, `paste`) là state của cả │
   * │ hộp thoại, còn `setPick`/`setReuse` chỉ đổi ĐƯỜNG. Quay lại rồi vào lại   │
   * │ thì cấu hình cũ vẫn nằm nguyên đó, và `useEffect` tự-thử thấy đủ điều     │
   * │ kiện nên bắn.                                                            │
   * │                                                                          │
   * │ ⚠ USER CHO HAI PHƯƠNG ÁN, và tôi chọn (1) — "coi như chưa chọn gì":      │
   * │   (2) giữ lại kết quả thử cũ nghe tiện, nhưng nó là **đúng cái lớp lỗi**  │
   * │   vừa vá bằng `runRef`: một dấu ✓ nói về một cấu hình khác với cấu hình   │
   * │   đang trên màn hình. Ở đó nó lệch vài giây; ở đây nó lệch qua cả một     │
   * │   vòng điều hướng — khó thấy hơn, không dễ hơn.                          │
   * │                                                                          │
   * │ ⇒ Luật đọc được thành lời: **thứ bạn vừa bấm là thứ bạn đang cấu hình.**  │
   * │ Dọn ở MỘT hàm, gọi từ mọi cửa vào bước 1 — vá từng nút là để lần sau      │
   * │ thêm cửa thứ năm thì quên đúng cửa đó.                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  function resetConfig() {
    setFolders('');
    setKeys({});
    setPaste('');
    setProbe(null);
    setErr('');
    setTier('read');
    // Nhóm việc + giới hạn repo cũng là CẤU HÌNH, nên chúng dọn ở đây cùng mọi
    // thứ khác. Bỏ sót thì bấm sang mục khác vẫn mang theo giới hạn của mục
    // trước — đúng luật đã chốt 26/08: *thứ bạn vừa bấm là thứ bạn đang cấu hình.*
    setGroups([]);
    setAccount('');
    // Nhãn tự sinh của mục TRƯỚC không được tính là "hàng tự sinh" của mục này:
    // để lại thì một cái tên người dùng đã gõ ở mục cũ có thể bị ghi đè im lặng.
    autoLabel.current = '';
    // Lượt thử đang bay (nếu có) mất quyền ghi kết quả — xem `runRef`. Không có
    // dòng này thì một lượt cũ vẫn về được và dựng lại đúng cái bug vừa vá.
    runRef.current++;
    setTesting(false);
    setSlow(false);
    /**
     * ⚠ Lượt đăng nhập bằng mã cũng phải dọn ở ĐÂY, cùng lý do với `runRef`.
     *
     * Bỏ sót thì quay lại rồi bấm sang mục khác vẫn thấy một khối mã to đùng của
     * **mục trước** — và tệ hơn: vòng hỏi thăm vẫn chạy, nên nó có thể "đăng
     * nhập xong" cho một dịch vụ người dùng không còn đứng ở đó nữa. Đúng luật
     * đã chốt 26/08: *thứ bạn vừa bấm là thứ bạn đang cấu hình.*
     */
    setDevice(null);
    setLogging(false);
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 ĐỔI TÀI KHOẢN ⇒ DỌN SẠCH MỌI THỨ PHÍA SAU. (user chốt 28/08)          │
   * │                                                                          │
   * │ > *"tôi chọn lại 1 account mới mà trên modal vẫn hiện chọn repo, thậm chí │
   * │ >  còn hiện phần dấu check tool, thì làm sao kiểm soát được quyền ở đâu"* │
   * │ > *"clear thẳng băng đi cho sạch, buộc người dùng phải chọn lại từ đầu,   │
   * │ >  chứ chiều người dùng là cái app như nồi cám heo"*                      │
   * │                                                                          │
   * │ Và họ đúng ở chỗ nặng nhất: **nấc quyền + nhóm việc** là hai thứ QUYẾT    │
   * │ ĐỊNH nhân viên được làm gì. Giữ chúng lại qua một lần đổi tài khoản là để │
   * │ người dùng nhìn thấy một lựa chọn họ đã cân nhắc cho **tài khoản khác**,  │
   * │ rồi bấm Tiếp — cấp quyền cho một thứ họ chưa hề xem xét.                  │
   * │                                                                          │
   * │ Bản cũ chỉ dọn `probe` (và chỉ ở nút radio, không ở đường tự chọn hay     │
   * │ đường vừa-đăng-nhập-xong) — tức "một nửa cấu hình mới, một nửa cũ", đúng  │
   * │ lớp lỗi *"thứ bạn vừa bấm là thứ bạn đang cấu hình"* đã chốt 26/08.       │
   * │                                                                          │
   * │ ⚠ MỘT hàm, MỌI đường vào (radio · tự chọn · vừa đăng nhập xong). Dọn ở    │
   * │ một chỗ rồi quên chỗ kia là cách cái bug này ra đời lần đầu.              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /** Bản gương của `account` cho các hàm có deps rỗng. Xem `loadAccounts`. */
  const accountRef = useRef('');
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  /**
   * Ảnh chụp danh sách TRƯỚC lần nạp kế tiếp — để biết cái nào vừa mới xuất hiện.
   * Cùng lý do `accountRef` tồn tại: `loadAccounts` có deps rỗng nên state trong
   * closure là bản của lần render đầu.
   */
  const accountsRef = useRef<OAuthAccount[]>([]);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  const chooseAccount = useCallback((name: string) => {
    setAccount(name);
    // Kết quả Thử cũ nói về một CẤU HÌNH KHÁC (ô trống mang tên chìa khác).
    setProbe(null);
    // Nấc rơi về thấp nhất — mặc định an toàn khi chưa ai chọn. → §6j
    setTier('read');
    setGroups([]);
    // Bản cài app là của TÀI KHOẢN, nên kết quả tra cũ nói về người khác.
    setScan(null);
    setAnyway(false);
    setErr('');
  }, []);

  /**
   * Nạp danh sách tài khoản đã đăng nhập cho mục đang chọn, và tự chọn cái đầu.
   *
   * Gọi cả lúc vào bước 2 **lẫn** sau khi đăng nhập xong. Sau đăng nhập, tab
   * callback đã đóng và người dùng đang nhìn lại hộp thoại này — nếu nó không tự
   * nạp lại thì họ thấy đúng cái màn hình *"chưa đăng nhập"* mà họ vừa xử lý xong,
   * và cách duy nhất đi tiếp là F5. Đó là hình dạng của một app nói dối về trạng
   * thái của chính nó.
   */
  const loadAccounts = useCallback(
    /**
     * `justLoggedIn` — HAI NGƯỜI GỌI, HAI Ý ĐỊNH NGƯỢC NHAU. (bug user bắt 30/08)
     *
     * > *"Sao chọn thêm 1 workspace khác ở modal UI thì sau khi chọn thành công
     * >  không tự chuyển option chọn xuống đó vậy"*
     *
     * Bản cũ chỉ có một luật — *"chỉ tự chọn khi CHƯA có gì được chọn"* — và luật
     * đó **đúng cho người gọi thứ nhất**: vào bước 2 thì không được đá cái người
     * dùng đang cấu hình dở, vì `chooseAccount` dọn sạch nấc/nhóm/kết quả Thử.
     *
     * Nhưng người gọi thứ hai là **vừa đăng nhập xong**, và ở đó ý định không
     * mơ hồ chút nào: người ta bấm Đăng nhập, chọn workspace, bấm Cho phép —
     * ba bước, đều nói cùng một điều. Giữ nguyên lựa chọn cũ ở đây là app phớt
     * lờ đúng việc người dùng vừa làm.
     *
     * ⚠ Chọn theo **CÁI MỚI XUẤT HIỆN**, không theo `accounts[0]` hay phần tử
     * cuối: thứ tự server trả về không phải hợp đồng, và bám vào nó là dựng một
     * bug im lặng cho ngày ai đó đổi cách sắp xếp.
     *
     * 📌 Đăng nhập lại CÙNG workspace ⇒ không có tên nào mới ⇒ rơi về luật cũ,
     * giữ nguyên lựa chọn. Đúng: không có gì mới để chuyển sang.
     */
    async (catalogId: string, justLoggedIn = false) => {
      const before = new Set(accountsRef.current.map((a) => a.name));
      const r = await api.oauthAccounts(catalogId).catch(() => null);
      if (!r) return;
      setAccounts(r.accounts);

      if (justLoggedIn) {
        const fresh = r.accounts.find((a) => !before.has(a.name));
        if (fresh) {
          chooseAccount(fresh.name);
          return;
        }
      }
      /**
       * Chỉ tự chọn khi CHƯA có gì được chọn — `chooseAccount` dọn sạch phía sau,
       * nên gọi nó lên một lựa chọn đã có là xoá cấu hình người dùng đang gõ dở.
       *
       * ⚠ Đọc qua `accountRef` chứ không qua state: hàm này có deps rỗng nên
       * `account` trong closure là bản của lần render đầu. Và ⚠ không nhét phép
       * kiểm vào trong updater của `setAccount` — updater phải THUẦN, React gọi
       * nó hai lần ở StrictMode (đúng bẫy đã tránh ở `autoLabel`).
       */
      const first = r.accounts[0]?.name;
      if (first && !accountRef.current) chooseAccount(first);
    },
    [chooseAccount],
  );

  useEffect(() => {
    if (step === 2 && pick?.needsLogin) void loadAccounts(pick.id);
  }, [step, pick, loadAccounts]);

  /**
   * TRA BẢN CÀI APP. → SPEC-arms §5h·7o
   *
   * ⚠ `scanRef` cùng khuôn với `runRef`: đổi tài khoản giữa lúc đang tra thì
   * kết quả của tài khoản CŨ không được ghi lên màn hình đang nói về tài khoản
   * MỚI. Ở `runRef` cái đó tạo ra một dấu ✓ nói dối; ở đây nó tạo ra một danh
   * sách repo của người khác — nhìn còn thuyết phục hơn.
   */
  /**
   * Nạp client_id đang dùng cho mục này. Chỉ hiện khi công ty **đã dán** — của
   * agentco thì để trống, vì bày sẵn nó ra là mời người ta sửa một thứ họ không
   * nên đụng, và ô có sẵn chữ trông như một trường bắt buộc.
   */
  useEffect(() => {
    if (step !== 2 || !pick?.deviceLogin) return;
    void api
      .oauthClient(pick.id)
      .then((r) => {
        setOwn(r.own);
        setClientId(r.own ? r.id : '');
      })
      .catch(() => undefined);
  }, [step, pick]);

  async function saveClientId() {
    if (!pick) return;
    try {
      const r = await api.setOauthClient(pick.id, clientId);
      setOwn(r.own);
      setClientId(r.own ? r.id : '');
      // Đổi danh tính ứng dụng ⇒ chìa đã có thuộc client CŨ. Không dọn gì cả,
      // chỉ nói ra: chìa cũ vẫn dùng được, nhưng lượt đăng nhập TỚI sẽ đi bằng
      // client mới. Tự xoá chìa hộ là vứt một thứ đang chạy tốt.
      setErr(
        r.own
          ? 'Đã lưu. Lượt đăng nhập tới sẽ đi bằng app của bạn — tài khoản đã nối trước đó vẫn giữ nguyên.'
          : 'Đã quay về app của agentco.',
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không lưu được Client ID.');
    }
  }

  const scanRef = useRef(0);
  const runScan = useCallback(async () => {
    if (!pick?.repoScan || !account) return;
    const mine = ++scanRef.current;
    setScanning(true);
    setScan(null);
    setAnyway(false);
    const r = await api.armRepos(pick.id, account).catch(() => ({ failed: true }) as const);
    if (mine !== scanRef.current) return;
    setScan(r);
    setScanning(false);
  }, [pick, account]);

  /**
   * Tự chạy khi đã có tài khoản — **không** đợi người dùng bấm gì.
   *
   * Đây là chỗ user chốt: *"Không gõ chữ gì, bấm thử ngay và thử tự động"*. Nó
   * chạy sớm hơn nút Thử vì nó chỉ cần CHÌA, không cần cấu hình — nên người dùng
   * đọc kết quả trong lúc còn đang chọn nấc và nhóm việc.
   */
  useEffect(() => {
    if (step === 2 && pick?.repoScan && account) void runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pick, account]);

  /**
   * ⚠ NGHE SSE để biết tab callback đã xong. Daemon phát `company.offices` sau
   * khi lưu chìa — `armsVersion` của store bump theo, và hiệu ứng này bám vào nó.
   *
   * Không dùng `window.open(...).onclose` hay polling: tab callback là một
   * origin khác về mặt điều hướng, và người dùng có thể đóng nó bằng tay trước
   * khi ta kịp thấy. Sự kiện từ server là thứ DUY NHẤT biết chắc chìa đã lưu.
   */
  const armsVersion = useApp((s) => s.armsVersion);
  useEffect(() => {
    if (step === 2 && pick?.needsLogin && logging) {
      setLogging(false);
      // `true` = vừa đăng nhập xong ⇒ chuyển sang workspace vừa cấp quyền.
      // → khối chú thích ở `loadAccounts`
      void loadAccounts(pick.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armsVersion]);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ GỠ WORKSPACE — OPTIMISTIC UI. (user 26/08: *"hơi khựng á"*)              │
   * │                                                                          │
   * │ Bỏ khỏi danh sách NGAY, gọi server sau. Thu hồi chìa ở phía dịch vụ là   │
   * │ một vòng mạng thật (`revocation_endpoint`), nên chờ nó xong rồi mới vẽ   │
   * │ lại là bắt người dùng nhìn một cái nút đứng im vì một việc **không liên  │
   * │ quan gì tới thứ họ đang nhìn**.                                          │
   * │                                                                          │
   * │ ⚠ VÌ SAO LẠC QUAN Ở ĐÂY LÀ THÀNH THẬT, còn ở chỗ khác thì không:        │
   * │ nút chỉ bấm được khi `usedBy` rỗng, mà đó là **lý do từ chối duy nhất**  │
   * │ của server. Thứ còn lại chỉ là mạng chết. Lạc quan đúng nghĩa là "gần    │
   * │ như chắc chắn thành công", không phải "kệ, hỏng thì hoàn tác" — một danh │
   * │ sách hay nhấp nháy vì rollback thì tệ hơn hẳn một nút khựng nửa giây.    │
   * │                                                                          │
   * │ ⚠ VÀ VẪN PHẢI HOÀN TÁC ĐƯỢC. "Gần như chắc chắn" không phải "chắc chắn", │
   * │ và một giao diện nói dối về việc đã xoá thì tệ hơn mọi khoản chờ.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  function dropNow(): void {
    const a = dropWs;
    if (!a || !pick) return;
    const before = accounts;

    setDropWs(null);
    setAccounts((list) => list.filter((x) => x.name !== a.name));
    // Đang chọn chính nó thì bỏ chọn — nếu không, `payload()` gửi lên một tên
    // chìa vừa bị xoá và người dùng nhận câu lỗi cho việc họ vừa chủ động làm.
    setAccount((cur) => (cur === a.name ? '' : cur));
    setProbe(null);

    void api
      .oauthForget(a.name)
      // Nạp lại từ server sau khi xong: `usedBy` của những mục CÒN LẠI có thể đã
      // khác, và bản lạc quan chỉ biết đúng cái vừa bỏ.
      .then(() => loadAccounts(pick.id))
      .catch((e) => {
        setAccounts(before);
        setErr(e instanceof ApiError ? e.message : 'Không gỡ được.');
      });
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ LƯỢT ĐĂNG NHẬP BẰNG MÃ THIẾT BỊ đang bay. → SPEC-arms §5h·7             │
   * │                                                                          │
   * │ ⚠ Ở ĐÂY KHÔNG CÓ BÍ MẬT NÀO. `state` chỉ trỏ tới một phiên nằm ở daemon; │
   * │ `userCode` là thứ người dùng phải ĐỌC ĐƯỢC và gõ đi. Đó là lý do khối    │
   * │ này được phép sống trong state của React, khác hẳn `code_verifier` của   │
   * │ web flow (thứ chưa bao giờ rời khỏi daemon).                             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [device, setDevice] = useState<DeviceLogin | null>(null);
  /** Đếm ngược, tính lại mỗi giây — mã chết thật, và người dùng phải thấy nó chết. */
  const [now, setNow] = useState(() => Date.now());

  /**
   * VÒNG HỎI THĂM — nhịp do SERVER quyết (`intervalMs`), không phải hằng số ở đây.
   *
   * ⚠ `slow_down` của RFC 8628 nới nhịp ra, và server trả nhịp mới về trong
   * từng phản hồi. Ghim một hằng số ở client là bỏ qua lời dặn đó rồi bị hãng
   * chặn — một lỗi chỉ xuất hiện lúc mạng chậm, tức lúc khó tái lập nhất.
   */
  useEffect(() => {
    if (!device || !pick) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (wait: number): Promise<void> => {
      timer = setTimeout(async () => {
        if (!alive) return;
        try {
          const r = await api.oauthDevicePoll(device.state);
          if (!alive) return;
          if (r.state === 'done') {
            setDevice(null);
            setLogging(false);
            await loadAccounts(pick.id);
            // Tài khoản vừa nối là thứ họ vừa làm ra — chọn sẵn giùm, và dọn
            // sạch mọi thứ đã chọn cho tài khoản TRƯỚC. → `chooseAccount`
            chooseAccount(r.name);
            return;
          }
          void tick(r.intervalMs);
        } catch (e) {
          if (!alive) return;
          /**
           * 🔴 HỎNG Ở ĐÂY LÀ DỪNG, và phải nói ra — khác hẳn tầng mạng.
           *
           * `devicePoll` phía daemon đã nuốt mọi lỗi TẠM thành `pending` (rớt
           * mạng không được giết một lượt cấp quyền đã thành công, §5h·7g). Nên
           * thứ leo được tới đây chỉ còn: mã hết hạn, người dùng bấm Từ chối,
           * hoặc phiên đã bị dọn. Cả ba đều **không tự khỏi** ⇒ im lặng thử lại
           * là để người dùng nhìn một vòng quay vĩnh viễn.
           */
          setDevice(null);
          setLogging(false);
          setErr(e instanceof ApiError ? e.message : 'Lượt đăng nhập đã dừng.');
        }
      }, wait);
    };
    void tick(device.intervalMs);

    // Đếm ngược chạy riêng: nó chỉ vẽ, không được phụ thuộc nhịp hỏi thăm.
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, pick]);

  /**
   * Hết hạn thì **tự dọn**, không đợi người dùng phát hiện.
   *
   * Một mã đã chết mà vẫn hiện trên màn hình là một lời mời gõ vào chỗ vô ích —
   * và người gõ xong sẽ thấy GitHub báo lỗi, rồi đi tìm nguyên nhân ở phía họ.
   */
  useEffect(() => {
    if (device && now > device.expiresAt) {
      setDevice(null);
      setLogging(false);
      setErr('Mã đăng nhập đã hết hạn — bấm Đăng nhập để lấy mã mới.');
    }
  }, [now, device]);

  async function login() {
    if (!pick) return;
    setErr('');
    setLogging(true);
    /**
     * ⚠ DỌN NGAY TỪ LÚC BẤM, không đợi đăng nhập xong. (user 28/08)
     *
     * *"trong lúc chọn nối thêm 1 tài khoản khác: đề nghị trên modal clear tất cả
     * các entity phụ thuộc yếu của nó… khi nào select xong xuôi rồi mới hiện"*
     *
     * Dọn ở đây thì khối phạm vi / bản cài / nấc / nhóm việc **biến mất ngay khi
     * họ bấm**, thay vì đứng đó nói về tài khoản cũ suốt lượt đăng nhập. Không có
     * dòng này thì họ nhìn một màn hình trộn hai tài khoản trong ~30 giây — đúng
     * lúc câu hỏi *"quyền này của ai"* khó trả lời nhất.
     *
     * Cái giá đã cân nhắc: bấm nhầm rồi ✕ thì mất lựa chọn nấc/nhóm đang gõ dở.
     * Chọn chiều đó vì hai chiều hỏng không cân nhau — mất vài cú bấm thì thấy
     * ngay, còn cấp quyền cho tài khoản mình chưa xem xét thì không thấy gì cả.
     */
    setProbe(null);
    setTier('read');
    setGroups([]);
    setScan(null);
    setAnyway(false);

    /**
     * ĐƯỜNG MÃ THIẾT BỊ — cho hãng không mở đăng ký động (GitHub).
     *
     * Không `window.open` bắt buộc: người dùng có thể đang ngồi ở một máy khác
     * với cái điện thoại trong tay, và **đó chính là ca device flow sinh ra để
     * phục vụ**. Ta hiện mã + một nút mở giúp, không giả định trình duyệt này
     * là nơi họ sẽ duyệt.
     */
    if (pick.deviceLogin) {
      try {
        const d = await api.oauthDeviceStart(pick.id);
        // Dấu "đã chép" được dọn bằng `key={device.state}` ở chỗ vẽ, không bằng
        // một `setCopied(false)` ở đây: state đó nay sống trong `DeviceCode`, và
        // một lượt mới là một `state` mới ⇒ React dựng lại khối, sạch mọi thứ.
        setNow(Date.now());
        setDevice(d);
      } catch (e) {
        setLogging(false);
        setErr(e instanceof ApiError ? e.message : 'Không lấy được mã đăng nhập.');
      }
      return;
    }

    try {
      const { authUrl } = await api.oauthStart(pick.id);
      /**
       * MỞ TAB TỪ ĐÂY, không để daemon `spawn` trình duyệt.
       *
       * 🔴 Hai lớp lỗi bị xoá cùng lúc: (1) trình duyệt mặc định của máy có thể
       * chưa đăng nhập dịch vụ, còn cái đang mở agentco thì có — user gặp ngay
       * lượt đầu 24/08; (2) `cmd /c start` trên Windows cắt URL ở dấu `&` đầu
       * tiên, mà URL OAuth thì **luôn** có `&`. Không qua shell ⇒ không có gì để cắt.
       */
      window.open(authUrl, '_blank', 'noopener');
    } catch (e) {
      setLogging(false);
      setErr(e instanceof ApiError ? e.message : 'Không mở được trang đăng nhập.');
    }
  }

  /**
   * Thứ gửi lên server. Mục danh mục thì gửi **`catalogId` + thư mục** và để
   * SERVER dựng — client không ghép chuỗi `npx …@phiên-bản` nữa.
   *
   * Bản trước client tự ghép, tức số phiên bản gói ghim ở HAI chỗ. Hai bản của
   * cùng một hằng số đã đốt dự án này một lần (`agentSlot` vs `arrange`).
   */
  function payload():
    | {
        armId?: string;
        config?: Record<string, unknown>;
        catalogId?: string;
        folders?: string[];
        account?: string;
        level?: 'read' | 'add' | 'full';
        groups?: string[];
        options?: string[];
      }
    | null {
    // Dùng lại: chỉ gửi BĂM. Cấu hình, tên chìa và giá trị chìa đều nằm ở server
    // rồi — gửi lại bản sao của chúng qua HTTP là mở đường cho hai bản lệch nhau.
    if (reuse) return { armId: reuse.id };
    if (pick) {
      if (pick.folders && folderList().length === 0) return null;
      // Cần đăng nhập mà chưa chọn tài khoản ⇒ chưa dựng được cấu hình: ô trống
      // `${OAUTH}` không có tên nào để thay. Trả `null` để nút Thử im, thay vì
      // gửi lên rồi nhận về một câu lỗi kỹ thuật.
      if (pick.needsLogin && !account) return null;
      // Nấc toàn quyền mà chưa tick nhóm nào ⇒ chưa dựng được cấu hình. Trả
      // `null` để nút Thử im, y hệt ca "chưa chọn tài khoản" ngay trên — thay vì
      // gửi lên rồi nhận về một cánh tay rộng hơn thứ người dùng định cắm.
      if (needGroups() && !groups.length) return null;
      return {
        catalogId: pick.id,
        folders: folderList(),
        ...(account ? { account } : {}),
        ...(pick.tiered ? { level: tier } : {}),
        ...(groups.length ? { groups } : {}),
        /**
         * ⚠ GỬI KỂ CẢ KHI RỖNG — khác hẳn `groups` ngay trên.
         *
         * Server đọc `undefined` = *"client không nói gì"* ⇒ rơi về **bật sẵn**;
         * mảng rỗng = *"người dùng đã bỏ tick hết"*. Dùng `...(len ? … : {})` ở
         * đây là biến một lần bỏ tick tường minh thành một cú bấm **không có tác
         * dụng**, và người dùng sẽ không hiểu vì sao. → `server.ts §armConfig`
         */
        ...(pick.options?.length ? { options } : {}),
      };
    }
    const cfg = parsePaste();
    return cfg ? { config: cfg } : null;
  }

  /**
   * Ô TRỐNG `${TÊN}` trong cấu hình người dùng DÁN → sinh ô nhập chìa cho đúng
   * chúng. Bản khách của `secrets.ts §missingSecretRefs`.
   *
   * Trước đây đường "tự cắm" không có ô chìa nào, nên mọi server HTTP cần token
   * đều là ngõ cụt: dán vào, thử, 401, hết đường. Danh mục thì khai sẵn tên chìa
   * — nhưng tên đó không phải bí mật gì, nó nằm ngay trong cấu hình họ vừa dán.
   * Đọc ra là đủ, và nó chạy cho MỌI hãng mà ta không cần biết trước hãng nào.
   */
  const pastedKeys = (): string[] => {
    if (pick || reuse) return [];
    const cfg = parsePaste();
    if (!cfg) return [];
    const seen = new Set<string>();
    for (const m of JSON.stringify(cfg).matchAll(/\$\{([A-Z0-9_]+)\}/g)) seen.add(m[1]!);
    return [...seen].sort();
  };

  /**
   * Mục danh mục cùng TÊN MIỀN với URL người dùng vừa dán.
   *
   * Chỉ để **chỉ đường**, không tự chuyển hộ: người dùng cố ý đi đường tự cắm,
   * và tự nhảy họ sang đường khác là lấy mất quyết định của họ. Một câu gợi ý
   * thì họ đọc rồi tự chọn.
   */
  const catalogMatch = (): CatalogArm | undefined => {
    const cfg = parsePaste();
    const url = cfg && typeof cfg['url'] === 'string' ? cfg['url'] : '';
    if (!url) return undefined;
    try {
      const host = new URL(url).hostname;
      return catalog.find((c) => c.host === host);
    } catch {
      return undefined;
    }
  };

  /** Ô để trắng KHÔNG phải một chìa rỗng — nó là chìa CHƯA ĐIỀN. Đừng gửi đi. */
  const filledKeys = (): Record<string, string> =>
    Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim() !== ''));

  /** Khối JSON người dùng dán. `null` = chưa đọc được. */
  function parsePaste(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(paste) as Record<string, unknown>;
      // Nhận cả hai hình dạng: khối `{"mcpServers":{"ten":{…}}}` chép nguyên từ
      // README, và khối cấu hình trần. Bắt người dùng bóc tay là bắt họ hiểu một
      // định dạng — đúng thứ cả §6 sinh ra để tránh.
      const servers = parsed['mcpServers'];
      if (servers && typeof servers === 'object') {
        /**
         * ⚠ `[0]` — CHỈ SERVER ĐẦU TIÊN. Đây là một quyết định, và nó phải được
         * **nói ra ở màn hình** chứ không nằm im trong chú thích: xem `extraServers`.
         * Một khối README có hai server thì bấm Xong xong người dùng nhận đúng
         * một cánh tay và **không có triệu chứng nào**.
         * → [[agentco-silent-allowlist]]
         */
        const [name, cfg] = Object.entries(servers as Record<string, unknown>)[0] ?? [];
        if (name && !label) setLabel(name);
        return (cfg as Record<string, unknown>) ?? null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 SỐ THỨ TỰ LƯỢT THỬ — chặn PHẢN HỒI CŨ ĐÈ LÊN PHẢN HỒI MỚI.           │
   * │ (bug user bắt 26/08)                                                     │
   * │                                                                          │
   * │   *"tôi chọn 1 thư mục, nó đang kết nối, tôi nhanh tay chuyển sang 1 thư │
   * │    mục khác (Music)… lúc này quá trình test là test của cái nào??"*      │
   * │                                                                          │
   * │ Của cái ĐẦU. Một lượt thử mất 8–20 giây; đổi thư mục giữa chừng thì lượt │
   * │ cũ **vẫn đang bay**, và khi nó về, `setProbe` ghi kết quả của thư mục A   │
   * │ lên màn hình đang cấu hình thư mục B. Người dùng thấy ✓, bấm Xong, và    │
   * │ cấu hình được lưu là B — **B chưa bao giờ được thử.**                    │
   * │                                                                          │
   * │ Đây đúng lớp lỗi *"hệ thống nói dối về trạng thái của chính nó"*, và nó  │
   * │ tệ hơn một lỗi thường: dấu ✓ là **toàn bộ** thứ bước 2 tồn tại để bán.   │
   * │                                                                          │
   * │ ⚠ Không dùng `AbortController` cho việc này: huỷ được request HTTP nhưng │
   * │ **không** huỷ được phép thử đang chạy ở server (nó đã spawn tiến trình   │
   * │ MCP). Thứ ta cần không phải "dừng lượt cũ" mà là **"đừng nghe lượt cũ"**.│
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const runRef = useRef(0);

  async function test() {
    const p = payload();
    if (!p) {
      setErr(
        pick?.needsLogin && !account
          ? 'Đăng nhập một tài khoản trước đã.'
          : needGroups() && !groups.length
            ? 'Tick ít nhất một nhóm việc trước đã.'
            : pick?.folders
              ? 'Chọn ít nhất một thư mục.'
              : 'Chưa đọc được cấu hình — kiểm lại khối JSON.',
      );
      return;
    }
    setErr('');
    setTesting(true);
    setSlow(false);
    setProbe(null);
    const mine = ++runRef.current;
    const tick = setTimeout(() => setSlow(true), 6_000);
    try {
      const k = filledKeys();
      /**
       * ⚠ `office` PHẢI ĐI KÈM, dù nút Thử không cắm gì vào văn phòng nào.
       *
       * Ô trống `<OFFICE_STATE>` được điền **theo văn phòng** (`server.ts
       * §officeStateDir`). Thiếu nó thì lượt Thử chạy với đường dẫn còn nguyên ô
       * trống ⇒ trình duyệt đẻ một thư mục tên `<OFFICE_STATE>` cạnh daemon, và
       * quan trọng hơn: **nút Thử kiểm một cấu hình khác thứ sẽ chạy** — đúng bất
       * biến mà `injectSecrets` sinh ra để giữ.
       */
      const r = await api.testArm('thu', {
        ...p,
        ...(Object.keys(k).length ? { secrets: k } : {}),
        ...(officeId ? { office: officeId } : {}),
      });
      // ⚠ CHỐT: cấu hình đã đổi trong lúc lượt này đang bay ⇒ kết quả này nói về
      // một thứ KHÁC với thứ đang trên màn hình. Vứt nó đi, im lặng — lượt mới
      // đã chạy rồi và nó mới là lượt đúng. → `runRef`
      if (mine !== runRef.current) return;
      setProbe(r);
    } catch (e) {
      if (mine !== runRef.current) return;
      setErr(e instanceof ApiError ? e.message : 'Không thử được.');
    } finally {
      // `testing`/`slow` chỉ được tắt bởi lượt MỚI NHẤT: lượt cũ về sau lượt mới
      // mà tắt spinner là màn hình báo "xong" trong khi vẫn đang chờ.
      if (mine === runRef.current) {
        clearTimeout(tick);
        setTesting(false);
        setSlow(false);
      }
    }
  }

  async function save() {
    const p = payload();
    const name = (label || pick?.name || '').trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      const k = filledKeys();
      await api.addArm({
        ...(name ? { label: name } : {}),
        ...p,
        ...(Object.keys(k).length ? { secrets: k } : {}),
        ...(officeId ? { office: officeId } : {}),
        ...(grant.length ? { grantTo: grant } : {}),
      });
      // Đọc lại canvas từ server thay vì vá state tại chỗ: node MCP do
      // `layout.read()` TÁI TẠO từ `company.mcpServers`, nên nguồn sự thật nằm ở
      // server. Vá tay là dựng một bản sao thứ hai của cùng một luật.
      await actions.refreshCanvas();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ✓ CHƯA ĐỦ ĐỂ ĐI TIẾP — vế thứ hai là **cấu hình còn hợp lệ không**.      │
   * │                                                                          │
   * │ Ca thật: thử ở nấc chỉ đọc (✓), rồi đổi sang **toàn quyền**. Bộ chọn      │
   * │ nhóm việc hiện ra với 0 ô tick, nhưng dấu ✓ cũ vẫn còn ⇒ nút Tiếp vẫn     │
   * │ bấm được ⇒ lưu một cánh tay toàn quyền rơi về nhóm MẶC ĐỊNH, tức rộng     │
   * │ hơn thứ người dùng vừa được hỏi. Hỏng theo chiều **nới quyền**, và không  │
   * │ có triệu chứng nào trên màn hình.                                        │
   * │                                                                          │
   * │ Đúng họ với `runRef`: *một dấu ✓ nói về một cấu hình khác với cấu hình    │
   * │ đang trên màn hình*. Ở đó nó lệch vài giây, ở đây nó lệch qua một cú bấm. │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const ok =
    probe?.status === 'connected' &&
    !probe.warn &&
    /**
     * 🔴 THỬ TẦM VỚI HỎNG ⇒ KHÔNG CHO ĐI TIẾP. (user bắt 27/08)
     *
     *   *"Hiện tại báo warning 404 nè mà vẫn cho đi Tiếp là sao"*
     *
     * Đúng, và nó là một mâu thuẫn tự mình gây ra: màn hình vừa nói *"chưa với
     * tới repo này"* rồi vừa mở cửa đi tiếp. Người dùng đọc được hai câu ngược
     * nhau và sẽ tin **cái nút**, không tin dòng chữ — nút là thứ họ bấm được.
     *
     * Một cảnh báo mà không chặn gì thì không phải cảnh báo, nó là trang trí,
     * và nó dạy người dùng bỏ qua mọi cảnh báo khác. Cùng lý lẽ đã dùng cho
     * nhãn ÔI (*"nhãn kêu bừa thì người dùng học cách bỏ qua nó"*).
     */
    /**
     * 🔴 CHƯA CÀI APP VÀO REPO NÀO ⇒ KHÔNG CHO ĐI TIẾP. (user chốt 27/08)
     *
     *   *"Nếu không có hoặc người dùng không cài đặt thì yêu cầu người dùng
     *    install trước khi được phép đi tiếp"*  ·  *"báo warning 404 nè mà vẫn
     *    cho đi Tiếp là sao"*
     *
     * Chặn **chỉ khi tra được và ra rỗng**. Hai ca còn lại đi qua:
     *   · `failed`  — không tra được, chặn là chặn oan (mạng chập cũng ra thế)
     *   · `anyway`  — người dùng khẳng định đã cài, và họ có thể đúng: phép tra
     *                 mù với repo của TỔ CHỨC.
     *
     * Cặp "chặn + đường thoát tường minh" là chỗ đứng giữa hai cái hỏng: cảnh
     * báo suông thì không ai đọc, còn chặn cứng thì giam người đã làm đúng.
     */
    !(scan && !('failed' in scan) && scan.installed.length === 0 && !anyway) &&
    !(needGroups() && !groups.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        RỘNG HƠN MẶC ĐỊNH — 46rem thay cho 28rem. (user chốt 01/09)

        Không phải chuyện thẩm mỹ: tab Lệnh đặt **nhãn cùng dòng với ô nhập**
        (`Field`), và ở 28rem thì cột nhãn 150px ăn hết một phần ba, còn ô Cú pháp
        — thứ chứa một dòng lệnh thật — hẹp tới mức phải cuộn ngang để đọc lại
        chính cái mình vừa gõ.

        ⚠ Rộng cho CẢ hộp thoại, không riêng tab Lệnh: một modal đổi bề rộng khi
        chuyển tab là cả trang nhảy dưới tay người đang bấm.
      */}
      <DialogContent className={DIALOG_W}>
        <DialogHeader>
          <DialogTitle>
            {step === 1
              ? 'Cắm một kết nối'
              : step === 2
                ? /*
                    Hình đi CÙNG tên ở bước 2 — đây là "xuyên suốt các nấc bên
                    trong" (user 27/08). Nó cũng là một cái chốt kiểm bằng mắt:
                    bấm nhầm thẻ ở bước 1 thì thấy ngay từ đây, chứ không phải
                    đợi tới lúc đọc tên hãng trong một câu dài.
                  */
                  (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-muted">
                        <ArmIcon
                          mark={pick ? pick.brand.mark : markOf(reuse?.catalog, catalog)}
                          kind={
                            pick
                              ? pick.folders
                                ? 'files'
                                : 'service'
                              : reuse
                                ? kindOf(reuse, catalog)
                                : 'custom'
                          }
                          className="h-4 w-4"
                        />
                      </span>
                      Cài đặt · {pick?.name ?? label ?? ''}
                    </span>
                  )
                : 'Ai được dùng?'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Chọn một cái có sẵn, dùng lại cái đã cắm, hoặc dán cấu hình của riêng bạn.'
              : step === 2
                ? 'Bấm Thử ngay để thử kết nối.'
                : 'Kết nối chỉ hoạt động với người được nối dây tới nó.'}
          </DialogDescription>
        </DialogHeader>

        {/* ─────────────────────────────────────────────── BƯỚC 1 · Chọn */}
        {step === 1 && (
          <div className="max-h-[52vh] overflow-y-auto">
            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ CHỌN LOẠI TRƯỚC, chọn dịch vụ sau. (user chốt 23/08)         │
              │                                                              │
              │ Bản trước bày thẳng thẻ danh mục: "File trên máy" đứng ngang │
              │ hàng với "Notion". Sai tầng — người dùng nghĩ *"cho nó đọc    │
              │ thư mục này"*, họ KHÔNG nghĩ *"cài một MCP server"*. Chuyện   │
              │ thư mục được thi hành BẰNG một MCP là việc của ta, không phải│
              │ của họ, và bày nó ra là bắt họ học từ vựng của mình.          │
              │                                                              │
              │ Ba loại này khác nhau ở thứ NGƯỜI DÙNG phải làm tiếp, không  │
              │ ở thứ chạy bên dưới — đó mới là trục phân loại đúng.          │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pane === 'type' && (
              // Bốn loại từ 01/09 — `grid-cols-2` chứ không phải `cols-4`: bốn thẻ
              // trên một hàng ở dialog này là bốn cột hẹp, chữ `say` xuống ba dòng.
              <div className="grid grid-cols-2 gap-2">
                <TypeCard
                  icon={<ArmIcon kind="files" className="h-6 w-6" />}
                  name="Thư mục trên máy"
                  say="chọn thư mục · không cần chìa"
                  onClick={() => {
                    const files = catalog.find((a) => a.folders);
                    if (!files) return;
                    /*
                      ┌──────────────────────────────────────────────────────┐
                      │ ĐI THẲNG VÀO BƯỚC 2 — không màn trung gian nào.      │
                      │ (user 26/08, và tôi đồng ý vì một lý do khác họ nêu) │
                      │                                                      │
                      │ Họ nói *"kiểu đem lại cảm giác phải bấm Chọn thư mục │
                      │ 2 lần"*. Gốc rễ không phải số cú bấm — **cái nút nói │
                      │ dối**: "Chọn một thư mục khác…" không mở bộ chọn nào  │
                      │ cả, nó chỉ chuyển màn. Một nút gọi tên hành động mà  │
                      │ lại đi điều hướng thì cảm giác "bấm hai lần" là ĐÚNG.│
                      │                                                      │
                      │ Sửa nhãn cũng được, nhưng bỏ hẳn màn thì tốt hơn:    │
                      │ ba loại còn lại đều có gì đó để CHỌN ở bước 1 (dịch  │
                      │ vụ nào / dán gì), riêng thư mục thì thẻ đã là lựa    │
                      │ chọn rồi. Danh sách dùng lại xuống chân bước 2.      │
                      └──────────────────────────────────────────────────────┘
                    */
                    resetConfig();
                    setPick(files);
                    // Ba đường LOẠI TRỪ NHAU. Quay lại rồi chọn đường khác mà
                    // không xoá đường cũ là để `payload()` im lặng chọn hộ.
                    setReuse(null);
                    setLabel(files.name);
                    setStep(2);
                  }}
                />
                <TypeCard
                  icon={<ArmIcon kind="service" className="h-6 w-6" />}
                  name="Dịch vụ có sẵn"
                  say={`${catalog.filter((a) => !a.folders).length} dịch vụ · điền chìa`}
                  onClick={() => setPane('catalog')}
                />
                <TypeCard
                  icon={<ArmIcon kind="cli" className="h-6 w-6" />}
                  name="CLI"
                  say="bọc một lệnh bạn đã chạy được"
                  onClick={() => {
                    setActs([blankAct()]);
                    setCliJson(null);
                    // Vào tab là vào MÀN THƯ MỤC — xem khối chú thích ở đó.
                    setCliReady(false);
                    setCliCwd('');
                    setPane('cli');
                  }}
                />
                <TypeCard
                  icon={<ArmIcon kind="custom" className="h-6 w-6" />}
                  name="Tự cắm MCP"
                  say="dán cấu hình của bạn"
                  onClick={() => setPane('paste')}
                />
              </div>
            )}

            {pane === 'catalog' && (
              <>
                <Button size="sm" className="mb-2" onClick={() => setPane('type')}>
                  ← Quay lại
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  {catalog
                    .filter((a) => !a.folders)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          resetConfig();
                          setPick(a);
                          setReuse(null);
                          setLabel(a.name);
                          setStep(2);
                        }}
                        className="rounded-lg border border-line px-3 py-3 text-left transition hover:border-accent hover:bg-accent-soft"
                      >
                        <div className="text-muted">
                          <ArmIcon mark={a.brand.mark} kind={a.shape === 'browser' ? 'browser' : a.folders ? 'files' : 'service'} className="h-6 w-6" />
                        </div>
                        <div className="mt-1 text-[13px] font-medium">{a.name}</div>
                        {/* CÁI GIÁ, không phải tính năng. → §6f */}
                        <div className="mt-0.5 text-[11px] text-muted">{PRICE_SAY[a.price]}</div>
                      </button>
                    ))}
                  {catalog.filter((a) => !a.folders).length === 0 && (
                    <p className="col-span-3 text-[13px] text-muted">
                      Chưa có dịch vụ dựng sẵn nào. Dùng <b>Tự cắm MCP</b> — nó nhận mọi server.
                    </p>
                  )}
                </div>
                {reuseList('service')}
              </>
            )}

            {/*
              MÀN TIẾP ĐẤT: đề xuất **tất cả**, không lọc. Người quay lại cắm
              cái họ đã có không nên phải đoán nó nằm trong tab nào. Lọc là để
              thu hẹp khi đã biết mình tìm gì — không phải để giấu. (user 26/08)
            */}
            {pane === 'type' && reuseList()}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ MÀN THƯ MỤC ĐỨNG TRƯỚC DANH SÁCH LỆNH. (user chốt 01/09)     │
              │                                                              │
              │  *"chọn tab → thư mục picker → sau đó tất cả danh sách lệnh  │
              │   đều được thao tác từ văn phòng đó khi được gọi"*           │
              │                                                              │
              │ Vì sao đúng chứ không chỉ vì user nói: một cánh tay CLI **là │
              │ một dự án**. Thư mục là câu hỏi có **đúng một** câu trả lời  │
              │ cho cả cánh tay, và hỏi nó ở mỗi lệnh là mời người ta gõ    │
              │ lệch — rồi lệnh thứ ba không thấy file mà không ai hiểu vì   │
              │ sao. Hỏi một lần, trả lời một lần.                          │
              │                                                              │
              │ ⚠ Và nó phải đứng TRƯỚC: viết xong năm lệnh rồi mới phát     │
              │ hiện sai thư mục là năm lệnh phải đọc lại.                   │
              │                                                              │
              │ 🔴 ĐÍNH CHÍNH 01/09 — bản đầu của tôi có HAI nút: "Chọn thư   │
              │ mục…" và "Dùng thư mục văn phòng →". User bác, và họ đúng:    │
              │                                                              │
              │   *"Chỉ có duy nhất 1 nút Chọn thư mục…, và thư mục default  │
              │    khi bấm nút đó luôn là thư mục văn phòng"*                │
              │                                                              │
              │ Hai nút đó **hỏi cùng một câu hai lần**: nút thứ hai chỉ là   │
              │ "chọn thư mục văn phòng" viết dưới dạng một lối tắt — và một  │
              │ lối tắt cho MẶC ĐỊNH thì không tiết kiệm gì, nó chỉ bắt người │
              │ ta so hai lựa chọn để hiểu ra chúng gần như một.              │
              │                                                              │
              │ ⇒ MỘT nút, và **thư mục văn phòng là chỗ bộ chọn ĐỨNG SẴN**.  │
              │ Muốn nó thì bấm Xong ngay, không phải duyệt đi đâu. Cùng số   │
              │ cú bấm, ít hơn một quyết định — và `cwd` **luôn được ghi ra**  │
              │ nên `company.yaml` nói đúng thứ sẽ chạy, không còn ca "trống  │
              │ nghĩa là ở đâu đó".                                          │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pane === 'cli' && !cliReady && (
              <>
                <Button size="sm" className="mb-3" onClick={() => setPane('type')}>
                  ← Quay lại
                </Button>
                <div className="rounded-lg border border-line p-6 text-center">
                  <div className="flex justify-center text-muted">
                    <ArmIcon kind="cli" className="h-8 w-8" />
                  </div>
                  <div className="mt-3 text-[15px] font-medium">Các lệnh sẽ chạy trong thư mục nào?</div>
                  <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
                    Mọi lệnh của kết nối này đều chạy ở đúng một chỗ — thường là thư mục dự án bạn vẫn
                    mở terminal trong đó.
                  </p>
                  <div className="mt-4 flex justify-center">
                    <Button variant="primary" onClick={() => setBrowsing(true)}>
                      <FolderOpen className="h-4 w-4" />
                      Chọn thư mục…
                    </Button>
                  </div>
                  <p className="mt-3 text-[11px] text-muted">
                    Bộ chọn mở sẵn ở <b>thư mục văn phòng</b> — bấm Xong ngay nếu lệnh của bạn không
                    đụng tới file nào.
                  </p>
                </div>
                {reuseList('cli')}
              </>
            )}

            {pane === 'cli' && cliReady && (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      // Về màn thư mục, KHÔNG về màn chọn loại: người bấm "quay
                      // lại" ở đây gần như luôn muốn đổi thư mục, và thứ họ vừa
                      // soạn thì còn nguyên.
                      setCliReady(false);
                      setCliJson(null);
                    }}
                  >
                    ← Thư mục
                  </Button>
                  {/* Hai chiều, MỘT nguồn: bật JSON thì sinh từ form; tắt thì đọc
                      ngược về form. Không giữ hai ô soạn thảo sống song song —
                      đó là ca "hai giao diện ghi cùng một thứ" đã trả giá ở skills. */}
                  <Button
                    size="sm"
                    disabled={cliJson !== null && cliMixed}
                    title={
                      cliJson !== null && cliMixed
                        ? 'Tờ khai này đặt thư mục khác nhau cho từng lệnh — form chỉ giữ được một thư mục chung'
                        : undefined
                    }
                    onClick={() => {
                      if (cliJson === null) setCliJson(JSON.stringify(draftToDecl(acts, cliCwd), null, 2));
                      else {
                        try {
                          const back = declToDraft(JSON.parse(cliJson));
                          if (back && !back.mixed) {
                            setActs(back.acts);
                            setCliCwd(back.cwd);
                          }
                        } catch {
                          /* JSON hỏng ⇒ giữ nguyên form, ô đỏ của JsonBox đã nói rồi */
                        }
                        setCliJson(null);
                      }
                    }}
                  >
                    {cliJson === null ? 'Xem JSON' : '← Về form'}
                  </Button>
                  {/*
                    MẪU CHẠY ĐƯỢC NGAY — và nó điền vào **ô đang mở**, không phải
                    lúc nào cũng vào form. Nút "thêm mẫu" mà nhảy màn hình là bắt
                    người đang đọc JSON phải quay lại tìm chỗ họ vừa đứng.
                  */}
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      const one = [sampleAct()];
                      if (cliJson === null) setActs(one);
                      else setCliJson(JSON.stringify(draftToDecl(one, cliCwd), null, 2));
                    }}
                  >
                    Điền mẫu chạy thử
                  </Button>
                </div>

                {/*
                  THANH THƯ MỤC — hiện ở MỌI lúc soạn, kể cả khi đang xem JSON.
                  Nó là thứ duy nhất trên màn hình trả lời câu *"lệnh này chạy ở
                  đâu"*, và câu đó không được biến mất khi đổi cách xem.
                */}
                <div className="mb-3 flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1 break-all font-mono text-[12px]">
                    {/*
                      ┌──────────────────────────────────────────────────────┐
                      │ 🔴 Ô TRỐNG PHẢI ĐƯỢC GỌI TÊN. (bug user bắt 01/09:   │
                      │ *"hiện giờ nó đang trống trơn nên chả biết là gì"*)  │
                      │                                                      │
                      │ Đường form không bao giờ để `cwd` rỗng nữa — nhưng   │
                      │ đường **dán** thì có: một tờ khai không khai `cwd`   │
                      │ là hợp lệ, và nó **thật sự chạy ở thư mục văn        │
                      │ phòng**. Trạng thái đó có thật ⇒ màn hình phải nói   │
                      │ ra, không được vẽ một cái hộp trắng.                 │
                      │                                                      │
                      │ ⚠ Và đây KHÔNG mâu thuẫn với việc bỏ nút "Bỏ":       │
                      │ **hiện một trạng thái ≠ mời người ta vào trạng thái  │
                      │ đó.** Nút Bỏ là lời mời; nhãn này là lời khai.       │
                      └──────────────────────────────────────────────────────┘
                    */}
                    {cliMixed ? (
                      <span className="font-sans text-warn">Khác nhau theo từng lệnh</span>
                    ) : shownCwd ? (
                      shownCwd
                    ) : (
                      <span className="font-sans text-muted">Thư mục văn phòng (mặc định)</span>
                    )}
                  </div>
                  {/*
                    ⚠ CHỈ "Đổi…", KHÔNG có "Bỏ" (user chốt 01/09). Sau khi màn
                    thư mục còn một nút, đường form **luôn** đặt `cwd` — nên một
                    nút "Bỏ" ở đây là mời người ta quay lại đúng cái trạng thái
                    mà màn hình không nói ra được chỗ lệnh sẽ chạy.

                    ⚠ Và nó BIẾN MẤT ở chế độ JSON: ở đó thứ được lưu là khối
                    JSON, nên một nút sửa `cliCwd` là một nút không có tác dụng.
                    `cwd` sửa ngay trong khối.
                  */}
                  {cliJson === null ? (
                    <Button size="sm" onClick={() => setBrowsing(true)}>
                      Đổi…
                    </Button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted">sửa trong JSON</span>
                  )}
                </div>

                {cliJson !== null ? (
                  <>
                    <JsonBox value={cliJson} onChange={setCliJson} />
                    {/*
                      ⚠ Cờ `mixed` phải NÓI RA, không chỉ làm mờ một cái nút. Một
                      nút mờ không giải thích được vì sao nó mờ.
                    */}
                    {cliMixed && (
                      <p className="mt-1 text-[11px] text-warn">
                        Tờ khai này đặt <b>thư mục khác nhau cho từng lệnh</b>. Form chỉ giữ được một
                        thư mục chung, nên nó không đọc ngược được — sửa tiếp ở đây, hoặc cho các lệnh
                        về cùng một <code>cwd</code>.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    {acts.map((a, i) => {
                      const argv = toArgv(a.line);
                      const names = slots(argv);
                      // Ví dụ khớp cú pháp không? `null` = KHÔNG — và màn hình
                      // phải nói ra, chứ không được lặng lẽ bỏ ví dụ đi.
                      const vals = a.example.trim() ? alignExample(argv, toArgv(a.example)) : undefined;
                      const set = (patch: Partial<CliDraft>): void =>
                        setActs((prev) => prev.map((x, j) => (i === j ? { ...x, ...patch } : x)));
                      return (
                        <div key={i} className="rounded-lg border border-line p-3">
                          <div className="mb-2 flex items-center justify-between">
                            {/* "Lệnh", không phải "Việc" (user 01/09). Ở tab này
                                đơn vị người dùng đang soạn LÀ một dòng lệnh — gọi
                                nó là "việc" là mượn từ vựng của tầng khác. */}
                            <span className="text-xs font-medium">Lệnh {i + 1}</span>
                            {acts.length > 1 && (
                              <button
                                type="button"
                                className="text-xs text-muted hover:text-danger"
                                onClick={() => setActs((p) => p.filter((_, j) => j !== i))}
                              >
                                Bỏ
                              </button>
                            )}
                          </div>

                          {/* ⚠ MỌI Ô ĐỀU CÓ NHÃN, và nhãn nằm **cùng dòng** với ô
                              (user 01/09). Placeholder không phải nhãn: nó biến
                              mất đúng lúc người ta gõ, nên ai quay lại sửa sẽ
                              nhìn một ô không tên. → `Field` */}
                          <Field htmlFor={`cli-say-${i}`} label="Tên">
                            <Input
                              id={`cli-say-${i}`}
                              placeholder="đếm hoá đơn chưa thanh toán"
                              value={a.say}
                              onChange={(e) => set({ say: e.target.value })}
                            />
                            {/*
                              🔴 BÁO Ở Ô **TÊN**, không phải ở một ô "mã" nào cả —
                              vì người dùng không gõ mã, họ gõ tên, và mã do
                              `slugId(tên)` sinh ra. Báo ở chỗ họ sửa được.

                              ⚠ Và câu chữ nói về **bệnh**, không về triệu chứng:
                              hai lệnh trùng mã thì nhân viên cũng không phân biệt
                              được chúng qua `does`. Tự thêm hậu tố `_2` cho xong
                              là giấu đúng cái phần vẫn còn nguyên. → `dupIds`
                            */}
                            {a.say.trim() ? (
                              badIds.includes(slugId(a.say)) && (
                                <p className="mt-1 text-[11px] text-danger">
                                  Trùng tên với một lệnh khác (cùng ra mã{' '}
                                  <code className="rounded bg-danger-soft px-1">{slugId(a.say)}</code>
                                  ). Nhân viên sẽ không phân biệt được hai lệnh này — đổi tên một
                                  trong hai.
                                </p>
                              )
                            ) : (
                              /* Chỉ đỏ khi có LỆNH KHÁC đang chờ, hoặc người dùng
                                 đã gõ dở ở ô khác — một form vừa mở mà đã đỏ sẵn
                                 là mắng người chưa làm gì. */
                              (acts.length > 1 || a.line.trim() || a.description.trim()) && (
                                <p className="mt-1 text-[11px] text-danger">Chưa đặt tên cho lệnh này.</p>
                              )
                            )}
                          </Field>

                          <Field
                            htmlFor={`cli-line-${i}`}
                            label="Cú pháp"
                          >
                            <Input
                              id={`cli-line-${i}`}
                              className="font-mono text-[12px]"
                              placeholder={'node count.js --month {month}'}
                              value={a.line}
                              onChange={(e) => set({ line: e.target.value })}
                            />
                            {/* ⭐ HIỆN LẠI ARGV. Phép tách dòng lệnh là một PHÉP
                                ĐOÁN, và một phép đoán chỉ được phép tồn tại khi
                                người dùng NHÌN THẤY kết quả của nó. → `toArgv` */}
                            {argv.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {argv.map((t, k) => (
                                  <code key={k} className="rounded bg-accent-soft px-1 text-[11px]">
                                    {t}
                                  </code>
                                ))}
                              </div>
                            ) : (
                              (acts.length > 1 || a.say.trim() || a.description.trim()) && (
                                <p className="mt-1 text-[11px] text-danger">
                                  Chưa có dòng lệnh nào để chạy.
                                </p>
                              )
                            )}
                          </Field>

                          {/*
                            ┌──────────────────────────────────────────────────┐
                            │ ⭐ Ô VÍ DỤ **LUÔN HIỆN**. (user 01/09: *"sao Mẫu │
                            │ có Ví dụ mà trong các trường tự điền lại không   │
                            │ có Trường Ví dụ?"*)                              │
                            │                                                  │
                            │ Bản trước ẩn nó khi cú pháp chưa có ô trống, lý  │
                            │ lẽ *"không có gì để điền thì ví dụ dạy ai"*. Lý  │
                            │ lẽ đó đúng **về phía model** và sai **về phía    │
                            │ người dùng**: một ô tự mọc ra rồi tự biến mất là │
                            │ thứ không ai đoán được luật — và nó giấu đi đúng │
                            │ lúc người ta cần nó nhất, tức là lúc chưa biết   │
                            │ mình cần một ô trống.                            │
                            │                                                  │
                            │ ⇒ Luôn hiện, và khi CHƯA có ô trống thì nó **đổi │
                            │ vai**: so ví dụ với cú pháp để **chỉ ra chỗ đáng │
                            │ làm ô trống**. Người dùng không phải học khái    │
                            │ niệm "tham số" trước — họ dán hai dòng lệnh thật │
                            │ và máy chỉ vào chỗ khác nhau. → `ExampleNoSlot`  │
                            └──────────────────────────────────────────────────┘
                          */}
                          <Field htmlFor={`cli-ex-${i}`} label="Ví dụ">
                            <Input
                              id={`cli-ex-${i}`}
                              className="font-mono text-[12px]"
                              placeholder="node count.js --month 8"
                              value={a.example}
                              onChange={(e) => set({ example: e.target.value })}
                            />
                            {/*
                              ⚠ KHÔI PHỤC 01/09 — bản trên máy vừa gỡ hai dòng
                              này, và gỡ chúng thì `vals` thành biến không ai
                              đọc (build đỏ), nhưng đó chưa phải lý do chính:

                              Đây là **bằng chứng nhìn thấy được duy nhất** rằng
                              ví dụ đã được bóc ra — thứ đi vào prefix của model
                              chính là `ten = 8`, không phải cả dòng lệnh. Bỏ nó
                              thì `alignExample` chạy hay không chạy trông y hệt
                              nhau, và ô đo J-5 mất chỗ để nhìn.
                              → luật của `toArgv`: đoán thì phải hiện kết quả.
                            */}
                            {names.length === 0 ? (
                              <ExampleNoSlot line={a.line} example={a.example} />
                            ) : vals === null ? (
                              <p className="mt-1 text-[11px] text-danger">
                                Ví dụ không khớp cú pháp — phải cùng số mảnh và giống hệt ở những chỗ
                                không phải ô trống.
                              </p>
                            ) : null}
                          </Field>

                          <Field
                            htmlFor={`cli-desc-${i}`}
                            label="Miêu tả"
                          >
                            <Textarea
                              id={`cli-desc-${i}`}
                              rows={2}
                              className="text-[13px]"
                              placeholder="Nó làm gì, kết quả khi mong đợi chạy, có ghi đè không, hoàn tác được không"
                              value={a.description}
                              onChange={(e) => set({ description: e.target.value })}
                            />
                          </Field>

                          {/*
                            ┌──────────────────────────────────────────────────┐
                            │ "LỆNH CHỈ ĐỌC" — user chốt lại 01/09 sau khi bản  │
                            │ trước của tôi viết dài thành một câu hỏi.        │
                            │                                                  │
                            │ Họ đúng: ở đây nhãn ngắn **đọc được ngay** vì nó │
                            │ đứng cùng dòng với ô tick, trong một form mà mọi │
                            │ dòng khác cũng là `nhãn — ô`. Câu hỏi dài phá vỡ  │
                            │ đúng cái nhịp đó.                                │
                            │                                                  │
                            │ ⚠ Giữ nguyên hai điều: mặc định **không tick**    │
                            │ (`read_only = false`, tức "có thay đổi" — an toàn │
                            │ đúng chiều khi chưa ai trả lời), và **nói thật    │
                            │ rằng nó là nhãn chứ không phải khoá**. Sau khi bỏ │
                            │ nấc quyền cho CLI (30/08), ô này chỉ dựng          │
                            │ `annotations`; vẽ nó như một cái khoá là để giao  │
                            │ diện nói dối về thứ nó không thi hành.            │
                            │ → [[agentco-safe-default-direction]]              │
                            └──────────────────────────────────────────────────┘
                          */}
                          <Field label="Lệnh chỉ đọc?">
                            <label className="flex cursor-pointer items-center gap-2 py-2 text-[13px]">
                              <input
                                type="checkbox"
                                checked={a.read_only}
                                onChange={(e) => set({ read_only: e.target.checked })}
                              />
                              <span className="text-muted">
                                Để trống nếu không chắc.
                              </span>
                            </label>
                          </Field>

                          {/*
                            🔴 `fail_when` ĐÃ RA KHỎI FORM (user hỏi 01/09, và câu
                            hỏi của họ đúng) — xem `SPEC-arms §16v`. Trường vẫn
                            sống trong tờ khai, vẫn chở qua form nguyên vẹn
                            (`CliDraft.fail_when`), chỉ soạn được ở tab JSON.
                            ĐỪNG dựng lại ô này ở đây kèm placeholder
                            `ERROR, FAILED, Traceback`: đó chính là ba chuỗi hay
                            xuất hiện nhất trong output LÀNH.
                          */}
                        </div>
                      );
                    })}
                    <Button size="sm" onClick={() => setActs((p) => [...p, blankAct()])}>
                      + Thêm lệnh
                    </Button>
                    {/* Trần 3–8 lệnh (§16h): mỗi việc là một định nghĩa tool nằm
                        trong prefix MỌI lượt. Cảnh báo, không chặn — tiền của khách. */}
                    {acts.length > 8 && (
                      <p className="text-xs text-muted">
                        Hơn 8 việc trong một kết nối thì mỗi lượt làm việc đều phải cõng cả danh sách.
                        Nên tách thành hai kết nối.
                      </p>
                    )}
                  </div>
                )}

                {/* Ở chế độ JSON không có ô Tên/Cú pháp nào để bôi đỏ, nên đây là
                    chỗ DUY NHẤT nói ra vì sao nút dưới bị mờ. Một nút mờ không
                    giải thích được chính nó. */}
                {cliJson !== null && (badIds.length > 0 || cliBad.length > 0 || cliOut === null) && (
                  <p className="mt-2 text-[11px] text-danger">
                    {cliOut === null
                      ? 'Khối JSON đang hỏng — sửa xong mới lưu được.'
                      : badIds.length > 0
                        ? `Hai lệnh cùng mã ${badIds.map((x) => `"${x}"`).join(', ')} — mỗi lệnh phải có mã riêng.`
                        : `Lệnh ${cliBad[0]!.at + 1}: ${cliBad[0]!.say}`}
                  </p>
                )}
                <Button
                  className="mt-2 w-full"
                  variant="primary"
                  disabled={!cliOk}
                  onClick={() => {
                    const decl = cliOut;
                    if (!decl) return;
                    setKeys({});
                    setProbe(null);
                    setErr('');
                    setPick(null);
                    setReuse(null);
                    // Đi tiếp bằng ĐÚNG đường của tab dán — không đẻ đường lưu thứ hai.
                    setPaste(JSON.stringify(decl, null, 2));
                    setStep(2);
                  }}
                >
                  Dùng cấu hình này
                </Button>
                {/* CHỈ cánh tay LỆNH — xem `kindOf`. Gợi ý một cánh tay HTTP ở
                    đây là gợi ý thứ mà chính tab này từ chối dán. */}
                {reuseList('cli')}
              </>
            )}

            {/*
              MỘT bản `BrowseDialog` cho cả tab Lệnh — dùng cho **cả** màn thư mục
              đứng trước lẫn nút "Đổi…" ở thanh trên. Hai bản là hai cây thư mục
              sống song song, và chúng lệch nhau ngay lần mở thứ hai.

              ⚠ `start={cliCwd}`: mở lại ĐÚNG thư mục đang chọn, **không** lấy
              `LAST_DIR` (user chốt 01/09: *"ngoại trừ phần lấy cache default"*).
              Cache đó là trí nhớ của cánh tay THƯ MỤC; mượn nó ở đây là mở ra một
              chỗ chẳng liên quan gì tới cánh tay đang soạn.
            */}
            {pane === 'cli' && (
              <BrowseDialog
                open={browsing}
                start={cliCwd}
                office={officeId}
                onOpenChange={setBrowsing}
                onChange={(v) => {
                  if (!v[0]) return;
                  setCliCwd(v[0]);
                  setCliReady(true);
                  setBrowsing(false);
                }}
              />
            )}

            {pane === 'paste' && (
              <>
                <Button size="sm" className="mb-2" onClick={() => setPane('type')}>
                  ← Quay lại
                </Button>
                <JsonBox value={paste} onChange={setPaste} />
                {/*
                  ┌────────────────────────────────────────────────────────────┐
                  │ DÁN NHẦM TAB ⇒ CHỈ ĐƯỜNG, VÀ ĐI HỘ LUÔN. (bật 01/09)      │
                  │                                                            │
                  │ Cùng cơ chế `ProbeReport(hasLoginButton, match)` 31/08:     │
                  │ nhận ra thứ vừa dán rồi trỏ đúng cửa, thay vì để họ bấm    │
                  │ Thử → hỏng → không hiểu gì.                                │
                  │                                                            │
                  │ ⚠ Một cái nút ĐƯA HỌ SANG kèm nội dung, chứ không phải một │
                  │ câu bảo họ tự đi: câu chữ mà bắt người ta dán lại lần nữa  │
                  │ thì đúng bằng không nói. Và luật này sống ở GIAO DIỆN —     │
                  │ lõi vẫn nhận tờ khai CLI từ mọi đường. → `cli-arm.ts`       │
                  └────────────────────────────────────────────────────────────┘
                */}
                {isCliPaste(paste) ? (
                  <div className="mt-1 rounded-md border border-warn/40 p-2">
                    <p className="text-xs">
                      Đây là tờ khai <b>lệnh</b>, không phải cấu hình MCP — nên tab này không dựng
                      được nó.
                    </p>
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        /*
                          ┌──────────────────────────────────────────────────┐
                          │ SANG THẲNG **TAB JSON**, không sang form.        │
                          │ (user 01/09: *"với cơ chế thêm folder thì cái    │
                          │ chuyển paste json sang cli không còn hiệu        │
                          │ nghiệm nữa"* — và họ đúng)                       │
                          │                                                  │
                          │ Từ hôm nay thư mục là của **cả cánh tay**, nên   │
                          │ một tờ khai gõ tay đặt `cwd` khác nhau từng lệnh │
                          │ **không đọc ngược về form được**. Đổ nó vào form │
                          │ là im lặng dời chỗ chạy của n−1 lệnh.            │
                          │                                                  │
                          │ ⇒ Rơi vào **ô JSON của tab Lệnh**: nguyên văn    │
                          │ sang nguyên văn, không đi qua phép biến đổi nào. │
                          │ Người dùng muốn về form thì tự bấm — và lúc đó   │
                          │ nút ấy đã bị khoá nếu `cwd` lệch nhau.           │
                          └──────────────────────────────────────────────────┘
                        */
                        const back = declToDraft(safeJson(paste));
                        setActs(back && !back.mixed ? back.acts : [blankAct()]);
                        setCliCwd(back && !back.mixed ? back.cwd : '');
                        setCliJson(paste);
                        setCliReady(true);
                        setPane('cli');
                      }}
                    >
                      Mở tab Lệnh với nội dung này →
                    </Button>
                  </div>
                ) : extraServers.length > 0 ? (
                  /*
                    ┌──────────────────────────────────────────────────────────┐
                    │ 🔴 KHỐI CÓ NHIỀU SERVER — ta chỉ cắm CÁI ĐẦU. (user hỏi  │
                    │ 01/09: *"kiểm tra bên custom mcp có bị leak không"* —    │
                    │ có, và đây là chỗ đó.)                                    │
                    │                                                          │
                    │ `parsePaste` lấy `Object.entries(mcpServers)[0]` và bỏ    │
                    │ phần còn lại **không một câu nào**. README của nhiều hãng │
                    │ liệt kê 2–3 server trong một khối, nên đây không phải ca  │
                    │ hiếm: người dùng bấm Xong, thấy ✓, và mất một cánh tay    │
                    │ mà **không có triệu chứng nào**.                          │
                    │                                                          │
                    │ ⚠ KHÔNG chặn — cắm cái đầu là hành vi đúng và hữu ích.   │
                    │ Thứ thiếu chỉ là **nói ra**: ta lấy cái nào, và những cái │
                    │ kia cắm bằng cách nào. Cùng luật với `ProbeReport`: hỏng  │
                    │ im lặng thì ít nhất giao diện đừng im lặng theo.          │
                    └──────────────────────────────────────────────────────────┘
                  */
                  <p className="mt-1 text-xs text-warn">
                    Khối này có {extraServers.length + 1} server. Chỉ <b>{firstServer}</b> được cắm —
                    {' '}
                    {extraServers.map((n) => <code key={n} className="mx-0.5 rounded bg-accent-soft px-1">{n}</code>)}
                    {' '}
                    thì dán riêng thành một kết nối nữa.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    Nhận cả khối <code>{'{"mcpServers": {...}}'}</code> chép nguyên từ tài liệu.
                  </p>
                )}
                <Button
                  className="mt-2 w-full"
                  disabled={!paste.trim() || isCliPaste(paste)}
                  onClick={() => {
                    // ⚠ KHÔNG `resetConfig()` ở đây: nó xoá luôn `paste`, mà
                    // `paste` chính là thứ người dùng vừa gõ để đi tiếp. Cửa này
                    // là cửa duy nhất mà cấu hình được nhập NGAY TẠI bước 1.
                    setKeys({});
                    setProbe(null);
                    setErr('');
                    setPick(null);
                    setReuse(null);
                    setStep(2);
                  }}
                >
                  Dùng cấu hình này
                </Button>
                {/*
                  🔴 THIẾU TỪ ĐẦU — hai tab kia có, tab này không. (user bắt 31/08)

                  Luật 26/08 (khối chú thích ở `reuseList`) chốt: *"vào type riêng
                  mới lọc theo type đó"* — và ba tab đều phải có danh sách dùng
                  lại của loại mình. `catalog` có `reuseList('service')`, bước 2
                  của `files` có `reuseList('files')`, còn `paste` thì **không có
                  dòng nào**. Không phải một quyết định, chỉ là sót.

                  Hậu quả nặng hơn ở đúng tab này: cánh tay tự cắm là loại **duy
                  nhất** không có thẻ danh mục để bấm lại, nên thiếu danh sách này
                  thì đường dùng lại của nó là **dán lại cấu hình bằng tay** — tức
                  là nhân bản, đúng thứ §6i-bis đã mất công gỡ.
                */}
                {reuseList('custom')}
              </>
            )}

            {/* Bước 1 cũng cần chỗ nói lỗi: nút "xoá hẳn" sống ở đây, và server
                từ chối được (mục vẫn còn ai đó giữ). Nuốt câu đó là bấm xong
                không thấy gì xảy ra. */}
            {err && <p className="mt-2 text-xs text-danger">{err}</p>}
          </div>
        )}

        {/* ─────────────────────────────────────── BƯỚC 2 · Chìa & Thử ngay */}
        {step === 2 && (
          <div className="max-h-[52vh] overflow-y-auto">
            {/*
              ⚠ TÊN Ở ĐÂY CHỈ ĐỂ ĐỌC — ô sửa đã BỎ (user bắt được: "cũng có edit
              được đâu, đã test").

              Ô cũ nói dối thật: `addArm` giữ nhãn đã có trong sổ chung nếu mục
              đó từng tồn tại (*"cắm lại một thứ từng đặt tên thì cái tên đó là
              của họ"*), nên gõ tên mới vào lúc CẮM LẠI bị bỏ qua âm thầm.

              Sửa theo hướng thật thà hơn: tên lúc tạo là TỰ SINH, và đổi tên là
              một việc riêng ở bảng chi tiết — nơi nó chạy thật, và nơi user đã
              chỉ định từ đầu (*"không phải ở bước tạo mà là sau đó"*).
            */}
            {label && (
              <div className="mb-3 rounded-md border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Tên kết nối</div>
                <div className="mt-0.5 break-all text-[13px] font-medium">{label}</div>
                {/*
                  ┌──────────────────────────────────────────────────────────┐
                  │ NÓI RA WORKSPACE + MỨC QUYỀN NGAY Ở ĐÂY. (user 26/08)    │
                  │                                                          │
                  │   *"ít nhất phải cho biết tên workspace, quyền hiện tại"*│
                  │                                                          │
                  │ Màn này trước chỉ ghi "Notion" — đúng nhưng vô dụng khi  │
                  │ người dùng có ba workspace. Hai mẩu này đến từ state của │
                  │ chính màn (`account`, `tier`), nên chúng **luôn khớp** với│
                  │ thứ nút Xong sắp gửi đi.                                 │
                  │                                                          │
                  │ ⚠ TRẢ LỜI CÂU USER LO — *"hay lại giả edit tiếp?"*: KHÔNG.│
                  │ Đây là màn **TẠO MỚI**, nên mức quyền ở đây là một lựa    │
                  │ chọn thật. Thứ không sửa được là mức của một cánh tay ĐÃ │
                  │ cắm — và cách đổi nó vẫn là cắm một cái mới rồi rút cái   │
                  │ cũ (§6j). Hai màn khác nhau, hai câu trả lời khác nhau.  │
                  └──────────────────────────────────────────────────────────┘
                */}
                {(pickedAccount || (pick?.tiered && probe?.status === 'connected')) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {pickedAccount && (
                      <span className="rounded bg-line/70 px-1.5 py-0.5 text-muted">
                        {pickedAccount.label ?? pickedAccount.name}
                      </span>
                    )}
                    {pick?.tiered && probe?.status === 'connected' && (
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          tier === 'full' ? 'bg-danger-soft text-danger' : 'bg-line/70 text-muted'
                        }`}
                      >
                        {LEVEL_SAY[tier]}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {pick?.folders && (
              <>
                <Label>{pick.folders.label}</Label>
                <FolderPicker
                  busy={testing}
                  chosen={folderList()}
                  onChange={(list) => {
                    /*
                      ┌──────────────────────────────────────────────────────┐
                      │ BÁO TRÙNG NGAY LÚC CHỌN, KHÔNG ĐỢI TỚI LÚC LƯU.      │
                      │                                                      │
                      │ Chốt server vẫn là chốt THẬT (client bỏ qua được),   │
                      │ nhưng để nó bắn ở cuối thì người dùng đã đi qua: chọn│
                      │ → chờ thử ~20 giây → giao cho ai → bấm Xong → RỒI    │
                      │ MỚI bị từ chối. Bốn bước phí cho một chuyện biết      │
                      │ được ngay ở bước một.                                │
                      │                                                      │
                      │ ⚠ Chỉ so với cánh tay ĐANG DÙNG Ở VĂN PHÒNG NÀY —    │
                      │ khác văn phòng là clone độc lập, hợp lệ.             │
                      └──────────────────────────────────────────────────────┘
                    */
                    const dup = list[0] ? clashingArm(list[0], installed, officeId) : undefined;
                    if (dup) {
                      setErr(
                        `Thư mục này đã là kết nối trong văn phòng này rồi.`,
                      );
                      return;
                    }
                    setErr('');
                    setFolders(list.join('\n'));
                    // Đổi thư mục thì kết quả Thử cũ nói về một cấu hình KHÁC.
                    // Giữ dấu ✓ lại là cho Lưu một thứ chưa ai thử.
                    setProbe(null);
                    /*
                      ┌──────────────────────────────────────────────────────┐
                      │ NHÃN LÀ CHỮ NGƯỜI ĐỌC — KHÔNG SLUG, GIỮ NGUYÊN UNICODE│
                      │                                                      │
                      │ Bản trước chạy `leaf` qua bộ slug rồi dùng slug làm  │
                      │ CỔNG (`if (slug) setLabel(leaf)`). Với chữ phi-Latin  │
                      │ — 文档 · 会계 · документы — slug ra RỖNG, nên nhãn    │
                      │ không bao giờ được đặt, và node hiện nguyên cái BĂM   │
                      │ `a5e5e1306bf` lên sơ đồ.                             │
                      │                                                      │
                      │ Đúng họ với `slugId` trả rỗng cho mọi chữ phi-Latin   │
                      │ (SESSIONS_MEMORY ⑳) — một hàm chuẩn hoá viết cho      │
                      │ tiếng Việt TRÔNG NHƯ viết cho mọi ngôn ngữ.          │
                      │                                                      │
                      │ Ở đây không cần slug chút nào: nhãn không phải tên   │
                      │ thư mục, không phải khoá yaml, không phải id — danh   │
                      │ tính đã là băm, và băm luôn là `a`+hex dù đường dẫn   │
                      │ viết bằng chữ gì.                                    │
                      └──────────────────────────────────────────────────────┘
                    */
                    const leaf = list[0]?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.trim() ?? '';
                    // Gốc ổ đĩa (`D:\`) không có tên lá — rơi về chính đường dẫn
                    // thay vì để trống, vì để trống là node mang tên băm.
                    setLabel(leaf || list[0] || 'Thư mục');
                  }}
                />
                {/*
                  ┌────────────────────────────────────────────────────────────┐
                  │ MỘT KẾT NỐI = MỘT THƯ MỤC. (user chốt 23/08)               │
                  │                                                            │
                  │ Server `filesystem` NHẬN nhiều gốc (đã đo), nhưng ta cố ý   │
                  │ chỉ cho một, và lý do là ĐẶC QUYỀN TỐI THIỂU: gộp A+B vào  │
                  │ một cổng thì nhân viên chỉ cần A vẫn nhận cả B, và không   │
                  │ có cách nào tách ra sau này ngoài dựng lại từ đầu.         │
                  │                                                            │
                  │ Đổi lại: nhân viên cần ba thư mục thì trả ~3× token. Đó là │
                  │ cái giá THẤY ĐƯỢC (hiện ngay dưới đây), và lối thoát tự    │
                  │ nhiên là chọn thư mục CHA chung — một quyết định người dùng │
                  │ tự cân được, khác hẳn một ràng buộc họ không gỡ nổi.       │
                  └────────────────────────────────────────────────────────────┘
                */}
                <p className="mt-1.5 text-xs text-muted">{pick.folders.help}</p>
                <p className="mt-1 text-xs text-muted">
                  Cần nhiều chỗ thì tạo thêm kết nối hoặc chọn thư mục cha.
                </p>
                {/*
                  Danh sách dùng lại ở CHÂN bước 2, không ở một màn riêng — xem
                  khối chú thích ở thẻ "Thư mục trên máy". Đây là chỗ duy nhất
                  cánh tay thư mục dùng lại được sau khi bỏ màn trung gian, và
                  bỏ luôn nó là làm mất một đường vốn đã có dữ liệu sẵn trong sổ.
                */}
                {reuseList('files')}
              </>
            )}

            {/*
              Ô chìa được SINH RA từ danh mục — người dùng không bao giờ gõ tên
              biến. Tên đó không suy được từ giao thức: nó cần TRƯỚC handshake.
              → §5c
            */}
            {pick?.secrets.map((s) => (
              <div key={s.name} className="mt-3">
                <Label htmlFor={`k-${s.name}`}>{s.label}</Label>
                <Input
                  id={`k-${s.name}`}
                  type="password"
                  value={keys[s.name] ?? ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [s.name]: e.target.value }))}
                />
                <p className="mt-1 text-xs text-muted">↳ {s.help}</p>
              </div>
            ))}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ ĐĂNG NHẬP — 0 lần gõ chìa, và nút nằm ở ĐÂY (web UI).        │
              │                                                              │
              │ Trình duyệt bạn đang ngồi đã có sẵn phiên Notion; daemon thì │
              │ không biết gì về nó. Đó là lý do nút này ở giao diện chứ      │
              │ không phải một lệnh CLI mở trình duyệt hộ. (bài học 24/08)   │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pick?.needsLogin && (
              <div className="mt-3 rounded-md border border-line px-3 py-3">
                {accounts.length === 0 ? (
                  <>
                    <div className="text-[13px] font-medium">Chưa nối workspace nào</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      Bấm nút dưới, chọn workspace rồi bấm <b>Allow</b>. Tab sẽ tự đóng và quay lại
                      đây. <b>Không cần copy gì cả.</b>
                    </p>
                  </>
                ) : (
                  <>
                    {/*
                      "WORKSPACE", không phải "tài khoản" — user chỉ ra 26/08 và
                      đúng: kiến trúc Notion là **1 tài khoản ⇄ N workspace**, và
                      mỗi lần cấp quyền OAuth gắn với **một workspace** (token
                      mang `workspace_id`/`workspace_name`). Gọi nó là "tài
                      khoản" là dùng từ vựng của ta cho một khái niệm của họ, rồi
                      để người dùng tự dịch.
                    */}
                    <div className="text-[11px] uppercase tracking-wide text-muted">Dùng workspace</div>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {accounts.map((a) => (
                        <div key={a.name} className="flex items-center gap-1">
                          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent">
                            <input
                              type="radio"
                              name="oauth-account"
                              checked={account === a.name}
                              // Đổi workspace ⇒ dọn SẠCH phía sau (nấc, nhóm việc,
                              // phép thử, bản cài). → `chooseAccount`
                              onChange={() => chooseAccount(a.name)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{a.label ?? a.name}</span>
                              {/*
                                Chìa chết ⇒ NÓI RA NGAY ĐÂY, cạnh cái tên. Không
                                nói thì triệu chứng duy nhất là cánh tay 401 im
                                lặng lúc một nhân viên đang làm việc — xa nguyên
                                nhân, và câu 401 nói "chìa sai" chứ không nói
                                "chìa chết, bấm Đăng nhập". → §5m, tầng vòng đời.
                              */}
                              {a.dead && (
                                <span className="mt-0.5 block text-[11px] text-danger">
                                  ⚠ Hết hiệu lực — bấm <b>Đăng nhập</b> để nối lại
                                </span>
                              )}
                            </span>
                          </label>
                          {/*
                            ⚠ CÒN CÁNH TAY DÙNG ⇒ KHOÁ NÚT, kèm lý do — đừng bày
                            ra một lựa chọn chắc chắn bị từ chối (§6e). Và nó mua
                            thêm một thứ: khi mọi lần bấm đều chắc chắn thành
                            công thì **Optimistic UI mới thành thật** — xem
                            `dropNow`. Lạc quan mà hay phải hoàn tác thì tệ hơn
                            khựng: mục biến mất rồi hiện lại kèm câu lỗi.
                          */}
                          <button
                            type="button"
                            disabled={a.usedBy.length > 0}
                            title={
                              a.usedBy.length
                                ? `Đang được dùng bởi: ${a.usedBy.join(', ')}. Gỡ kết nối đó trước.`
                                : 'Gỡ workspace này'
                            }
                            aria-label={`Gỡ ${a.label ?? a.name}`}
                            className="shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted"
                            onClick={() => setDropWs(a)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {/*
                  ┌──────────────────────────────────────────────────────────┐
                  │ 🔴 NÚT KHÔNG ĐƯỢC KHOÁ KHI ĐANG CHỜ. (bug user báo 26/08)│
                  │                                                          │
                  │ *"do flow không thành công, nó cứ quay vòng vòng vậy đó… │
                  │  phải F5 lại mới hết, hay là nên có X nhỏ bên phải?"*     │
                  │                                                          │
                  │ Bản cũ `disabled={logging}` và chỉ bỏ chờ khi SSE báo    │
                  │ THÀNH CÔNG. Nhưng luồng OAuth hỏng ở phía dịch vụ thì    │
                  │ **không có sự kiện nào cả** — Notion trả lỗi trong tab    │
                  │ kia, còn tab này chờ mãi. Ta để trạng thái chờ phụ thuộc │
                  │ vào một tín hiệu **chỉ tồn tại ở nhánh thành công**.     │
                  │                                                          │
                  │ ⇒ Hai đường ra, và cả hai đều không cần F5: bấm lại nút  │
                  │ (mở lượt mới, `state` mới) hoặc ✕ để thôi chờ. User đoán │
                  │ đúng practice — ✕ là thứ người ta tìm.                    │
                  └──────────────────────────────────────────────────────────┘
                */}
                {/* Mã thiết bị: ba bước, đồng hồ, nút chép ⇒ tách file. */}
                {device && (
                  <DeviceCode key={device.state} name={pick.name} device={device} now={now} />
                )}

                <div className="mt-2 flex gap-1.5">
                  <Button className="flex-1" onClick={() => void login()}>
                    {logging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {logging
                      ? device
                        ? 'Đang chờ bạn cho phép…'
                        : 'Đang chờ… bấm để mở lại'
                      : accounts.length
                        ? pick.deviceLogin
                          ? 'Nối thêm một tài khoản khác'
                          : 'Nối thêm một workspace khác'
                        : `Đăng nhập với ${pick.name}`}
                  </Button>
                  {logging && (
                    <Button
                      aria-label="Thôi chờ"
                      title="Thôi chờ"
                      onClick={() => {
                        // Dọn CẢ HAI: để `device` lại là để vòng hỏi thăm chạy
                        // tiếp sau khi người dùng vừa bảo thôi — đúng họ bug
                        // "hệ thống nói dối về trạng thái của nó".
                        setDevice(null);
                        setLogging(false);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {logging && !device && (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Xong ở tab kia thì đây tự cập nhật. Nếu tab đó báo lỗi (hay bạn đã đóng nó), bấm
                    lại nút trên — mỗi lần bấm là một lượt mới.
                  </p>
                )}

                {/* Ô client_id của khách: riêng của luồng mã thiết bị ⇒ tách file. */}
                {pick.deviceLogin && (
                  <OwnClient
                    name={pick.name}
                    own={own}
                    value={clientId}
                    onChange={setClientId}
                    onSave={() => void saveClientId()}
                  />
                )}
              </div>
            )}

            {/*
              Khối phạm vi + tra bản cài: riêng của hãng ⇒ ở `components/arm/`.

              ⚠ `!logging` — ĐANG đăng nhập thì ẩn cả hai. Chúng nói về **tài
              khoản đang chọn**, mà lúc đó tài khoản đang chọn sắp không còn là
              tài khoản người dùng quan tâm. Một khối đúng-về-quá-khứ đứng giữa
              màn hình là thứ khó phát hiện hơn một khối vắng mặt. (user 28/08)
            */}
            {pick?.scope && accounts.length > 0 && !logging && (
              <ScopeBox name={pick.name} scope={pick.scope} />
            )}
            {pick?.repoScan && accounts.length > 0 && account && !logging && (
              <RepoScan
                name={pick.name}
                scope={pick.scope}
                scan={scan}
                scanning={scanning}
                anyway={anyway}
                onAnyway={setAnyway}
                onRecheck={() => void runScan()}
              />
            )}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ BA NẤC QUYỀN — và **CON SỐ VIỆC** là thứ làm nó thật thà.    │
              │                                                              │
              │ Danh sách nấc đến từ SERVER (`probe.tiers`), không tự suy ở  │
              │ đây: luật *"chỉ hiện nếu THÊM ≥1 việc so với nấc dưới"* có   │
              │ ca biên tinh tế (server toàn tool đọc ⇒ ba nấc bằng nhau ⇒   │
              │ hai nấc dưới là noise), và dựng bản thứ hai của luật đó là   │
              │ dựng một bản sẽ quên mất một điều kiện. → §6j                │
              │                                                              │
              │ Chỉ còn MỘT nấc ⇒ không vẽ bộ chọn: một lựa chọn duy nhất    │
              │ không phải một câu hỏi.                                      │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pick?.tiered && probe?.status === 'connected' && (probe.tiers?.length ?? 0) > 1 && (
              <div className="mt-3">
                <Label>Cho nhân viên làm được gì</Label>
                <div className="mt-1 flex flex-col gap-1">
                  {probe.tiers!.map((t) => (
                    <label
                      key={t.tier}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                    >
                      <input
                        type="radio"
                        name="tier"
                        checked={tier === t.tier}
                        onChange={() => setTier(t.tier)}
                      />
                      <span className="flex-1">{TIER_SAY[t.tier].name}</span>
                      <span className="shrink-0 tabular-nums text-[11px] text-muted">{t.count} việc</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {/*
                    ⚠ CÂU CỦA MỤC DANH MỤC THẮNG CÂU MẶC ĐỊNH — và chỉ ở câu HELP.
                    Tên nấc (`TIER_SAY[t].name` ở trên) KHÔNG cho ghi đè: nó là từ
                    vựng chung để người dùng so hai cánh tay với nhau.

                    Có vì câu mặc định của nấc `add` (*"Tạo được trang/mục mới…"*)
                    sai với Linear: `save_issue` là upsert nên mở issue rơi xuống
                    `full`. Hứa quá tay tệ hơn doạ quá tay (§11a-bis).
                    → `core/catalog.ts §tierSay`
                  */}
                  {pick?.tierSay?.[tier] ?? TIER_SAY[tier].help}
                  {/*
                    ⚠ QUY CÂU NÓI VỀ ĐÚNG NGƯỜI NÓI. Ta viết "server khai", không
                    viết "cánh tay này chỉ đọc" — câu sau ta KHÔNG bảo đảm được.
                    `annotations` là **gợi ý của server**; nếu nó khai ẩu hoặc
                    khai sai thì không client nào phát hiện được. Câu này vẫn
                    đúng kể cả khi điều đó xảy ra. → §6j
                  */}
                  {' '}
                  <span className="text-muted">
                    ({probe.serverName ?? 'Server'} tự khai mức của từng việc.)
                  </span>
                </p>
                {/*
                  ⚠ NÓI RA GIỚI HẠN CỦA CHÍNH CON SỐ. Phép thử chạy **không mang
                  hàng rào nấc** (nếu mang thì bộ chọn này không bao giờ hiện —
                  `catalog.ts §serverFenced`), nên con số token đo được là **trần**.
                  Ở nấc dưới, server cắt bớt việc ghi ngay từ đầu ⇒ tốn ít hơn.

                  Im lặng ở đây là để người dùng đọc một con số đúng cho một cấu
                  hình họ **không chọn** — và nó lệch theo chiều doạ quá tay, tức
                  chiều làm họ tắt thứ họ cần. → §9b
                */}
                {pick.serverFence && tier !== 'full' && (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Số token ở trên đo khi <b>mở hết</b>. Ở nấc này {pick.name} cắt bớt việc ghi
                    ngay từ server, nên thực tế <b>tốn ít hơn</b>.
                  </p>
                )}
              </div>
            )}
            {pick?.tiered && probe?.status === 'connected' && probe.tiers?.length === 1 && (
              <p className="mt-3 rounded-md border border-line px-3 py-2 text-[13px]">
                Kết nối này <b>{TIER_SAY[probe.tiers[0]!.tier].name.toLowerCase()}</b> ·{' '}
                {probe.tiers[0]!.count} việc.
              </p>
            )}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ NHÓM VIỆC — chỉ hỏi ở nấc TOÀN QUYỀN. (user chốt 27/08)      │
              │                                                              │
              │ Ở nấc chỉ đọc màn này KHÔNG hiện gì, và cấu hình rơi về nhóm │
              │ bật sẵn của danh mục. Đó là toàn bộ ý của *"chỉ đọc thì không│
              │ cần pick gì"*: nấc rẻ và không có hậu quả thì đừng thu tiền  │
              │ chú ý của người dùng.                                        │
              │                                                              │
              │ 🔴 CON SỐ ĐI KÈM LÀ SỐ ĐO, KHÔNG PHẢI SỐ SHIP SẴN.          │
              │ Nó đến từ `probe.tools.length` / `probe.tokens`, tức từ một  │
              │ lượt bắt tay thật với đúng bộ nhóm đang tick. Ship hằng số   │
              │ đo ngày 26/08 vào danh mục thì nó **già đi im lặng** ngày    │
              │ hãng thêm tool — đúng lớp "ảnh chụp gõ tay" mà `catalog.ts`  │
              │ §readOnly vừa bỏ. Số ở đây có thể xuất hiện MUỘN (sau khi    │
              │ bấm Thử), và muộn mà đúng thì tốt hơn ngay mà bịa.           │
              │                                                              │
              │ Đổi tick ⇒ VỨT kết quả thử cũ: nó nói về một bộ nhóm khác.   │
              │ Cùng kỷ luật `runRef` và ô chọn thư mục. → §9b               │
              └──────────────────────────────────────────────────────────────┘
            */}
            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ Ô TICK CÁCH CHẠY — hỏi ở MỌI nấc, khác nhóm việc.            │
              │                                                              │
              │ Luật *"câu hỏi chỉ có sức nặng khi được GHI"* (27/08) áp cho  │
              │ nhóm việc vì chúng nói về **quyền**. Hai ô này nói về **cách  │
              │ chạy** — hiện cửa sổ hay không, nhớ đăng nhập hay không —     │
              │ nên nấc nào cũng phải hỏi.                                    │
              │                                                              │
              │ Đổi tick ⇒ VỨT kết quả thử cũ: nó nói về một cấu hình khác.   │
              └──────────────────────────────────────────────────────────────┘
            */}
            {!!pick?.options?.length && (
              <div className="mt-3">
                <Label>Cách chạy</Label>
                <div className="mt-1 flex flex-col gap-1">
                  {pick.options
                    // Ẩn ô chỉ dùng được khi cùng máy. Bày ra rồi để server từ
                    // chối là bày một lựa chọn CHẮC CHẮN SAI — cùng lý lẽ với
                    // việc lọc mục văn phòng đã có ngay ở đầu file.
                    .filter((o) => sameMachine || !o.loopbackOnly)
                    .map((o) => (
                      <label
                        key={o.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                      >
                        <input
                          className="mt-0.5"
                          type="checkbox"
                          checked={options.includes(o.id)}
                          onChange={(e) => {
                            setOptions((cur) =>
                              e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id),
                            );
                            setProbe(null);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block">{o.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                            {o.help}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
                {!sameMachine && pick.options.some((o) => o.loopbackOnly) && (
                  /*
                    Nói ra thay vì im lặng bớt một ô: một lựa chọn biến mất không
                    lý do là một câu đố, và người dùng sẽ đi tìm nó ở chỗ khác.
                  */
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Một lựa chọn bị ẩn vì bạn đang xem từ máy khác — cửa sổ trình duyệt sẽ mở
                    trên máy chạy agentco, nên từ đây bạn không nhìn thấy nó.
                  </p>
                )}
              </div>
            )}
            {needGroups() && (
              <div className="mt-3">
                <Label>Cho làm những nhóm việc nào</Label>
                <div className="mt-1 flex flex-col gap-1">
                  {pick!.groups!.map((g) => (
                    <label
                      key={g.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                    >
                      <input
                        className="mt-0.5"
                        type="checkbox"
                        checked={groups.includes(g.id)}
                        onChange={(e) => {
                          setGroups((cur) =>
                            e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id),
                          );
                          setProbe(null);
                        }}
                      />
                      {/*
                        TÊN CỦA HÃNG + MỘT CÂU NÓI VIỆC LÀM ĐƯỢC. (user 28/08)

                        Không thay tên bằng mô tả: tên là thứ người dùng tra được
                        trong tài liệu của hãng, mô tả là thứ giúp họ quyết định.
                        Gộp hai vai vào một chuỗi thì mất cả hai — đúng ca nhãn
                        `context` bị dịch thành *"Biết tôi là ai, repo nào"*,
                        vừa khó hiểu vừa hứa sai bán kính. → `catalog.ts §ArmGroup`
                      */}
                      <span className="min-w-0 flex-1">
                        <span className="block">{g.label}</span>
                        {g.help && (
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                            {g.help}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {groups.length === 0 ? (
                  /*
                    Một cánh tay 0 việc là một cánh tay hỏng im lặng — nói ra ở
                    đây thay vì để nút Tiếp xám mà không giải thích. Nút xám
                    không lý do là câu đố, không phải một lời từ chối. → B-3
                  */
                  <p className="mt-1.5 text-xs text-danger">
                    Tick ít nhất một nhóm. Không nhóm nào thì kết nối này không làm được việc gì cả.
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    {probe?.status === 'connected' ? (
                      <>
                        Đang cấp <b>{probe.tools.length} việc</b>
                        {probe.tokens ? (
                          <>
                            {' · '}
                            <b className="tabular-nums">~{probe.tokens.toLocaleString('vi')} token</b>{' '}
                            mỗi lượt của nhân viên được nối
                          </>
                        ) : null}
                        .
                      </>
                    ) : (
                      <>Bấm Thử ngay để biết bộ này cấp bao nhiêu việc và tốn bao nhiêu token.</>
                    )}
                  </p>
                )}
              </div>
            )}

            {/*
              ⚠ ĐÃ BỎ ở đây (27/08 chiều): ô radio `Tất cả repo / Chỉ những repo
              này` — hàng rào repo của agentco. Nó chạy được và có test, nhưng
              user bác đúng: phạm vi repo là tài sản **cấp tài khoản của GitHub**,
              và một hàng rào thứ hai chồng lên chỉ mua được thu-hẹp-theo-cánh-tay
              với giá gõ tay + đổi-là-cắm-lại. → `SPEC-arms.md` §5h·7m

              Thứ ở lại là ô THỬ ngay dưới. Trông giống, làm việc khác hẳn.
            */}

            {/*
              Đường TỰ CẮM cũng phải nhập chìa được — xem `pastedKeys`. Nhãn ở
              đây là chính tên biến, và đó là đúng: người dùng vừa TỰ GÕ nó vào
              khối cấu hình, nên nó là từ vựng của họ chứ không phải của ta.
            */}
            {pastedKeys().map((name) => (
              <div key={name} className="mt-3">
                <Label htmlFor={`k-${name}`}>{name}</Label>
                <Input
                  id={`k-${name}`}
                  type="password"
                  value={keys[name] ?? ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [name]: e.target.value }))}
                />
                <p className="mt-1 text-xs text-muted">
                  ↳ Cấu hình bạn dán có ô trống <code>{'${' + name + '}'}</code>. Giá trị lưu trong máy
                  bạn, không ghi vào <code>company.yaml</code>.
                </p>
              </div>
            ))}

            {/*
              DÙNG LẠI: không có ô nào để điền, và phải NÓI RA vì sao — một bước
              "Cài đặt" trống trơn trông như app quên vẽ. Câu này cũng là chỗ trả
              lời câu hỏi user hỏi thẳng: *"văn phòng nào cũng xài chung được?"*
            */}
            {reuse && (
              <div className="mt-3 rounded-md border border-line bg-accent-soft/30 px-3 py-2 text-[13px]">
                <div className="font-medium">Không phải điền lại gì cả</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">
                  Kết nối này đã cắm ở văn phòng khác. Chìa nằm ở cấp <b>công ty</b>, nên văn phòng nào
                  cũng dùng chung được — bấm <b>Thử ngay</b> để chắc nó vẫn còn sống.
                  {reuse.secrets.length > 0 && (
                    <>
                      {' '}
                      Chìa đang dùng: <code>{reuse.secrets.join(', ')}</code>.
                    </>
                  )}
                </div>
              </div>
            )}

            {/*
              ⚠ GIỮ PHÉP THỬ, BỎ CÁI NÚT. (user: *"bỏ nút Thử ngay khi là thư
              mục được không, tôi khá chắc nó là tất định"*)

              Cấu hình thì tất định thật, nhưng thứ hỏng KHÔNG nằm ở cấu hình —
              nó nằm ở MÔI TRƯỜNG, và đã đo được cả ba: máy không có `npx` ·
              không ra được npm (proxy công ty) · thư mục không đọc được. Cả ba
              cho `failed`, và cả ba là thứ người non-code không tự chẩn được.

              Lý do mạnh hơn: lần đầu phải TẢI GÓI ~22 giây. Khoản chờ đó không
              biến mất khi bỏ phép thử — nó chỉ **dời sang giữa một việc đang
              chạy**, lúc người dùng đã bỏ đi. Thử ở đây là trả nó vào đúng lúc
              họ còn đứng đó và làm được gì đó.

              ⇒ Bỏ một cú bấm, giữ phép kiểm: thử TỰ CHẠY ngay khi chọn xong
              thư mục. Nút chỉ còn cho đường "tự cắm" và cho ca thử lại.
            */}
            {(!pick?.folders || probe?.status === 'failed') && (
              <Button className="mt-4 w-full" onClick={() => void test()} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {testing ? 'Đang kết nối…' : probe ? 'Thử lại' : 'Thử ngay'}
              </Button>
            )}
            {pick?.folders && testing && (
              <div className="mt-4 flex items-center gap-2 text-[13px] text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang kiểm tra kết nối…
              </div>
            )}
            {/*
              ĐỪNG ĐOÁN TRƯỚC — GIẢI THÍCH KHI ĐÃ THẤY.

              Câu cũ hứa sẵn *"lần đầu 20–30 giây vì phải tải công cụ"* ngay khi
              bắt đầu thử. Nó SAI ở ca dùng lại một cấu hình đã có: gói đã nằm
              trong cache `npx`, chẳng tải gì cả, và người dùng đọc được một câu
              rõ ràng không đúng với thứ họ đang làm.
              → Chỉ nói khi phép chờ đã THẬT SỰ lâu.
            */}
            {/*
              ⚠ ĐÍNH CHÍNH 24/08 — câu cũ hứa *"Những lần sau sẽ nhanh"*, và đó
              là một lời hứa sản phẩm KHÔNG GIỮ ĐƯỢC.

              Đo 10 lần (`scripts/spike-npx-cost.ts`) với gói đã nằm sẵn trong
              cache `_npx`: đầu-cuối **7,7–9,2 giây**, lần đầu bằng lần thứ ba.
              Phần lớn là phí tự thân của `npx` (~3,2 s mỗi lần khởi động, không
              phải tải gói). User dùng thật và báo đúng: *"lần nào cũng lâu,
              chưa thấy lần 4 giây nào"*.

              Câu mới chỉ nói thứ đo được, và KHÔNG hứa lần sau — hứa nhanh rồi
              vẫn chậm là dạy người dùng thôi tin mọi câu khác trên màn hình.
            */}
            {testing && slow && (
              <p className="mt-1.5 text-xs text-muted">
                Bước này mất khoảng 10–25 giây: máy phải khởi động công cụ kết nối rồi hỏi xem nó
                làm được những gì.
              </p>
            )}

            {probe && (
          <ProbeReport
            r={probe}
            // Nút Đăng nhập chỉ tồn tại ở đường danh mục. Truyền sự thật đó
            // xuống thay vì để `ProbeReport` đoán — nó không có cách nào đoán.
            hasLoginButton={!!pick?.needsLogin}
            match={pick ? undefined : catalogMatch()}
          />
        )}
            {err && <p className="mt-2 text-xs text-danger">{err}</p>}

            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={() => setStep(1)}>
                Quay lại
              </Button>
              {/* KHÔNG cho đi tiếp khi chưa ✓. → SPEC-tools-approval §10b */}
              <Button variant="primary" className="flex-1" disabled={!ok} onClick={() => setStep(3)}>
                Tiếp
              </Button>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────── BƯỚC 3 · Giao cho ai (BẮT BUỘC) */}
        {step === 3 && (
          <div className="max-h-[52vh] overflow-y-auto">
            {agents.length === 0 && (
              <p className="text-[13px] text-muted">
                Văn phòng này chưa có nhân viên nào. Cứ lưu — cắm xong rồi nối dây sau cũng được.
              </p>
            )}
            <div className="flex flex-col gap-1">
              {agents.map((n) => (
                <label
                  key={n.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                >
                  <input
                    type="checkbox"
                    checked={grant.includes(n.role!)}
                    onChange={(e) =>
                      setGrant((g) => (e.target.checked ? [...g, n.role!] : g.filter((r) => r !== n.role)))
                    }
                  />
                  <span>{n.avatar ? `${n.avatar} ` : ''}{n.label}</span>
                </label>
              ))}
            </div>

            {/*
              Nói ra hậu quả của việc KHÔNG chọn ai — KÈM mặt tốt của nó. Người
              muốn cắm sẵn để đó vẫn có đường đi mà không thấy mình làm sai.
            */}
            <p className="mt-3 text-xs text-muted">
              {grant.length === 0
                ? 'Chưa chọn ai thì kết nối này nằm im — không ai dùng được, và nó không tốn token nào.'
                : `${grant.length} người sẽ dùng được kết nối này ngay ở việc kế tiếp.`}
              {probe?.tokens ? ` Mỗi người trả thêm ~${probe.tokens.toLocaleString('vi-VN')} token mỗi lượt.` : ''}
            </p>

            {err && <p className="mt-2 text-xs text-danger">{err}</p>}

            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={() => setStep(2)}>
                Quay lại
              </Button>
              <Button variant="primary" className="flex-1" disabled={busy} onClick={() => void save()}>
                {busy ? 'Đang lưu…' : 'Xong'}
              </Button>
            </div>
          </div>
        )}

        {/*
          Câu xác nhận nói ra ĐÚNG hai chuyện, vì chúng là hai chuyện khác nhau
          và người dùng đang sợ nhầm cái thứ hai:
            · cấu hình  → MẤT HẲN, nhưng dựng lại từ danh mục là ba cú bấm
            · chìa      → **KHÔNG mất**, đó mới là phần đắt (phải sang trang hãng)
          Không nói vế thứ hai là để họ tưởng mình vừa mất token, rồi không ai
          dám bấm — tức có nút mà như không.
        */}
        <ConfirmDelete
          open={!!forget}
          title="Xoá hẳn khỏi sổ chung?"
          onCancel={() => setForget(null)}
          onConfirm={() => {
            const a = forget;
            if (!a) return;
            // ⚠ Đi qua `actions`, KHÔNG gọi thẳng `api` — xem khối chú thích ở
            // `store.ts §forgetArm`. Bản gọi thẳng chỉ cập nhật danh sách trong
            // hộp thoại này, để `selected`/`canvas` giữ một mã đã chết cho tới
            // khi người dùng F5. (bug user báo 26/08)
            void actions
              .forgetArm(a.id)
              .then(() => api.arms())
              .then((r) => setInstalled(forList(r.arms, officeId)))
              .catch((e) => setErr(e instanceof ApiError ? e.message : 'Không xoá được.'))
              .finally(() => setForget(null));
          }}
        >
          <b>{forget?.label}</b> sẽ biến mất khỏi công ty và <b>không lấy lại được</b>. Không văn phòng
          nào đang dùng nó.
          <br />
          <span className="text-muted">
            {forget?.secrets.length
              ? `Chìa (${forget.secrets.join(', ')}) vẫn được giữ — cắm lại thì không phải đi lấy token lần nữa.`
              : 'Kết nối này không cần chìa nào, nên cắm lại là chọn từ danh mục.'}
          </span>
        </ConfirmDelete>

        {/*
          Gỡ workspace — nói ra CẢ HAI vế, vì vế thứ hai là thứ người dùng thật
          sự muốn: agentco không chỉ quên chìa, nó còn **báo cho Notion thu hồi**.
          Xoá mỗi bản sao của mình mà để chìa còn sống ở phía họ là làm đúng một
          nửa việc, và nửa còn lại là nửa họ quan tâm.
        */}
        <ConfirmDelete
          open={!!dropWs}
          title="Gỡ workspace này?"
          confirmLabel="Gỡ"
          onCancel={() => setDropWs(null)}
          onConfirm={() => dropNow()}
        >
          agentco sẽ quên chìa của <b>{dropWs?.label ?? dropWs?.name}</b> và <b>báo cho dịch vụ thu
          hồi</b> quyền truy cập.
          <br />
          <span className="text-muted">
            Không mất gì trong workspace của bạn. Cần lại thì đăng nhập lần nữa.
          </span>
        </ConfirmDelete>
      </DialogContent>
    </Dialog>
  );
}

/**
 * BỘ CHỌN THƯ MỤC — duyệt và bấm, không gõ tay.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO NÓ THAY HẲN Ô GÕ TAY, chứ không đứng cạnh làm "tiện ích thêm"     │
 * │                                                                          │
 * │ Ô gõ tay đẩy BỐN bài toán sang người dùng, và cả bốn đều không phải việc │
 * │ của họ: gõ sai một ký tự · `\` hay `/` · thư mục có dấu cách · và câu    │
 * │ hỏi "đường dẫn này là trên MÁY NÀO" khi daemon chạy ở VPS.               │
 * │                                                                          │
 * │ Duyệt-và-bấm xoá cả bốn cùng lúc: chuỗi do MÁY CHỦ sinh ra, đúng định    │
 * │ dạng của chính nó, đúng cái filesystem mà cánh tay sẽ nhìn thấy.         │
 * │                                                                          │
 * │ ⚠ Và một chuyện đã ĐO: `args` đi vào `spawn` dạng MẢNG, không qua shell. │
 * │ Nên thư mục có dấu cách chạy trần bình thường, còn **bọc dấu nháy vào là │
 * │ HỎNG** (`failed · MCP error -32000`) — dấu nháy trở thành một phần của   │
 * │ tên thư mục. Bộ chọn làm câu hỏi đó biến mất luôn.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function FolderPicker({
  chosen,
  onChange,
  busy,
}: {
  chosen: string[];
  onChange(v: string[]): void;
  /** Đang chạy một lượt thử — khoá nút đổi thư mục. Xem chú thích ở nút. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="rounded-md border border-line px-3 py-2">
        {chosen.length === 0 ? (
          <div className="py-1 text-xs text-muted">Chưa chọn thư mục nào.</div>
        ) : (
          // Đủ chữ, xuống dòng — xem chú thích ở `BrowseDialog`.
          <div className="break-all font-mono text-[12px]">{chosen[0]}</div>
        )}
        {/*
          ĐANG THỬ ⇒ KHOÁ luôn nút đổi thư mục. Đây chính là cửa user đi vào khi
          bắt được bug 26/08: chọn thư mục A → đang kết nối → nhanh tay đổi sang
          Music. `runRef` giữ cho kết quả không lệch; nút này giữ cho họ không
          phải rơi vào tình huống ấy ngay từ đầu.
        */}
        <Button size="sm" className="mt-2 w-full" disabled={busy} onClick={() => setOpen(true)}>
          <FolderOpen className="h-3.5 w-3.5" />
          {busy ? 'Đang kiểm tra…' : chosen.length ? 'Đổi thư mục…' : 'Chọn thư mục…'}
        </Button>
      </div>
      <BrowseDialog open={open} onOpenChange={setOpen} onChange={onChange} />
    </>
  );
}

/**
 * MODAL DUYỆT THƯ MỤC — tách hẳn khỏi hộp thoại `+ Kết nối`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG DÙNG HỘP THOẠI CHỌN THƯ MỤC CỦA HỆ ĐIỀU HÀNH — user hỏi     │
 * │ thẳng, và câu trả lời là: TRÌNH DUYỆT KHÔNG ĐƯA ĐƯỢC ĐƯỜNG DẪN TUYỆT ĐỐI.│
 * │                                                                          │
 * │   `<input webkitdirectory>`  → chỉ trả tên TƯƠNG ĐỐI trong thư mục đã     │
 * │                                chọn, không có gốc                        │
 * │   `showDirectoryPicker()`    → trả một HANDLE, cố ý không lộ đường dẫn    │
 * │                                (đó là tính năng bảo mật, không phải sót)  │
 * │                                                                          │
 * │ Cả hai đều là hàng rào có chủ ý của trình duyệt, không phải thứ vá được.  │
 * │ Và kể cả vá được thì vẫn sai: nó liệt kê máy của NGƯỜI ĐANG NGỒI, trong  │
 * │ khi cánh tay chạy trên máy của DAEMON — khác nhau ngay khi lên VPS hoặc  │
 * │ vào container (§10b). Bộ chọn tự liệt kê nên tự đúng ở cả hai chỗ.       │
 * │                                                                          │
 * │ Ba thứ bù lại cho việc mất hộp thoại quen thuộc, và user đòi cả ba:      │
 * │  · mở lại ĐÚNG thư mục rời đi lần trước, không quay về ổ đĩa             │
 * │  · GÕ/DÁN thẳng đường dẫn — nhanh hơn mọi cú click khi đã biết chỗ       │
 * │  · modal RIÊNG, rộng, không chen trong hộp thoại đang dở                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function BrowseDialog({
  open,
  onOpenChange,
  onChange,
  start,
  office,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
  onChange(v: string[]): void;
  /**
   * Mở ở đâu. Bỏ trống ⇒ `office` (nếu có) ⇒ `LAST_DIR` ⇒ gốc.
   *
   * ⚠ Tab Lệnh truyền thư mục ĐANG CHỌN vào đây và cố ý **không** dùng
   * `LAST_DIR` (user 01/09): cache đó là trí nhớ của cánh tay thư mục, mượn nó ở
   * đây là mở ra một chỗ chẳng liên quan gì tới thứ đang soạn.
   */
  start?: string;
  /**
   * Chưa chọn gì thì đứng ở **thư mục văn phòng**. Gửi **id**, không gửi đường
   * dẫn — máy chủ giải. → `api.browse`
   */
  office?: string | null;
}) {
  const [cur, setCur] = useState<{ path: string; parent: string | null; dirs: { name: string; path: string }[] }>({
    path: '',
    parent: null,
    dirs: [],
  });
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);

  const go = (p?: string, at?: string) => {
    setLoading(true);
    void api
      .browse(p, at)
      .then((r) => {
        setCur(r);
        setTyped(r.path);
        if (r.path) localStorage.setItem(LAST_DIR, r.path);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    /**
     * ⚠ `office` đứng TRƯỚC `LAST_DIR` chứ không sau: chỗ nào truyền `office`
     * (tab Lệnh) là chỗ đã nói rõ mặc định của mình, và rơi tiếp xuống cache của
     * cánh tay thư mục ở đó là mở ra một chỗ chẳng liên quan.
     */
    if (start) go(start);
    else if (office) go(undefined, office);
    else go(localStorage.getItem(LAST_DIR) || undefined);
    // Chỉ theo `open`: đổi `start` giữa lúc modal đang mở là kéo người dùng về
    // gốc trong khi họ đang duyệt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const here = cur.path;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_W}>
        <DialogHeader>
          <DialogTitle>Chọn thư mục</DialogTitle>
          <DialogDescription>
            Đây là các thư mục trên máy đang chạy agentco — không phải máy bạn đang ngồi, nếu hai cái khác nhau.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={cur.parent === null} onClick={() => go(cur.parent ?? undefined)}>
            ↑
          </Button>
          {/* Gõ/dán thẳng: khi đã biết chỗ thì đây nhanh hơn mọi cú click. */}
          <Input
            className="flex-1 font-mono text-[12px]"
            value={typed}
            placeholder="Hoặc dán đường dẫn rồi Enter"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go(typed.trim() || undefined);
              }
            }}
          />
        </div>

        {/*
          ⚠ ĐƯỜNG DẪN HIỆN ĐỦ, XUỐNG DÒNG CHỨ KHÔNG CẮT. Một đường dẫn bị cắt
          giữa chừng là chỗ hiểu nhầm rẻ nhất có thể mua: `D:\Ho so\2025\…` và
          `D:\Ho so\2026\…` trông y hệt nhau sau ba dấu chấm, và người dùng vừa
          quyết định cho một agent quyền đọc chỗ nào.
        */}
        <div className="mt-2 rounded-md border border-line bg-panel px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">Đang ở</div>
          <div className="mt-0.5 break-all font-mono text-[12px]">{here || 'Chọn một ổ đĩa'}</div>
        </div>

        {/* BA cột, không bốn: khung hẹp lại còn 46rem thì bốn cột cắt tên thư
            mục ngay ở ký tự thứ mười — mà tên thư mục chính là thứ người ta đọc
            để bấm. */}
        <div className="mt-2 grid max-h-[46vh] grid-cols-3 gap-1 overflow-y-auto rounded-md border border-line p-1">
          {loading && <div className="col-span-3 px-2 py-2 text-xs text-muted">Đang đọc…</div>}
          {!loading && cur.dirs.length === 0 && (
            <div className="col-span-3 px-2 py-2 text-xs text-muted">
              Không có thư mục con nào đọc được ở đây.
            </div>
          )}
          {!loading &&
            cur.dirs.map((d) => (
              <button
                key={d.path}
                type="button"
                onClick={() => go(d.path)}
                title={d.path}
                className="truncate rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent-soft"
              >
                📁 {d.name}
              </button>
            ))}
        </div>

        {/*
          MỘT NÚT, KHÔNG HAI. Bản trước có "Chọn thư mục này" rồi "Xong" — hai
          nút cho một ý định, và người dùng phải đoán cái nào mới thật sự chọn.
          Giờ **Xong = chọn thư mục đang mở**, đúng như user đề nghị.
        */}
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Thôi</Button>
          <Button
            variant="primary"
            disabled={!here}
            onClick={() => {
              onChange([here]);
              onOpenChange(false);
            }}
          >
            Xong — dùng thư mục này
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Kết quả bắt tay. `status` có NĂM giá trị — `needs-auth` KHÔNG phải lỗi.
 *
 * ⚠ `failed` hiện NGUYÊN VĂN `error` của server: đó là chuỗi duy nhất người dùng
 * copy đi hỏi chỗ khác được. Thay nó bằng một câu chung chung của ta là lấy đi
 * thứ hữu ích duy nhất còn lại. → §6c
 */
function ProbeReport({
  r,
  /** Màn này CÓ nút Đăng nhập không — đường danh mục thì có, đường tự cắm thì không. */
  hasLoginButton,
  /** Mục danh mục cùng tên miền với URL vừa dán, nếu nhận ra được. */
  match,
}: {
  r: ProbeResult;
  hasLoginButton: boolean;
  match?: CatalogArm | undefined;
}) {
  if (r.status === 'connected') {
    const read = r.tools.filter((t) => t.level === 'read').length;
    /*
      ┌──────────────────────────────────────────────────────────────────────┐
      │ NỐI ĐƯỢC MÀ 0 VIỆC — vẽ nó là CẢNH BÁO, không phải là ✓ có ghi chú.  │
      │                                                                      │
      │ Đây là ca `X-MCP-Toolsets` gõ sai tên: server bắt tay bình thường,   │
      │ trả rỗng, không một câu lỗi nào (đo 26/08). Vẽ nó bằng dấu ✓ xanh là │
      │ giao diện **nói dối thay cho server** — và cái hỏng này im lặng sẵn  │
      │ rồi, không cần ta im lặng thêm một tầng nữa.                         │
      │ → `probe.ts §ProbeResult.warn` · [[agentco-silent-allowlist]]        │
      └──────────────────────────────────────────────────────────────────────┘
    */
    if (r.warn) {
      return (
        <div className="mt-3 rounded-md border border-warn/40 px-3 py-2 text-[13px]">
          <div className="flex items-center gap-1.5 font-medium text-warn">
            <TriangleAlert className="h-4 w-4" />
            Nối được, nhưng 0 việc
          </div>
          <div className="mt-1 text-xs leading-relaxed text-muted">{r.warn}</div>
        </div>
      );
    }
    return (
      <div className="mt-3 rounded-md border border-line bg-accent-soft/40 px-3 py-2 text-[13px]">
        <div className="flex items-center gap-1.5 font-medium">
          <Check className="h-4 w-4 text-accent" />
          Chạy được · {r.tools.length} việc
          {r.serverName ? <span className="text-xs font-normal text-muted">· {r.serverName}</span> : null}
        </div>
        <div className="mt-1 text-xs text-muted">
          {read} việc chỉ đọc · {r.tools.length - read} việc có ghi
          {r.tokens ? ` · ~${r.tokens.toLocaleString('vi-VN')} token mỗi lượt` : ''}
        </div>
        {/*
          ┌──────────────────────────────────────────────────────────────────┐
          │ KẾT QUẢ THỬ TẦM VỚI — nằm TRONG khối ✓, không thay thế nó.       │
          │                                                                  │
          │ `ok: false` KHÔNG làm cả phép thử hỏng: đăng nhập vẫn chạy, cánh  │
          │ tay vẫn cắm được, thứ chưa xong là **bản cài app** — một việc     │
          │ người dùng làm ở màn hình của hãng. Nhuộm đỏ cả khối là gộp hai   │
          │ câu hỏi vào một ô trả lời, đúng lớp lỗi sai cửa mà chính ô thử    │
          │ này sinh ra để đóng.                                             │
          │                                                                  │
          │ Nhưng cũng KHÔNG được vẽ nó xám như một ghi chú: nó là thứ duy    │
          │ nhất nói cho người dùng biết cánh tay sắp cắm có làm được gì hay  │
          │ không, và dấu ✓ ngay trên nó thì rất thuyết phục.                 │
          └──────────────────────────────────────────────────────────────────┘
        */}
      </div>
    );
  }
  if (r.status === 'needs-auth') {
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 HAI ĐƯỜNG, HAI CÂU — vì hai đường có hai CỬA khác nhau. (31/08)   │
     * │                                                                      │
     * │ Ca user gặp: dán `{"type":"http","url":"https://mcp.notion.com/mcp"}`│
     * │ qua đường tự cắm → `needs-auth` → màn hình nói *"cần bạn cho phép     │
     * │ trên trình duyệt"*. User bác đúng:                                   │
     * │                                                                      │
     * │   *"họ đâu có đường ra… ít nhất là dịch vụ này cần authorize gì đó   │
     * │    thì ít ra họ còn đi kiếm cách authorize"*                         │
     * │                                                                      │
     * │ Câu cũ viết cho đường DANH MỤC, nơi có nút Đăng nhập ngay bên cạnh.   │
     * │ Đường tự cắm **không có nút nào** (`oauthStart` nhận `catalogId`,     │
     * │ xem SPEC-arms §16q) ⇒ câu đó **hứa một cái cửa không tồn tại**. Đó là │
     * │ dạng tệ nhất của câu lỗi sai cửa: nó không mơ hồ, nó SAI.            │
     * │                                                                      │
     * │ ⚠ Và đừng chỉ đổi giọng cho mơ hồ đi. Người dùng cần **một việc làm   │
     * │ được**, nên câu mới nêu đúng hai đường thật: mục danh mục nếu nhận ra │
     * │ được hãng, còn không thì cách tự cắm chìa vào chính khối JSON.        │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    return (
      <div className="mt-3 rounded-md border border-line px-3 py-2 text-[13px]">
        <div className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="h-4 w-4 text-warn" />
          {hasLoginButton ? 'Cần đăng nhập một lần' : 'Dịch vụ này yêu cầu xác thực'}
        </div>
        {hasLoginButton ? (
          <div className="mt-1 text-xs text-muted">
            Kết nối được, nhưng dịch vụ này cần bạn cho phép trên trình duyệt. Bấm <b>Đăng nhập</b> ở trên.
          </div>
        ) : (
          <div className="mt-1 space-y-1 text-xs leading-relaxed text-muted">
            <div>
              Máy chủ trả lời được, nhưng nó từ chối vì chưa có chìa. Đường <b>Tự cắm MCP</b> chưa
              đăng nhập hộ bạn được — bạn phải tự đưa chìa vào.
            </div>
            {match ? (
              <div>
                ⭐ <b>{match.name}</b> đã có sẵn ở <b>Dịch vụ có sẵn</b>. Quay lại chọn nó thì chỉ cần
                bấm Đăng nhập, không phải tự đi lấy chìa.
              </div>
            ) : (
              /**
               * ⚠⚠ KHÔNG NÓI TÊN HEADER. (user bắt 31/08)
               *
               *   *"có phải chỗ nào cũng là Bearer không, rất có thể nhiều
               *    server khác nó có cấu hình khác"*
               *
               * Đúng — và bản trước đã in thẳng `"Authorization": "Bearer …"`
               * như thể đó là luật chung. Ngoài đời có `X-API-Key`, có `Basic`,
               * có header riêng của hãng, và stdio thì chìa đi vào `env` chứ
               * không có header nào cả.
               *
               * ⇒ Ranh giới đúng KHÔNG phải *"kỹ hay chung chung"* mà là
               * **THỨ TA SỞ HỮU vs THỨ HÃNG SỞ HỮU**:
               *   · ô `${…}` là cơ chế CỦA TA  → nói thật kỹ, luôn đúng
               *   · tên trường là của HÃNG     → không nói một chữ, trỏ README
               * Nói kỹ về thứ của mình thì không bao giờ thành nói sai.
               */
              <div>
                Chìa phải nằm trong chính khối JSON này. README của dịch vụ ghi nó đi vào đâu — có
                thể là một header trong <code>headers</code>, có thể là một biến trong{' '}
                <code>env</code>, mỗi hãng một khác. Chép đúng chỗ đó, rồi{' '}
                <b>
                  thay giá trị thật bằng <code>{'${TEN_CHIA}'}</code>
                </b>
                : chỗ đó sẽ thành một ô nhập ở ngay dưới, và chìa không bị ghi vào file cấu hình.
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-danger/40 px-3 py-2 text-[13px]">
      <div className="font-medium text-danger">Chưa kết nối được</div>
      {r.error && <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-muted">{r.error}</pre>}
    </div>
  );
}



