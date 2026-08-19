import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react';

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
import { api, ApiError } from '@/lib/api';
import { actions, toast, useApp } from '@/lib/store';
import type { DocState, LibraryDoc } from '@/lib/types';

/**
 * Tủ tài liệu — file NGƯỜI DÙNG đưa vào. → docs/SPEC-library.md
 *
 * Khác ngăn kéo Tri thức ở đúng chỗ quan trọng nhất, và giao diện phải nói ra
 * được điều đó: kho tri thức là thứ hệ thống ĐÃ HỌC (sửa/xoá được, không thêm
 * được), tủ tài liệu là thứ người dùng ĐƯA VÀO (thêm/xoá được, không sửa được).
 *
 * Không có editor, và đó là quyết định chứ không phải thiếu sót — sửa .docx
 * trong một textarea là phá nó. Muốn sửa thì sửa ngoài rồi thả lại đè lên.
 */
export function LibraryPanel() {
  const officeId = useApp((s) => s.officeId);
  // Bóc văn bản chạy NGẦM và mất vài giây cho một PDF dày. Không theo con số này
  // thì dòng "đang đọc…" đứng im cho tới lần người dùng tự bấm mở lại tủ — đúng
  // lúc họ cần biết nhất thì màn hình im lặng.
  const libraryVersion = useApp((s) => s.libraryVersion);
  // Số tài liệu đang được bóc. Đây là chỗ ĐÚNG của con số này — nó là trạng
  // thái của cái tủ, không phải của cuộc trò chuyện. Xem `AppState.libraryBusy`.
  const libraryBusy = useApp((s) => s.libraryBusy);
  // File vừa thả lên node Tủ tài liệu trên sơ đồ. Canvas chỉ chuyển tay —
  // toàn bộ luồng tải lên sống ở đây, đúng MỘT bản.
  const pendingDocs = useApp((s) => s.pendingDocs);
  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDel, setConfirmDel] = useState<LibraryDoc | null>(null);
  const [askReplace, setAskReplace] = useState<File[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    if (!officeId) return;
    api
      .library(officeId)
      .then((r) => setDocs(r.docs))
      .catch((err) => {
        toast(err instanceof Error ? err.message : 'Không đọc được tủ tài liệu.');
        setDocs([]);
      });
  }, [officeId]);

  useEffect(reload, [reload, libraryVersion]);

  useEffect(() => {
    if (!pendingDocs || !officeId) return;
    void upload(actions.takeDroppedDocs());
    // `upload` dựng lại mỗi lần render nhưng chỉ đọc `officeId`; đưa nó vào deps
    // sẽ chạy lại effect mỗi lần render và tải lên lặp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDocs, officeId]);

  async function upload(files: File[], replace = false) {
    if (!officeId || files.length === 0) return;
    setBusy(true);
    const clash: File[] = [];
    try {
      for (const file of files) {
        try {
          const r = await api.uploadDoc(officeId, file, replace);
          setDocs(r.docs);
        } catch (err) {
          // 409 = trùng tên. Đây là câu HỎI LẠI, không phải lỗi — gom lại rồi
          // hỏi một lần cho cả lô, thay vì bắn năm hộp thoại liên tiếp.
          if (err instanceof ApiError && err.status === 409) clash.push(file);
          else toast(`${file.name}: ${err instanceof Error ? err.message : 'không tải lên được.'}`);
        }
      }
    } finally {
      setBusy(false);
      if (clash.length > 0) setAskReplace(clash);
    }
  }

  async function remove(doc: LibraryDoc) {
    if (!officeId) return;
    try {
      const r = await api.removeDoc(officeId, doc.name);
      setDocs(r.docs);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không xoá được.');
    } finally {
      setConfirmDel(null);
    }
  }

  if (docs === null) return <div className="px-4 py-6 text-[13px] text-muted">Đang đọc…</div>;

  return (
    <div
      className={`flex h-full flex-col ${dragging ? 'bg-accent-soft/40' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex-none border-b border-line p-3">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <Button variant="primary" className="w-full" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload className="h-4 w-4" />
          {busy ? 'Đang tải lên…' : 'Thêm tài liệu'}
        </Button>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Kéo thả file vào đây cũng được. Nhận <b>pdf · docx · xlsx · pptx · md · txt · csv · json · yaml</b>.
        </p>
        {/*
          Bóc văn bản chạy ngầm. Câu này đứng ở ĐẦU TỦ chứ không ở ô chat: việc
          đang xảy ra với tài liệu thì phải hiện cạnh tài liệu. Và nó biến mất
          khi `libraryBusy` về 0 — bản trước dùng chung dòng trạng thái của chat
          rồi không có đường nào tắt.
        */}
        {libraryBusy > 0 && (
          <p className="mt-2 rounded bg-accent-soft px-2 py-1.5 text-xs leading-relaxed text-accent">
            Đang đọc nội dung {libraryBusy} tài liệu… Nhân viên tìm được bằng từ khoá ngay khi xong.
          </p>
        )}
      </div>

      {docs.length === 0 ? (
        <Empty
          icon={<FolderOpen className="h-7 w-7" />}
          title="Tủ tài liệu còn trống"
          hint="Thả vào đây tài liệu bạn muốn nhân viên đọc: hợp đồng, chính sách, bảng kê, CV. Nội dung được bóc ra một lần lúc thả vào, nên nhân viên tìm được bằng từ khoá mà không tốn thêm chi phí."
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {docs.map((d) => (
            <li key={d.name} className="border-b border-line px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] leading-snug text-ink" title={d.name}>
                    {d.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <StateChip state={d.state} />
                    <span>{d.shape ?? d.ext}</span>
                    <span>·</span>
                    <span className="tabular-nums">{formatBytes(d.bytes)}</span>
                    {d.tokens ? (
                      <>
                        <span>·</span>
                        {/* Con số này là để NGƯỜI DÙNG biết tài liệu dài cỡ nào,
                            không bao giờ đi vào prompt của model. Kế toán token
                            là việc của người đứng ngoài đếm. */}
                        <span className="tabular-nums">~{formatTokens(d.tokens)} token</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-none gap-1">
                  <a
                    href={officeId ? api.docUrl(officeId, d.name) : '#'}
                    download={d.name}
                    className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
                    aria-label={`Tải ${d.name}`}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    className="rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    onClick={() => setConfirmDel(d)}
                    aria-label={`Xoá ${d.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/*
                Câu giải thích khi tài liệu KHÔNG ở trạng thái sẵn sàng.
                Nền danger-soft chỉ dành cho lỗi thật: "bản chụp" và "chưa lập
                chỉ mục" là thông tin, không phải hỏng — tô đỏ chúng là dạy người
                dùng bỏ qua màu đỏ.
              */}
              {d.note && (
                <p
                  className={`mt-1.5 rounded px-2 py-1.5 text-xs leading-relaxed ${
                    d.state === 'failed' ? 'bg-danger-soft text-danger' : 'bg-line/50 text-muted'
                  }`}
                  role={d.state === 'failed' ? 'alert' : undefined}
                >
                  {d.note}
                </p>
              )}
              {d.state === 'ready' && d.preview && (
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{d.preview}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        Câu đối xứng với chân ngăn kéo Tri thức. Hai ngăn kéo mỗi cái nói mình
        LÀ GÌ và chỉ sang cái kia — đó là cách rẻ nhất để hai khái niệm không
        nhập làm một, và nó tốn 0 token vì nằm hoàn toàn ở giao diện.
      */}
      {docs.length > 0 && (
        <div className="flex-none border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
          Đây là tài liệu <b>bạn đưa vào</b>. Nội dung được bóc ra một lần lúc thả vào nên nhân viên tìm
          bằng từ khoá mà không tốn thêm chi phí.
        </div>
      )}

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent className="w-[min(30rem,94vw)]">
          <DialogHeader>
            <DialogTitle>Xoá tài liệu?</DialogTitle>
            <DialogDescription>
              {/* Tên file nằm TRONG câu hỏi, không phải ở đâu đó phía sau hộp
                  thoại: xoá hẳn thì người dùng phải đọc được chính xác cái gì
                  sắp biến mất. */}
              <b>{confirmDel?.name}</b> sẽ bị xoá khỏi tủ, cùng phần văn bản đã bóc ra. Bản gốc trên máy
              bạn không bị ảnh hưởng.
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

      <Dialog open={!!askReplace} onOpenChange={(o) => !o && setAskReplace(null)}>
        <DialogContent className="w-[min(30rem,94vw)]">
          <DialogHeader>
            <DialogTitle>Đã có tài liệu trùng tên</DialogTitle>
            <DialogDescription>
              Trong tủ đã có: {askReplace?.map((f) => f.name).join(', ')}. Thay thế sẽ ghi đè bản cũ và
              đọc lại nội dung từ đầu.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAskReplace(null)}>Giữ bản cũ</Button>
            <Button
              variant="primary"
              onClick={() => {
                const files = askReplace ?? [];
                setAskReplace(null);
                void upload(files, true);
              }}
            >
              Thay thế
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Nhãn trạng thái. `ready` KHÔNG có nhãn — trạng thái bình thường không cần nói. */
function StateChip({ state }: { state: DocState }) {
  if (state === 'ready') return null;
  const map: Record<Exclude<DocState, 'ready'>, { text: string; cls: string }> = {
    pending: { text: 'đang chờ', cls: 'bg-line/70 text-ink' },
    extracting: { text: 'đang đọc…', cls: 'bg-accent-soft text-accent' },
    'image-only': { text: 'bản chụp', cls: 'bg-warn-soft text-warn' },
    unindexed: { text: 'chưa lập chỉ mục', cls: 'bg-warn-soft text-warn' },
    failed: { text: 'lỗi', cls: 'bg-danger-soft text-danger' },
  };
  const s = map[state];
  return <span className={`rounded px-1.5 font-medium ${s.cls}`}>{s.text}</span>;
}

/** PHẢI khớp `formatBytes` ở `src/library/names.ts` — hai chỗ hiện cùng một con số. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${Math.round(n / 1000)}K`;
}
