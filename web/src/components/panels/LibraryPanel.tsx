import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, RefreshCw, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmDelete } from '@/components/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CopyRef, Empty } from '@/components/ui/misc';
import { api, ApiError } from '@/lib/api';
import { actions, toast, useApp } from '@/lib/store';
import type { DocState, LibraryDoc } from '@/lib/types';
import { plural, t } from '@i18n';
import { formatBytes } from '@i18n/fmt';

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
        toast(err instanceof Error ? err.message : t('library.loadFailed'));
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
          else toast(`${file.name}: ${err instanceof Error ? err.message : t('library.uploadFailed')}`);
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
      toast(err instanceof Error ? err.message : t('library.deleteFailed'));
    } finally {
      setConfirmDel(null);
    }
  }

  /**
   * Bóc lại một tài liệu chưa dùng được. → SPEC-library.md §4.5
   *
   * KHÔNG hỏi lại: khác `remove`, thao tác này không mất gì cả — bản gốc vẫn
   * nguyên, chỉ có bản text được dựng lại. Hỏi lại một việc không có hậu quả là
   * dạy người dùng bấm "Đồng ý" mà không đọc, rồi họ bấm đúng như thế vào hộp
   * thoại xoá.
   */
  async function reextract(doc: LibraryDoc) {
    if (!officeId) return;
    setBusy(true);
    try {
      const r = await api.libraryReextract(officeId, doc.name);
      setDocs(r.docs);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('library.reextractFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (docs === null) return <div className="px-4 py-6 text-[13px] text-muted">{t('common.reading')}</div>;

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
          {busy ? t('library.uploading') : t('library.add')}
        </Button>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t('library.dropHint1')} <b>pdf · md · txt · csv · json · yaml</b>
          {t('library.dropHint2')} <b>docx · xlsx · pptx</b> {t('library.dropHint3')}
        </p>
        {/*
          Bóc văn bản chạy ngầm. Câu này đứng ở ĐẦU TỦ chứ không ở ô chat: việc
          đang xảy ra với tài liệu thì phải hiện cạnh tài liệu. Và nó biến mất
          khi `libraryBusy` về 0 — bản trước dùng chung dòng trạng thái của chat
          rồi không có đường nào tắt.
        */}
        {libraryBusy > 0 && (
          <p className="mt-2 rounded bg-accent-soft px-2 py-1.5 text-xs leading-relaxed text-accent">
            {plural('library.extracting', libraryBusy)}
          </p>
        )}
      </div>

      {docs.length === 0 ? (
        <Empty
          icon={<FolderOpen className="h-7 w-7" />}
          title={t('library.emptyTitle')}
          hint={t('library.emptyHint')}
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
                        <span className="tabular-nums">
                          {t('library.tokensApprox', { n: formatTokens(d.tokens) })}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-none gap-1">
                  {/* Đường dẫn ĐỦ, không phải `d.name`: tủ tài liệu và ngăn Kết
                      quả được phép có file trùng tên. → ui/misc.tsx `CopyRef` */}
                  <CopyRef path={`library/files/${d.name}`} />
                  {/*
                    BÓC LẠI — chỉ hiện khi tài liệu CHƯA dùng được.
                    Trạng thái là bản ghi về quá khứ, còn nguyên nhân thì sửa
                    được (cài thêm bộ đọc, nâng phiên bản). Thiếu nút này thì
                    cách duy nhất để thử lại là xoá rồi thả lại chính file của
                    mình — một thao tác đáng sợ, và người dùng có thể không còn
                    giữ bản gốc. → SPEC-library.md §4.5
                  */}
                  {d.state !== 'ready' && d.state !== 'pending' && d.state !== 'extracting' && (
                    <button
                      className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void reextract(d)}
                      aria-label={t('library.reextract', { name: d.name })}
                      title={t('library.reextractTip')}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  <a
                    href={officeId ? api.docUrl(officeId, d.name) : '#'}
                    download={d.name}
                    className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
                    aria-label={t('library.download', { name: d.name })}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    className="rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    onClick={() => setConfirmDel(d)}
                    aria-label={t('library.delete', { name: d.name })}
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
          {t('library.footerBefore')} <b>{t('library.footerBold')}</b>
          {t('library.footerAfter')}
        </div>
      )}

      {/* Tên file nằm TRONG câu hỏi, không phải ở đâu đó phía sau hộp thoại:
          xoá hẳn thì người dùng phải đọc được chính xác cái gì sắp biến mất.
          Enter = Xoá — xem chú thích ở `ConfirmDelete`. */}
      <ConfirmDelete
        open={!!confirmDel}
        title={t('library.confirmDeleteTitle')}
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && void remove(confirmDel)}
      >
        <b>{confirmDel?.name}</b> {t('library.confirmDeleteBody')}
      </ConfirmDelete>

      <Dialog open={!!askReplace} onOpenChange={(o) => !o && setAskReplace(null)}>
        <DialogContent className="w-[min(30rem,94vw)]">
          <DialogHeader>
            <DialogTitle>{t('library.clashTitle')}</DialogTitle>
            <DialogDescription>
              {t('library.clashBody', { names: askReplace?.map((f) => f.name).join(', ') ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAskReplace(null)}>{t('library.keepOld')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const files = askReplace ?? [];
                setAskReplace(null);
                void upload(files, true);
              }}
            >
              {t('library.replace')}
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
    pending: { text: t('library.state.pending'), cls: 'bg-line/70 text-ink' },
    extracting: { text: t('library.state.extracting'), cls: 'bg-accent-soft text-accent' },
    'image-only': { text: t('library.state.imageOnly'), cls: 'bg-warn-soft text-warn' },
    unindexed: { text: t('library.state.unindexed'), cls: 'bg-warn-soft text-warn' },
    failed: { text: t('library.state.failed'), cls: 'bg-danger-soft text-danger' },
  };
  const s = map[state];
  return <span className={`rounded px-1.5 font-medium ${s.cls}`}>{s.text}</span>;
}

/**
 * Rounded to `12K` past a thousand, and NOT localised.
 *
 * This is a rough scale for a human — "is this document long?" — not an amount
 * anyone adds up, so digit grouping would only make it look more precise than
 * it is. Exact counts go through `formatNumber`.
 */
function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${Math.round(n / 1000)}K`;
}
