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
import { Check, FolderOpen, Loader2, Plug, TriangleAlert } from 'lucide-react';

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

/** Thẻ chọn LOẠI ở bước 1. Câu phụ nói người dùng phải làm gì tiếp, không nói kỹ thuật. */
function TypeCard({
  icon,
  name,
  say,
  onClick,
}: {
  icon: string;
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
      <div className="text-2xl">{icon}</div>
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

export function ArmDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const officeId = useApp((s) => s.officeId);
  const canvas = useApp((s) => s.canvas);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  /** Bước 1 có ba mặt: chọn LOẠI → chọn dịch vụ / dán cấu hình. */
  const [pane, setPane] = useState<'type' | 'catalog' | 'paste'>('type');
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

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setPane('type');
    setPick(null);
    setReuse(null);
    setPaste('');
    setLabel('');
    setFolders('');
    setKeys({});
    setProbe(null);
    setErr('');
    setGrant([]);
    void api.armCatalog().then((r) => setCatalog(r.arms)).catch(() => undefined);
    /**
     * ⚠ LỌC NGAY Ở NGUỒN: chỉ giữ cánh tay văn phòng NÀY chưa có.
     *
     * Bản trước liệt kê cả sổ chung, nên mục văn phòng đang dùng vẫn hiện ra —
     * bấm vào thì đi qua chọn → thử ~20 giây → giao cho ai → rồi mới bị từ chối.
     * Bày ra một lựa chọn CHẮC CHẮN SAI rồi để người dùng đâm vào nó là tệ hơn
     * mọi câu báo lỗi viết khéo.
     */
    void api
      .arms()
      .then((r) => setInstalled(r.arms.filter((a) => !a.usedBy.some((u) => u.office === officeId))))
      .catch(() => undefined);
  }, [open, officeId]);

  const agents = (canvas?.nodes ?? []).filter((n) => n.kind === 'agent' && n.role);

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
   * Thứ gửi lên server. Mục danh mục thì gửi **`catalogId` + thư mục** và để
   * SERVER dựng — client không ghép chuỗi `npx …@phiên-bản` nữa.
   *
   * Bản trước client tự ghép, tức số phiên bản gói ghim ở HAI chỗ. Hai bản của
   * cùng một hằng số đã đốt dự án này một lần (`agentSlot` vs `arrange`).
   */
  function payload():
    | { armId?: string; config?: Record<string, unknown>; catalogId?: string; folders?: string[] }
    | null {
    // Dùng lại: chỉ gửi BĂM. Cấu hình, tên chìa và giá trị chìa đều nằm ở server
    // rồi — gửi lại bản sao của chúng qua HTTP là mở đường cho hai bản lệch nhau.
    if (reuse) return { armId: reuse.id };
    if (pick) {
      if (pick.folders && folderList().length === 0) return null;
      return { catalogId: pick.id, folders: folderList() };
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
        const [name, cfg] = Object.entries(servers as Record<string, unknown>)[0] ?? [];
        if (name && !label) setLabel(name);
        return (cfg as Record<string, unknown>) ?? null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function test() {
    const p = payload();
    if (!p) {
      setErr(pick?.folders ? 'Chọn ít nhất một thư mục.' : 'Chưa đọc được cấu hình — kiểm lại khối JSON.');
      return;
    }
    setErr('');
    setTesting(true);
    setSlow(false);
    setProbe(null);
    const tick = setTimeout(() => setSlow(true), 6_000);
    try {
      const k = filledKeys();
      setProbe(await api.testArm('thu', { ...p, ...(Object.keys(k).length ? { secrets: k } : {}) }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không thử được.');
    } finally {
      clearTimeout(tick);
      setTesting(false);
      setSlow(false);
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

  const ok = probe?.status === 'connected';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === 1
              ? 'Cắm một kết nối'
              : step === 2
                ? `Cài đặt · ${pick?.name ?? label ?? ''}`
                : 'Ai được dùng?'}
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
              <div className="grid grid-cols-3 gap-2">
                <TypeCard
                  icon="📁"
                  name="Thư mục trên máy"
                  say="chọn thư mục · không cần chìa"
                  onClick={() => {
                    const files = catalog.find((a) => a.folders);
                    if (!files) return;
                    setPick(files);
                    // Ba đường LOẠI TRỪ NHAU. Quay lại rồi chọn đường khác mà
                    // không xoá đường cũ là để `payload()` im lặng chọn hộ.
                    setReuse(null);
                    setLabel(files.name);
                    setStep(2);
                  }}
                />
                <TypeCard
                  icon="🔌"
                  name="Dịch vụ có sẵn"
                  say={`${catalog.filter((a) => !a.folders).length} dịch vụ · điền chìa`}
                  onClick={() => setPane('catalog')}
                />
                <TypeCard
                  icon="⚙️"
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
                          setPick(a);
                          setReuse(null);
                          setLabel(a.name);
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
                  {catalog.filter((a) => !a.folders).length === 0 && (
                    <p className="col-span-3 text-[13px] text-muted">
                      Chưa có dịch vụ dựng sẵn nào. Dùng <b>Tự cắm MCP</b> — nó nhận mọi server.
                    </p>
                  )}
                </div>
              </>
            )}

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
                        /*
                          DÙNG LẠI ĐÚNG MỤC ĐÓ, không nhân bản cấu hình.

                          Danh tính là băm cấu hình, nên "chép sang một mã mới"
                          không còn nghĩa gì: cùng cấu hình ⇒ cùng băm ⇒ vẫn là
                          nó. Cái "clone" mà user muốn nằm ở tầng khác — SỰ HIỆN
                          DIỆN theo từng văn phòng (`role.mcp`), không phải bản
                          sao cấu hình. → SPEC-arms.md §6i

                          ⚠ VÀ ĐÓ CHÍNH LÀ THỨ BẢN CŨ Ở ĐÂY PHÁ HỎNG. Nó gọi
                          `setPaste(JSON.stringify(a.config))` — tức đẩy mục này
                          sang đường "TỰ CẮM", nơi không ai biết nó cần chìa gì.
                          Với cánh tay stdio thì chưa lộ (chìa đi qua `env`, mà
                          `filesystem` không cần chìa nào); với cánh tay HTTP đầu
                          tiên thì hỏng ngay: `${NOTION_ACCESS_TOKEN}` bay lên
                          Notion nguyên văn → 401. Và `secretNames` thành `[]`,
                          mà tên chìa NẰM TRONG BĂM ⇒ nó tạo bản sao thứ hai
                          thay vì dùng lại. "Dùng lại" mà nhân bản, im lặng.
                        */
                        setPick(null);
                        setPaste('');
                        setReuse(a);
                        setLabel(a.label);
                        setProbe(null);
                        setStep(2);
                      }}
                      className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-[13px] hover:border-accent"
                    >
                      <Plug className="h-3.5 w-3.5 text-muted" />
                      <span className="flex-1 truncate">{a.label}</span>
                      <span className="shrink-0 text-[11px] text-muted">dùng lại</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {pane === 'paste' && (
              <>
                <Button size="sm" className="mb-2" onClick={() => setPane('type')}>
                  ← Quay lại
                </Button>
                <Textarea
                  rows={5}
                  autoFocus
                  className="font-mono text-[12px]"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={'Dán khối cấu hình MCP từ README của server, ví dụ:\n{ "command": "npx", "args": ["-y", "..."] }'}
                />
                <p className="mt-1 text-xs text-muted">
                  Nhận cả khối <code>{'{"mcpServers": {...}}'}</code> chép nguyên từ tài liệu.
                </p>
                <Button
                  className="mt-2 w-full"
                  disabled={!paste.trim()}
                  onClick={() => {
                    setPick(null);
                    setReuse(null);
                    setStep(2);
                  }}
                >
                  Dùng cấu hình này
                </Button>
              </>
            )}
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
                <div className="mt-1 text-xs text-muted">Đổi tên được sau, trong bảng chi tiết của nó.</div>
              </div>
            )}

            {pick?.folders && (
              <>
                <Label>{pick.folders.label}</Label>
                <FolderPicker
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
                  Mỗi kết nối trỏ vào <b>một</b> thư mục. Cần nhiều chỗ thì tạo thêm kết nối, hoặc chọn
                  thư mục cha chung.
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
        <Button size="sm" className="mt-2 w-full" onClick={() => setOpen(true)}>
          <FolderOpen className="h-3.5 w-3.5" />
          {chosen.length ? 'Đổi thư mục…' : 'Chọn thư mục…'}
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
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
  onChange(v: string[]): void;
}) {
  const [cur, setCur] = useState<{ path: string; parent: string | null; dirs: { name: string; path: string }[] }>({
    path: '',
    parent: null,
    dirs: [],
  });
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);

  const go = (p?: string) => {
    setLoading(true);
    void api
      .browse(p)
      .then((r) => {
        setCur(r);
        setTyped(r.path);
        if (r.path) localStorage.setItem(LAST_DIR, r.path);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) go(localStorage.getItem(LAST_DIR) ?? undefined);
  }, [open]);

  const here = cur.path;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-5xl">
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

        <div className="mt-2 grid max-h-[46vh] grid-cols-4 gap-1 overflow-y-auto rounded-md border border-line p-1">
          {loading && <div className="col-span-4 px-2 py-2 text-xs text-muted">Đang đọc…</div>}
          {!loading && cur.dirs.length === 0 && (
            <div className="col-span-4 px-2 py-2 text-xs text-muted">
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



