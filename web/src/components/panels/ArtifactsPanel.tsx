import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileCheck2, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { Markdown } from '@/lib/markdown';
import { toast, useApp } from '@/lib/store';
import type { ArtifactRecord, ArtifactView } from '@/lib/types';

/**
 * KẾT QUẢ — file NHÂN VIÊN làm ra. → docs/SPEC-artifacts.md
 *
 * Tên gọi là "Kết quả" chứ không phải "Artifacts" hay "Sản phẩm", và lý do rất
 * cụ thể: Trợ lý ĐÃ nói câu *"Kết quả đã lưu tại: …"* sau mọi lần chạy. Sản
 * phẩm đã dạy người dùng từ đó rồi. Đặt tên thứ hai cho cùng một thứ là tự tạo
 * ra khái niệm dễ lẫn thứ ba — đã có sẵn hai cái (kho tri thức / tủ tài liệu).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ XEM · TẢI VỀ · XOÁ. KHÔNG SỬA, VÀ KHÔNG CÓ NÚT "GỬI CHO NHÂN VIÊN".      │
 * │                                                                          │
 * │ Không sửa: cùng lý do với tủ tài liệu — một editor ở đây sẽ là cửa ghi   │
 * │ thứ hai vào cùng một file mà nhân viên đang ghi.                          │
 * │                                                                          │
 * │ Không có cửa nạp ngược: nếu panel này đưa được kết quả trở lại làm đầu   │
 * │ vào, nó thành tủ tài liệu thứ hai — hai kho cùng nghĩa, hai luật vòng    │
 * │ đời, và người dùng phải đoán nên bỏ file vào đâu. Muốn dùng lại thì bàn  │
 * │ giao bằng tay: chép nội dung vào ô chat, hoặc thả vào tủ tài liệu.       │
 * │                                                                          │
 * │ ⚠ Không nhầm với thứ VẪN CHẠY và không đổi: trong MỘT kế hoạch nhiều     │
 * │ bước, task sau đọc artifact của task trước qua `inputs`. Đó là dây nối   │
 * │ bên trong một việc, không phải một cái kho để lấy ra.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function ArtifactsPanel() {
  const officeId = useApp((s) => s.officeId);
  const artifactsVersion = useApp((s) => s.artifactsVersion);
  const [items, setItems] = useState<ArtifactRecord[] | null>(null);
  const [confirmDel, setConfirmDel] = useState<ArtifactRecord | null>(null);
  const [open, setOpen] = useState<ArtifactRecord | null>(null);

  const reload = useCallback(() => {
    if (!officeId) return;
    api
      .artifacts(officeId)
      .then((r) => setItems(r.artifacts))
      .catch((err) => {
        toast(err instanceof Error ? err.message : 'Không đọc được danh sách kết quả.');
        setItems([]);
      });
  }, [officeId]);

  useEffect(reload, [reload, artifactsVersion]);

  /**
   * Gom theo KẾ HOẠCH, không theo `task_id`.
   *
   * `T-01` là số thứ tự trong một kế hoạch và mọi kế hoạch đều bắt đầu từ 1,
   * nên gom theo nó là trộn tám lần chạy khác nhau vào một rổ — đúng thứ đang
   * nằm trên đĩa của những văn phòng chạy trước 19/08.
   */
  const groups = useMemo(() => {
    if (!items) return null;
    const out = new Map<string, ArtifactRecord[]>();
    for (const a of items) {
      const key = a.plan_id || LEGACY;
      const list = out.get(key) ?? [];
      list.push(a);
      out.set(key, list);
    }
    return [...out.entries()];
  }, [items]);

  async function remove(a: ArtifactRecord) {
    if (!officeId) return;
    try {
      const r = await api.removeArtifact(officeId, a.path);
      setItems(r.artifacts);
      if (open?.path === a.path) setOpen(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setConfirmDel(null);
    }
  }

  if (items === null || groups === null) {
    return <div className="px-4 py-6 text-[13px] text-muted">Đang đọc…</div>;
  }

  if (items.length === 0) {
    return (
      <Empty
        icon={<FileCheck2 className="h-7 w-7" />}
        title="Chưa có kết quả nào"
        hint="Đây là nơi giữ file nhân viên làm ra. Giao cho Trợ lý một việc, xong là kết quả xuất hiện ở đây — xem trước, tải về, hoặc xoá đi."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(([planId, list]) => (
          <section key={planId}>
            <div className="sticky top-0 z-10 flex items-baseline gap-3 border-b border-line bg-panel px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {/*
                Tên việc CẮT MỘT DÒNG, bản đầy đủ ở tooltip. `request` là câu
                Trợ lý VIẾT LẠI ("viết lại yêu cầu thành một câu rõ ràng, đủ
                ngữ cảnh") nên nó dài được — để nó xuống dòng thì tiêu đề dính
                (`sticky`) chiếm mất nửa panel.
              */}
              <span className="min-w-0 flex-1 truncate normal-case" title={planTitle(planId, list)}>
                {planTitle(planId, list)}
              </span>
              {/*
                Thời gian dạng ĐẦY ĐỦ CÓ GIÂY, chỉ ở tiêu đề nhóm.

                Tiêu đề là mỏ neo phân biệt "lần chạy nào" — chạy lại CÙNG một
                yêu cầu trong một ngày thì giây là thứ DUY NHẤT tách được hai
                nhóm. Dòng file bên trong giữ `when()` rút gọn: nó đã nằm sẵn
                trong một nhóm đã biết, lặp lại ngày ở đó là nhiễu.
              */}
              {planId !== LEGACY && (
                <span className="flex-none tabular-nums font-normal">{stamp(newestOf(list).mtime)}</span>
              )}
            </div>
            <ul>
              {list.map((a) => (
                <li key={a.path} className="border-b border-line px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setOpen(a)}
                      title={a.path}
                    >
                      <div className="truncate text-[13.5px] leading-snug text-ink hover:text-accent">
                        {a.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>{a.task_id}</span>
                        <span>·</span>
                        <span className="tabular-nums">{formatBytes(a.bytes)}</span>
                        <span>·</span>
                        <span className="tabular-nums">{when(a.mtime)}</span>
                        {a.view === 'download' && (
                          <>
                            <span>·</span>
                            {/* Nói TRƯỚC khi họ bấm. Bấm vào rồi mới biết "không
                                xem được" là một cú bấm phí và một giây bối rối. */}
                            <span className="rounded bg-line/70 px-1.5">chỉ tải về</span>
                          </>
                        )}
                      </div>
                    </button>
                    <div className="flex flex-none gap-1">
                      <a
                        href={officeId ? api.artifactUrl(officeId, a.path, true) : '#'}
                        download={a.name}
                        className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
                        aria-label={`Tải ${a.name}`}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        className="rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                        onClick={() => setConfirmDel(a)}
                        aria-label={`Xoá ${a.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/*
        Câu đối xứng với chân hai ngăn kéo kia. Ba kho dễ lẫn nhau, nên mỗi cái
        phải tự nói mình LÀ GÌ — rẻ nhất trong mọi cách chống nhầm lẫn, và 0
        token vì nằm hoàn toàn ở giao diện.
      */}
      <div className="flex-none border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
        Đây là thứ <b>nhân viên làm ra</b>. Không sửa được ở đây — muốn đổi thì nhắn Trợ lý làm lại. Muốn
        dùng một kết quả làm đầu vào cho việc sau thì tự thả nó vào <b>Tủ tài liệu</b>.
      </div>

      <ViewerDialog item={open} officeId={officeId} onClose={() => setOpen(null)} />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent className="w-[min(30rem,94vw)]">
          <DialogHeader>
            <DialogTitle>Xoá kết quả?</DialogTitle>
            <DialogDescription>
              {/*
                Khác hẳn câu của tủ tài liệu, và khác biệt phải nói ra: tài liệu
                thì bản gốc còn trên máy người dùng, còn kết quả thì ĐÂY LÀ BẢN
                DUY NHẤT — xoá là mất thứ đã trả tiền để làm ra.
              */}
              <b>{confirmDel?.name}</b> sẽ bị xoá hẳn. Đây là <b>bản duy nhất</b> — không có bản sao nào
              khác trên máy bạn, và nhân viên phải chạy lại từ đầu nếu bạn cần nó.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmDel(null)}>Thôi</Button>
            <Button variant="danger" onClick={() => confirmDel && void remove(confirmDel)}>
              Xoá hẳn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const LEGACY = '__legacy__';

function newestOf(list: readonly ArtifactRecord[]): ArtifactRecord {
  return list.reduce((a, b) => (a.mtime > b.mtime ? a : b));
}

/**
 * Nhãn nhóm — TÊN VIỆC THẬT. Không bao giờ hiện mã kế hoạch.
 * → docs/SPEC-artifacts.md §2.1
 *
 * `plan_title` do server tra sẵn từ `tasks/index.json`. Rỗng thì rơi về nhãn
 * ngày giờ cũ: kế hoạch đã rớt khỏi sổ (trần 200 bản ghi) là chuyện bình thường
 * ở một văn phòng chạy lâu, và một tiêu đề trống thì tệ hơn một tiêu đề mờ.
 */
function planTitle(planId: string, list: readonly ArtifactRecord[]): string {
  if (planId === LEGACY) return 'Kết quả cũ (trước khi tách theo việc)';
  const named = list.find((a) => a.plan_title.trim());
  return named ? named.plan_title.trim() : `Việc chạy ${when(newestOf(list).mtime)}`;
}

/** Ngày giờ ĐẦY ĐỦ có giây — dùng cho tiêu đề nhóm, xem chú thích ở chỗ gọi. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ──────────────────────────────────────────────────────────── xem trước

/**
 * Cửa sổ xem trước.
 *
 * Ba nhóm, và ranh giới giữa chúng là một quyết định sản phẩm:
 *
 *  · văn bản (md · txt · csv · json · yaml · html) — `fetch` rồi tự vẽ. Đây là
 *    100% kết quả thật hôm nay: nhân viên chỉ có `Write`/`Edit`, tức là chỉ ghi
 *    được văn bản.
 *  · trình duyệt tự lo (ảnh · pdf · video) — vài dòng thẻ native. Chưa có
 *    nhân viên nào sinh ra được chúng, nhưng gần như miễn phí nên làm luôn.
 *  · office (docx · xlsx · pptx) — KHÔNG xem trước. `extract.ts` bóc được
 *    chúng với 0 phụ thuộc, nên đây không phải chuyện nặng codebase: một
 *    preview bóc-text của file Word là một LỜI NÓI DỐI — mất bảng, mất bố cục,
 *    mất ảnh — và người dùng đang nhìn nó để quyết có gửi cho khách hay không.
 */
function ViewerDialog({
  item,
  officeId,
  onClose,
}: {
  item: ArtifactRecord | null;
  officeId: string | null;
  onClose(): void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsText = item ? TEXTY.has(item.view) : false;
  const url = item && officeId ? api.artifactUrl(officeId, item.path) : '';

  useEffect(() => {
    setText(null);
    setError(null);
    if (!item || !officeId || !needsText) return;
    let alive = true;
    fetch(url)
      .then(async (r) => {
        const body = await r.text();
        if (!alive) return;
        // Server trả 413 kèm câu giải thích khi file quá lớn để xem trước — hiện
        // đúng câu đó thay vì một khối JSON thô.
        if (!r.ok) throw new Error(safeError(body) ?? `Không đọc được (lỗi ${r.status}).`);
        setText(body);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Không đọc được file.'));
    return () => {
      alive = false;
    };
  }, [item, officeId, needsText, url]);

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(56rem,95vw)]">
        <DialogHeader>
          <DialogTitle className="break-all">{item?.name}</DialogTitle>
          <DialogDescription>
            {item?.task_id} · {item ? formatBytes(item.bytes) : ''} · {item ? when(item.mtime) : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[64vh] min-h-[8rem] overflow-auto px-1">
          {error ? (
            <p className="rounded bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
              {error}
            </p>
          ) : !item ? null : item.view === 'download' ? (
            <Empty
              icon={<Download className="h-7 w-7" />}
              title="Định dạng này phải mở bằng ứng dụng gốc"
              hint="Xem trước một file Word/Excel/PowerPoint bằng cách bóc chữ ra sẽ mất bảng, mất bố cục, mất ảnh — tức là bạn duyệt một thứ khác với thứ sẽ gửi đi. Tải về rồi mở bằng ứng dụng thật."
            />
          ) : item.view === 'image' ? (
            <img src={url} alt={item.name} className="mx-auto max-h-[60vh] max-w-full object-contain" />
          ) : item.view === 'video' ? (
            <video src={url} controls className="mx-auto max-h-[60vh] max-w-full" />
          ) : item.view === 'pdf' ? (
            <object data={url} type="application/pdf" className="h-[60vh] w-full">
              <p className="p-3 text-[13px] text-muted">Trình duyệt không mở được PDF ở đây — tải về nhé.</p>
            </object>
          ) : text === null ? (
            <div className="py-6 text-[13px] text-muted">Đang đọc…</div>
          ) : item.view === 'csv' ? (
            <CsvTable text={text} sep={item.ext === 'tsv' ? '\t' : ','} />
          ) : item.view === 'markdown' ? (
            /*
              `.md` là 100% kết quả thật hôm nay (SPEC-artifacts §3: 14/14), nên
              đây là màn hình người dùng nhìn nhiều nhất trước khi quyết có gửi
              cho khách hay không. Hiện `**đậm**` thành đúng hai dấu sao là bắt
              họ tự dịch markdown trong đầu để đoán xem khách sẽ thấy gì.

              `variant="preview"` nới cỡ tiêu đề thêm một nấc: hộp này rộng 56rem
              chứ không phải bong bóng chat 330px.
            */
            <div className="text-[13.5px] leading-relaxed text-ink">
              <Markdown text={text} variant="preview" />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
              {text}
            </pre>
          )}
        </div>

        <DialogFooter>
          {item && officeId && (
            <a
              href={api.artifactUrl(officeId, item.path, true)}
              download={item.name}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink hover:bg-accent-soft/60"
            >
              <Download className="h-4 w-4" />
              Tải về
            </a>
          )}
          <Button onClick={onClose}>
            <X className="h-4 w-4" />
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TEXTY = new Set<ArtifactView>(['text', 'markdown', 'csv', 'code']);

/**
 * Bảng CSV — parser đủ dùng, có xử lý dấu nháy kép.
 *
 * Không kéo thư viện về cho việc này: một bảng chỉ để NHÌN, không sort không
 * lọc không sửa. Ca duy nhất parser này bỏ qua là xuống dòng bên trong ô có
 * nháy — hiếm, và hậu quả là một hàng hiện xấu chứ không phải một con số sai.
 */
function CsvTable({ text, sep }: { text: string; sep: string }) {
  const rows = useMemo(() => {
    return text
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .slice(0, 500)
      .map((line) => splitRow(line, sep));
  }, [text, sep]);

  if (rows.length === 0) return <div className="py-6 text-[13px] text-muted">File rỗng.</div>;
  const [head, ...body] = rows;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {/*
              ⚠ Gọi là "hàng đầu", KHÔNG khẳng định đó là tiêu đề. Ta THẤY nội
              dung dòng một; ta KHÔNG thấy rằng nó là dòng tiêu đề. Cùng cái bẫy
              đã dẫm ở INDEX.md của tủ tài liệu.
            */}
            {(head ?? []).map((c, i) => (
              <th
                key={i}
                className="sticky top-0 border-b border-line bg-panel px-2 py-1.5 text-left font-semibold text-ink"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="even:bg-line/25">
              {r.map((c, j) => (
                <td key={j} className="border-b border-line/60 px-2 py-1 align-top text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 500 && (
        <p className="px-2 py-2 text-xs text-muted">Chỉ hiện 500 dòng đầu. Tải về để xem đủ.</p>
      )}
    </div>
  );
}

function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ──────────────────────────────────────────────────────────── định dạng

/** PHẢI khớp `formatBytes` ở `src/library/names.ts` — nhiều chỗ hiện cùng con số. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Hôm nay thì chỉ hiện giờ — người dùng mở panel này ngay sau khi việc vừa xong. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function safeError(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}
