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

import { useEffect, useState } from 'react';
import { Check, Loader2, Plug, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/misc';
import { api, ApiError } from '@/lib/api';
import { actions, useApp } from '@/lib/store';
import type { CatalogArm, InstalledArm, ProbeResult } from '@/lib/types';

/** Câu phụ nói CÁI GIÁ — người dùng chọn theo công sức, không theo tên hãng. */
const PRICE_SAY: Record<CatalogArm['price'], string> = {
  none: 'không cần chìa',
  keys: 'cần 1 chìa',
  login: 'cần đăng nhập',
};

export function ArmDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const officeId = useApp((s) => s.officeId);
  const canvas = useApp((s) => s.canvas);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [catalog, setCatalog] = useState<CatalogArm[]>([]);
  const [installed, setInstalled] = useState<InstalledArm[]>([]);

  const [pick, setPick] = useState<CatalogArm | null>(null);
  /** Đường B — dán cấu hình MCP. Không mục danh mục nào chặn ai. → §4c */
  const [paste, setPaste] = useState('');
  const [armId, setArmId] = useState('');
  const [folders, setFolders] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});

  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState('');
  const [grant, setGrant] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setPick(null);
    setPaste('');
    setArmId('');
    setFolders('');
    setKeys({});
    setProbe(null);
    setErr('');
    setGrant([]);
    void api.armCatalog().then((r) => setCatalog(r.arms)).catch(() => undefined);
    void api.arms().then((r) => setInstalled(r.arms)).catch(() => undefined);
  }, [open]);

  const agents = (canvas?.nodes ?? []).filter((n) => n.kind === 'agent' && n.role);

  /** Cấu hình sắp gửi đi. `null` = chưa đủ để thử. */
  function buildConfig(): Record<string, unknown> | null {
    if (pick) {
      if (pick.folders) {
        const list = folders.split('\n').map((s) => s.trim()).filter(Boolean);
        if (!list.length) return null;
        // Giữ ĐÚNG hình dạng `catalog.ts §build` dựng ra. Server là nơi ghép
        // thật; ở đây chỉ để nút Thử có cái mà gửi.
        return { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.7.10', ...list] };
      }
      return { command: 'npx', args: [] };
    }
    try {
      const parsed = JSON.parse(paste) as Record<string, unknown>;
      // Nhận cả hai hình dạng: khối `{"mcpServers":{"ten":{…}}}` chép nguyên từ
      // README, và khối cấu hình trần. Bắt người dùng bóc tay là bắt họ hiểu một
      // định dạng — đúng thứ cả §6 sinh ra để tránh.
      const servers = parsed['mcpServers'];
      if (servers && typeof servers === 'object') {
        const [name, cfg] = Object.entries(servers as Record<string, unknown>)[0] ?? [];
        if (name && !armId) setArmId(name);
        return (cfg as Record<string, unknown>) ?? null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function test() {
    const config = buildConfig();
    if (!config) {
      setErr(pick?.folders ? 'Điền ít nhất một thư mục.' : 'Chưa đọc được cấu hình — kiểm lại khối JSON.');
      return;
    }
    setErr('');
    setTesting(true);
    setProbe(null);
    try {
      setProbe(await api.testArm(armId || pick?.id || 'thu', config));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không thử được.');
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    const config = buildConfig();
    const id = (armId || pick?.id || '').trim();
    if (!config || !id || busy) return;
    setBusy(true);
    try {
      await api.addArm({
        id,
        config,
        ...(Object.keys(keys).length ? { secrets: keys } : {}),
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

  const ok = probe?.status === 'connected';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Cắm một kết nối' : step === 2 ? `Chìa khoá · ${pick?.name ?? armId}` : 'Ai được dùng?'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Chọn một cái có sẵn, dùng lại cái đã cắm, hoặc dán cấu hình của riêng bạn.'
              : step === 2
                ? 'Bấm Thử ngay để chắc chắn nó chạy trước khi lưu.'
                : 'Kết nối chỉ hoạt động với người được nối dây tới nó.'}
          </DialogDescription>
        </DialogHeader>

        {/* ─────────────────────────────────────────────── BƯỚC 1 · Chọn */}
        {step === 1 && (
          <div className="max-h-[52vh] overflow-y-auto">
            <div className="grid grid-cols-3 gap-2">
              {catalog.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setPick(a);
                    setArmId(a.id);
                    setStep(2);
                  }}
                  className="rounded-lg border border-line px-3 py-3 text-left transition hover:border-accent hover:bg-accent-soft"
                >
                  <div className="text-2xl">{a.icon}</div>
                  <div className="mt-1 text-[13px] font-medium">{a.name}</div>
                  {/* CÁI GIÁ, không phải tính năng. → §6f */}
                  <div className="mt-0.5 text-[11px] text-muted">{PRICE_SAY[a.price]}</div>
                </button>
              ))}
            </div>

            {/*
              `mcpServers` là cấp CÔNG TY: chìa đã khai rồi thì dùng lại là 0
              bước. Thiếu khối này là người dùng khai chìa Notion lần thứ hai và
              tự hỏi vì sao. → §6f khối 2
            */}
            {installed.length > 0 && (
              <>
                <div className="mt-4 text-[11px] uppercase tracking-wide text-muted">Đã cắm ở văn phòng khác</div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {installed.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setArmId(a.id);
                        setProbe({ status: 'connected', tools: [], connectMs: 0 });
                        setStep(3);
                      }}
                      className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-[13px] hover:border-accent"
                    >
                      <Plug className="h-3.5 w-3.5 text-muted" />
                      <span className="flex-1">{a.id}</span>
                      <span className="text-[11px] text-muted">dùng lại</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-4 text-[11px] uppercase tracking-wide text-muted">Hoặc tự cắm</div>
            <Textarea
              rows={4}
              className="mt-1.5 font-mono text-[12px]"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'Dán khối cấu hình MCP từ README của server, ví dụ:\n{ "command": "npx", "args": ["-y", "..."] }'}
            />
            <Button
              className="mt-2 w-full"
              disabled={!paste.trim()}
              onClick={() => {
                setPick(null);
                setStep(2);
              }}
            >
              Dùng cấu hình này
            </Button>
          </div>
        )}

        {/* ─────────────────────────────────────── BƯỚC 2 · Chìa & Thử ngay */}
        {step === 2 && (
          <div className="max-h-[52vh] overflow-y-auto">
            {!pick && (
              <>
                <Label htmlFor="arm-id">Đặt tên cho kết nối</Label>
                <Input
                  id="arm-id"
                  autoFocus
                  value={armId}
                  onChange={(e) => setArmId(e.target.value)}
                  placeholder="vi-du: notion"
                />
                <p className="mt-1 text-xs text-muted">Chữ thường, số, gạch ngang. Đây là tên hiện trên sơ đồ.</p>
              </>
            )}

            {pick?.folders && (
              <>
                <Label>{pick.folders.label}</Label>
                <FolderPicker
                  chosen={folders.split('\n').map((s) => s.trim()).filter(Boolean)}
                  onChange={(list) => {
                    setFolders(list.join('\n'));
                    // Đổi danh sách thư mục thì kết quả Thử cũ nói về một cấu
                    // hình KHÁC. Giữ dấu ✓ lại là cho Lưu một thứ chưa ai thử.
                    setProbe(null);
                  }}
                />
                <p className="mt-1.5 text-xs text-muted">{pick.folders.help}</p>
                {/*
                  Đo 23/08: một cánh tay `filesystem` nhận NHIỀU gốc cùng lúc và
                  vẫn `connected`. Nói ra, vì trực giác mặc định là "mỗi thư mục
                  một kết nối" — và đi đường đó thì đụng ngay chốt trùng mã.
                */}
                <p className="mt-1 text-xs text-muted">
                  Chọn được nhiều thư mục cho cùng một kết nối — không cần tạo nhiều cái.
                </p>
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

            <Button className="mt-4 w-full" onClick={() => void test()} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {testing ? 'Đang kết nối…' : 'Thử ngay'}
            </Button>
            {testing && (
              /* `pending` là trạng thái CÓ THẬT, kéo dài nhiều giây — đo đầu-cuối
                 qua route: **22,3 giây** lần đầu, ~4 giây khi cache `npx` đã ấm.
                 Nói ra con số, đừng để im lặng làm người dùng tưởng nó treo. */
              <p className="mt-1.5 text-xs text-muted">
                Lần đầu có thể mất khoảng 20–30 giây vì phải tải công cụ về máy. Những lần sau chỉ vài giây.
              </p>
            )}

            {probe && <ProbeReport r={probe} />}
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
function FolderPicker({ chosen, onChange }: { chosen: string[]; onChange(v: string[]): void }) {
  const [cur, setCur] = useState<{ path: string; parent: string | null; dirs: { name: string; path: string }[] }>({
    path: '',
    parent: null,
    dirs: [],
  });
  const [loading, setLoading] = useState(false);

  const go = (p?: string) => {
    setLoading(true);
    void api
      .browse(p)
      .then(setCur)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => go(), []);

  const here = cur.path;
  const already = here && chosen.includes(here);

  return (
    <div className="rounded-md border border-line">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <Button
          size="sm"
          disabled={cur.parent === null}
          onClick={() => go(cur.parent ?? undefined)}
          aria-label="Lên thư mục trên"
        >
          ↑
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {here || 'Chọn ổ đĩa'}
        </span>
        {/* Thêm CHÍNH thư mục đang mở — nếu không thì không có cách nào chọn một
            thư mục không có thư mục con, và đó là ca rất thường gặp. */}
        <Button size="sm" disabled={!here || !!already} onClick={() => onChange([...chosen, here])}>
          {already ? 'Đã chọn' : 'Chọn thư mục này'}
        </Button>
      </div>

      <div className="max-h-40 overflow-y-auto">
        {loading && <div className="px-3 py-2 text-xs text-muted">Đang đọc…</div>}
        {!loading && cur.dirs.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted">Không có thư mục con nào đọc được ở đây.</div>
        )}
        {!loading &&
          cur.dirs.map((d) => (
            <button
              key={d.path}
              type="button"
              onDoubleClick={() => go(d.path)}
              onClick={() => go(d.path)}
              className="block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-accent-soft"
            >
              📁 {d.name}
            </button>
          ))}
      </div>

      {chosen.length > 0 && (
        <div className="border-t border-line px-2 py-1.5">
          {chosen.map((p) => (
            <div key={p} className="flex items-center gap-2 py-0.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{p}</span>
              <button
                type="button"
                className="text-xs text-muted hover:text-danger"
                onClick={() => onChange(chosen.filter((x) => x !== p))}
              >
                bỏ
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Kết quả bắt tay. `status` có NĂM giá trị — `needs-auth` KHÔNG phải lỗi.
 *
 * ⚠ `failed` hiện NGUYÊN VĂN `error` của server: đó là chuỗi duy nhất người dùng
 * copy đi hỏi chỗ khác được. Thay nó bằng một câu chung chung của ta là lấy đi
 * thứ hữu ích duy nhất còn lại. → §6c
 */
function ProbeReport({ r }: { r: ProbeResult }) {
  if (r.status === 'connected') {
    const read = r.tools.filter((t) => t.level === 'read').length;
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
      </div>
    );
  }
  if (r.status === 'needs-auth') {
    return (
      <div className="mt-3 rounded-md border border-line px-3 py-2 text-[13px]">
        <div className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="h-4 w-4 text-warn" />
          Cần đăng nhập một lần
        </div>
        <div className="mt-1 text-xs text-muted">Kết nối được, nhưng dịch vụ này cần bạn cho phép trên trình duyệt.</div>
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
