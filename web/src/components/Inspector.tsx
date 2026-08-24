import { useEffect, useState } from 'react';
import { Archive, FileCode2, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input, Label, SectionTitle, Select, Textarea } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { actions, useApp } from '@/lib/store';
import type { CanvasNode } from '@/lib/types';

/**
 * Sửa hồ sơ nhân viên tại chỗ. → docs/SPEC-tools-approval.md §1
 *
 * KHÔNG autosave. Sửa `pitch` bump cacheKey của Trợ lý (pitch nằm trong roster
 * của nó). Nút Lưu tường minh và nói ra cái giá — cùng luật với skills.
 *
 * Mức model CỐ Ý không nằm trong form này nữa: nó có ô riêng (`ModelPicker`),
 * đúng một chỗ, dùng chung với Trợ lý. Cùng một thứ sửa được ở hai nơi là kiểu
 * gì rồi cũng có một nơi bị quên khi luật đổi.
 */
function AgentProfile({ node }: { node: CanvasNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.label);
  const [pitch, setPitch] = useState(node.pitch ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(node.label);
    setPitch(node.pitch ?? '');
    setOpen(false);
  }, [node.id, node.label, node.pitch]);

  const dirty = name !== node.label || pitch !== (node.pitch ?? '');

  if (!open) {
    return (
      <>
        {node.pitch && <Note>{node.pitch}</Note>}
        <button
          className="mb-3 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Sửa hồ sơ
        </button>
      </>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Label htmlFor="ag-name">Tên hiển thị</Label>
      <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} />

      <Label htmlFor="ag-pitch" className="mt-3">
        Giới thiệu
      </Label>
      <Textarea id="ag-pitch" rows={3} value={pitch} onChange={(e) => setPitch(e.target.value)} />

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Lưu sẽ làm Trợ lý ghi lại bộ nhớ đệm một lần — giới thiệu nằm trong ngữ cảnh của nó ở mọi lượt
        trò chuyện.
      </p>

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          Thôi
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || !pitch.trim() || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await actions.editAgent(node.role!, {
              display_name: name.trim(),
              pitch: pitch.trim(),
            });
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Đổi tên Trợ lý.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ô NÀY CỐ Ý *KHÔNG* CÓ CÂU CẢNH BÁO VỀ CACHE — và đó là thông tin.        │
 * │                                                                          │
 * │ Nó nằm ngay trên `ModelPicker`, thứ có nguyên một đoạn giải thích về bộ  │
 * │ nhớ đệm. Hai nút giống hệt nhau về hình dạng mà khác hẳn nhau về giá:    │
 * │ `display_name` **không nằm trong prompt của ai cả** (roster chỉ liệt kê  │
 * │ NHÂN VIÊN), nên đổi nó không ghi lại cache, không mất trí nhớ, không     │
 * │ đụng session.                                                            │
 * │                                                                          │
 * │ Dán một câu cảnh báo chung lên cả hai là dạy người dùng bỏ qua cảnh báo  │
 * │ — rồi họ bỏ qua đúng cái đáng đọc. Im lặng ở đây là một lựa chọn.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function AssistantName({ node }: { node: CanvasNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.label);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(node.label);
    setOpen(false);
  }, [node.id, node.label]);

  const trimmed = name.replace(/\s+/g, ' ').trim();

  if (!open) {
    return (
      <button
        className="mb-3 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
        Đổi tên Trợ lý
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Label htmlFor="as-name">Tên hiển thị</Label>
      <Input
        id="as-name"
        autoFocus
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ví dụ: Quản lý, Chị Lan, Điều phối viên"
      />
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Chỉ là cái tên trên sơ đồ và trong khung chat. Trợ lý <b>vẫn nhớ nguyên</b> mọi thứ đã nói, và
        không có gì phải chạy lại.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          Thôi
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!trimmed || trimmed === node.label || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await actions.renameAssistant(trimmed);
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </div>
    </div>
  );
}

const TIER_HINT: Record<string, string> = {
  eco: 'eco — rẻ nhất, chậm hơn và cần nhiều lượt hơn',
  standard: 'standard — cân bằng',
  deep: 'deep — chỉ cho việc thật khó, đắt hơn nhiều',
};

/**
 * Ô đổi model. MỘT component cho cả Trợ lý và nhân viên.
 * → docs/SPEC-offices.md §4.5
 *
 * Hai bên khác nhau đúng hai điểm, và cả hai đều là SỰ THẬT về cái giá phải trả:
 *
 *  - Trợ lý có tuỳ chọn "theo mặc định công ty", và đổi nó làm mất prompt cache
 *    một lượt (nó chạy `resume`, nên lượt đó gửi lại cả bản ghi hội thoại).
 *    Trí nhớ KHÔNG mất — bản ghi nằm trên đĩa, độc lập với model.
 *  - Nhân viên là hàm không trạng thái: đổi model không mất gì cả.
 *
 * Nói ra khác nhau đó thay vì một câu cảnh báo chung, vì một câu chung thì hoặc
 * doạ người dùng ở chỗ không đáng, hoặc trấn an ở chỗ đáng lo.
 */
function ModelPicker({ node }: { node: CanvasNode }) {
  const isAssistant = node.kind === 'assistant';
  const companyDefault = useApp((s) => s.company?.models.master ?? 'standard');
  const models = useApp((s) => s.company?.models);
  const [open, setOpen] = useState(false);
  const current = isAssistant && node.tierInherited ? '' : (node.tier ?? 'standard');
  const [tier, setTier] = useState(current);
  const [busy, setBusy] = useState(false);
  // Giữ dạng CHUỖI trong lúc gõ: number state biến "" thành 0 giữa chừng, và 0
  // ở đây mang nghĩa "không giới hạn" — người dùng xoá ô để sửa sẽ vô tình bỏ trần.
  const [usd, setUsd] = useState(String(node.maxUsd ?? 0));
  const [turns, setTurns] = useState(String(node.maxTurns ?? 6));

  useEffect(() => {
    setTier(isAssistant && node.tierInherited ? '' : (node.tier ?? 'standard'));
    setUsd(String(node.maxUsd ?? 0));
    setTurns(String(node.maxTurns ?? 6));
    setOpen(false);
  }, [node.id, node.tier, node.tierInherited, node.maxUsd, node.maxTurns, isAssistant]);

  const usdNum = Number(usd);
  const turnsNum = Number(turns);
  const limitsOk =
    Number.isFinite(usdNum) && usdNum >= 0 && Number.isInteger(turnsNum) && turnsNum >= 1;
  const limitsDirty = !isAssistant && (usdNum !== (node.maxUsd ?? 0) || turnsNum !== (node.maxTurns ?? 6));

  const effective = tier || companyDefault;

  if (!open) {
    return (
      <>
        <Row
          k="Mức model"
          v={
            <>
              {node.tier}
              {node.tierInherited ? ' · theo công ty' : ''}
            </>
          }
        />
        <Row k="Model" v={<span className="font-mono text-[11.5px]">{node.model}</span>} />
        {!isAssistant && (
          <Row
            k="Giới hạn một việc"
            v={
              <>
                {node.maxUsd ? `tối đa $${node.maxUsd}` : 'không giới hạn tiền'}
                {` · ${node.maxTurns ?? 6} bước`}
              </>
            }
          />
        )}
        <button
          className="mt-2 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {isAssistant ? 'Đổi model' : 'Đổi model & giới hạn'}
        </button>
      </>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-line p-3">
      <Label htmlFor="tier-pick">Mức model</Label>
      <Select
        id="tier-pick"
        className="w-full"
        value={tier}
        onChange={(e) => setTier(e.target.value)}
      >
        {isAssistant && <option value="">theo mặc định công ty ({companyDefault})</option>}
        <option value="eco">{TIER_HINT['eco']}</option>
        <option value="standard">{TIER_HINT['standard']}</option>
        <option value="deep">{TIER_HINT['deep']}</option>
      </Select>
      {models && (
        <p className="mt-1.5 font-mono text-[11.5px] text-muted">
          {models[effective as 'eco' | 'standard' | 'deep']}
        </p>
      )}

      {isAssistant ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Trợ lý <b>vẫn nhớ nguyên</b> cuộc trò chuyện — bản ghi nằm trên đĩa, không thuộc về model.
          Cái mất là bộ nhớ đệm: lượt sau phải gửi lại toàn bộ ngữ cảnh một lần, nên trò chuyện càng
          dài thì lần đổi này càng tốn. Sau đó về lại bình thường.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Nhân viên làm xong là quên, nên đổi model <b>không mất gì cả</b> — chỉ ghi lại bộ nhớ đệm
          một lần cho model mới.
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Việc đang chạy giữ nguyên model cũ cho tới khi xong. Mức mới áp dụng cho việc giao từ giờ.
      </p>

      {/*
        Giới hạn nằm CHUNG ô với mức model, không tách màn hình riêng: người dùng
        đổi tier là lúc duy nhất họ nghĩ về cái giá, và cùng một việc trên `deep`
        đắt gấp mấy lần trên `eco`. Tách ra là bắt họ nhớ quay lại sửa lần hai.
      */}
      {!isAssistant && (
        <div className="mt-4 border-t border-line pt-3">
          <Label htmlFor="lim-usd">Giới hạn cho MỘT việc</Label>
          <div className="mt-1.5 flex gap-2">
            <div className="flex-1">
              <Input
                id="lim-usd"
                type="number"
                min="0"
                step="0.5"
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
              />
              <p className="mt-1 text-[11.5px] text-muted">tiền tối đa ($) · 0 = không giới hạn</p>
            </div>
            <div className="flex-1">
              <Input
                id="lim-turns"
                type="number"
                min="1"
                step="1"
                value={turns}
                onChange={(e) => setTurns(e.target.value)}
              />
              <p className="mt-1 text-[11.5px] text-muted">số bước tối đa</p>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Đặt <b>rộng tay</b>. Chạm giới hạn giữa chừng là mất trắng số tiền đã tiêu mà chưa có kết
            quả — còn việc nào tiêu ít thì vốn dĩ đã chỉ tính tiền phần nó dùng.
          </p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          Thôi
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !limitsOk || (tier === current && !limitsDirty)}
          onClick={async () => {
            setBusy(true);
            const ok = isAssistant
              ? await actions.setAssistantTier(tier || null)
              : await actions.editAgent(node.role!, {
                  model_tier: tier,
                  max_usd: usdNum,
                  max_turns: turnsNum,
                });
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </div>
    </div>
  );
}


/**
 * Công tắc `Bash`. → docs/SPEC-tools-approval.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CÔNG TẮC DUY NHẤT VỀ KHẢ NĂNG TRONG CẢ SẢN PHẨM — và đó là chủ ý.        │
 * │                                                                          │
 * │ Sáu tool còn lại bật sẵn, không tắt được, vì chúng chỉ chạm tới thư mục  │
 * │ văn phòng hoặc chỉ đọc web. Hỏi người dùng bật `WebSearch` cho một nhân  │
 * │ viên tên "Người tìm tin" là hỏi một câu chỉ có một đáp án.                │
 * │                                                                          │
 * │ `Bash` khác HẲN về loại, không khác về mức: nó là thứ duy nhất ra được   │
 * │ khỏi văn phòng. Cụ thể — và câu này phải nói thẳng ra ở giao diện, không  │
 * │ chỉ nằm trong spec:                                                      │
 * │                                                                          │
 * │  · LUẬT "kết quả luôn sinh ra trong văn phòng" được thi hành bằng hook   │
 * │    `PreToolUse` khớp `Write|Edit|NotebookEdit` (worker.ts §officeJail).  │
 * │    `Bash` KHÔNG nằm trong matcher đó, và không thể nằm: đường dẫn của    │
 * │    một lệnh shell nằm trong chuỗi lệnh, không nằm ở một trường có tên.   │
 * │    Bật công tắc này là tự tay mở một cửa mà cái hook kia không canh.      │
 * │  · Cổng duyệt `write_external` ở SPEC §8 CHƯA được cài. Nên hôm nay      │
 * │    không có tầng chặn nào phía sau công tắc này cả.                      │
 * │                                                                          │
 * │ ⇒ Câu cảnh báo ở đây không phải thủ tục. Nó là tầng bảo vệ DUY NHẤT, nên │
 * │   nó nói ĐÚNG hậu quả ("đọc và ghi bất cứ đâu trên máy bạn") thay vì một │
 * │   câu chung chung kiểu "hãy cân nhắc".                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function BashSwitch({ node }: { node: CanvasNode }) {
  const on = !!node.bash;
  const [busy, setBusy] = useState(false);

  return (
    <div className={`mt-4 rounded-lg border p-3 ${on ? 'border-warn' : 'border-line'}`}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 flex-none accent-accent"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            await actions.editAgent(node.role!, { bash: e.target.checked });
            setBusy(false);
          }}
        />
        <span className="min-w-0">
          <span className="block text-[13px] text-ink">Cho chạy lệnh trên máy</span>
          <span className="block text-xs leading-relaxed text-muted">
            Xem được <b>kích thước · ngày sửa · dung lượng</b> file, chạy script, gọi git — những thứ
            các tool đọc file thường không lấy được. Kết quả vẫn lưu trong thư mục văn phòng. Tắt khi
            không cần: bật thì mỗi lượt tốn thêm ~2 700 token.
          </span>
        </span>
      </label>

      {/*
        ┌────────────────────────────────────────────────────────────────────┐
        │ ⚠ VIẾT LẠI 22/08 — CÂU CŨ VỪA DOẠ QUÁ TAY VỪA HỨA QUÁ TAY.        │
        │                                                                    │
        │ Cũ: *"đọc và ghi được bất cứ đâu trên máy bạn"* + *"ngoại lệ duy   │
        │ nhất của luật kết quả luôn nằm trong văn phòng"*.                   │
        │                                                                    │
        │ Sai ở hai đầu:                                                     │
        │  · KHÔNG phải ngoại lệ duy nhất về ĐỌC — `Read`/`Glob`/`Grep`      │
        │    cũng không có hàng rào nào (types.ts §BUILTIN_TOOLS).            │
        │  · "Ghi bất cứ đâu" thì đúng về mặt kỹ thuật nhưng SAI về mặt sản  │
        │    phẩm: `outputScoper` luôn kéo đầu ra về `artifacts/`, nên kế     │
        │    hoạch chưa bao giờ trỏ `Bash` ra ngoài. Ca 22/08 22:06 thử lối   │
        │    đó: 7 lượt · $0,3158 · blocked, không ra file nào.               │
        │                                                                    │
        │ Doạ quá tay làm người dùng tắt một thứ họ cần; hứa quá tay làm họ   │
        │ bật để mua một thứ không tồn tại. Cái sau tệ hơn.                   │
        │                                                                    │
        │ Câu mới giữ đúng MỘT cảnh báo, và nó có thật: lệnh chạy bằng quyền  │
        │ của chính người dùng. Chính sách "ghi ra ngoài phải qua tool/MCP    │
        │ tường minh" → SPEC-tools-approval.md §1b, §8.                       │
        └────────────────────────────────────────────────────────────────────┘
      */}
      {on && (
        <p className="mt-2.5 rounded bg-warn-soft px-2 py-1.5 text-xs leading-relaxed text-warn">
          Lệnh chạy bằng <b>quyền của chính bạn</b> trên máy này. Nhân viên chỉ được giao việc trong
          thư mục văn phòng, nhưng một câu lệnh thì không có hàng rào — nên chỉ bật cho người bạn
          thật sự cần.
        </p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px] last:border-0">
      <span className="text-ink">{k}</span>
      <span className="text-right text-muted">{v}</span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="my-3 text-xs leading-relaxed text-muted">{children}</p>;
}

/**
 * CÁNH TAY MỘT NGƯỜI ĐANG CẦM — hiện NHÃN, không hiện BĂM.
 *
 * Bản trước in thẳng `node.mcp.join(', ')`, ra `a385afc3ab6, a4fbabd0360`. Đó là
 * **cùng một con bug** đã vá ở nhật ký công việc 24/08, chỉ khác chỗ nó nằm: băm
 * là DANH TÍNH, không phải thứ để đọc. Người dùng đặt tên "Musics" thì mọi chỗ
 * phải nói "Musics" — bảng chi tiết cũng là một chỗ.
 *
 * Nhãn tra qua chính node 🔌 trên sơ đồ nên không cần dữ liệu mới. Rơi về băm khi
 * cánh tay đã biến khỏi `company.yaml`: lúc đó băm là thứ DUY NHẤT còn thật, và
 * nó khớp với dòng `Không còn khai trong company.yaml` ở panel của node kia.
 *
 * Nhãn ô cũ là *"Tool ngoài"* — từ vựng của người viết code. Người dùng kéo dây
 * từ một node tên **Kết nối**, nên ô này nói cùng thứ tiếng đó.
 */
function ArmList({ ids, nodes }: { ids?: string[]; nodes: CanvasNode[] }) {
  if (!ids?.length) return null;
  const name = (id: string) => nodes.find((n) => n.kind === 'mcp' && n.server === id)?.label ?? id;
  return <Row k="Kết nối đang dùng" v={ids.map(name).join(', ')} />;
}

/**
 * THƯ MỤC CÁNH TAY — chỉ đọc, và "chỉ đọc" ở đây là một câu về DANH TÍNH.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG PHẢI MỘT Ô NHẬP.                                            │
 * │                                                                          │
 * │ Nhãn sửa được vì nhãn không phải danh tính. Thư mục thì NẰM TRONG cấu     │
 * │ hình, mà danh tính = `armHash(cấu hình)` — nên "sửa thư mục" không phải   │
 * │ một phép sửa, nó là **một cánh tay khác**. Cho sửa tại chỗ là dựng lại    │
 * │ đúng ca GHI ĐÈ IM LẶNG mà §6i sinh ra để chặn: node y nguyên, mọi sợi     │
 * │ dây y nguyên, chỉ thư mục bên dưới đổi — **không có triệu chứng ở chỗ nó  │
 * │ nằm**. Đường đi đúng là `+ Kết nối` một cái mới rồi rút cái cũ.           │
 * │                                                                          │
 * │ Nhưng PHẢI HIỆN: đây là thứ trả lời câu *"nhân viên này với tới đâu"* —   │
 * │ hôm nay người dùng chỉ đọc được nó bằng cách mở `company.yaml`, mà một    │
 * │ bước "mở file yaml" là một chuông báo (§6, chốt 22/08).                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Hiện NGUYÊN VĂN, không chuẩn hoá dấu gạch và không dò hệ điều hành. Chuỗi
 * này để người dùng đối chiếu bằng mắt với Explorer/Finder, nên nó phải là thứ
 * họ đã nhập — `D:\…` trên Windows, `/home/…` trên Linux/macOS, và một văn phòng
 * zip từ máy khác hệ vẫn hiện đúng thứ đã ghi. `folderRoots` cố ý nhận cả hai
 * kiểu ở mọi nền tảng, cùng lý do `SHELL_ALIASES` gửi cả hai tên tool.
 *
 * Rỗng ⇒ KHÔNG vẽ gì: cánh tay Notion/GitHub không có thư mục nào, và một ô
 * trống nói dối rằng cấu hình bị thiếu.
 */
function ArmFolders({ folders }: { folders?: string[] }) {
  if (!folders?.length) return null;
  return (
    <div className="border-b border-line py-1.5 text-[13px] last:border-0">
      <div className="text-ink">Thư mục với tới được</div>
      <ul className="mt-1 space-y-0.5">
        {folders.map((f) => (
          // `break-all`: đường dẫn Windows có khoảng trắng lẫn dấu gạch ngược,
          // không ngắt dòng được ở chỗ tử tế nào. Thà xuống dòng giữa chừng còn
          // hơn tràn ngang cả panel.
          <li key={f} className="select-all break-all font-mono text-xs text-muted">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ĐỔI TÊN KẾT NỐI — và nó CỐ Ý không có câu cảnh báo nào.
 *
 * Nhãn không phải danh tính (danh tính là băm cấu hình), nên đổi nó không đụng
 * khoá, không viết lại `roles/*.yaml`, không phá cache của ai. Dán một câu
 * cảnh báo lên đây là dạy người dùng bỏ qua cảnh báo — rồi họ bỏ qua đúng cái
 * đáng đọc, y như lý do `renameAssistant` không có cảnh báo.
 */
function ArmName({ node }: { node: CanvasNode }) {
  const [text, setText] = useState(node.label);
  useEffect(() => setText(node.label), [node.label]);
  const dirty = text.trim() !== node.label && text.trim().length > 0;

  return (
    <div className="mt-3">
      <label className="text-[11px] uppercase tracking-wide text-muted">Tên hiển thị</label>
      <div className="mt-1 flex gap-1.5">
        <Input value={text} onChange={(e) => setText(e.target.value)} />
        <Button
          disabled={!dirty}
          onClick={() => void actions.renameArm(node.server!, text.trim())}
        >
          Lưu
        </Button>
      </div>
    </div>
  );
}

/** Bảng chi tiết bên phải. Mở khi chọn một node; ✕ để đóng. */
export function Inspector({ onShowPrompt }: { onShowPrompt(who: string): void }) {
  const canvas = useApp((s) => s.canvas);
  const selected = useApp((s) => s.selected);
  const [confirmRemove, setConfirmRemove] = useState<CanvasNode | null>(null);

  const node = canvas?.nodes.find((n) => n.id === selected);
  if (!canvas || !node) return null;

  /**
   * Node KHO không bao giờ có bảng chi tiết.
   *
   * Bảng này để CHỈNH một đối tượng. Kho tri thức và tủ tài liệu không có gì để
   * chỉnh — chúng là cửa dẫn tới một ngăn kéo, và bấm vào chúng mở thẳng ngăn
   * kéo đó (xem `onOpenStore` trong Canvas.tsx).
   *
   * Chốt đặt ở ĐÂY chứ không phải ở chỗ gọi, vì nó chặn cả LỚP lỗi: bản trước
   * tủ tài liệu chưa có nhánh render nên bấm vào nó mở ra một bảng rỗng chỉ có
   * dấu ✕ — và mỗi node kho thêm vào sau này sẽ lặp lại đúng như thế nếu ai đó
   * quên viết nhánh. Giờ quên cũng không sao.
   */
  if (node.kind === 'knowledge' || node.kind === 'library') return null;

  const onDuty = canvas.nodes.filter((n) => n.kind === 'agent' && n.connected);
  const off = canvas.nodes.filter((n) => n.kind === 'agent' && !n.connected);

  function toggleDuty(n: CanvasNode) {
    const edges = n.connected
      ? canvas!.edges.filter((e) => !(e.from === 'assistant' && e.to === n.id))
      : [...canvas!.edges, { from: 'assistant', to: n.id }];
    void actions.saveCanvas(canvas!.nodes, edges);
  }

  return (
    <aside className="flex w-[304px] flex-none flex-col border-l border-line bg-panel">
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="truncate text-[15px] font-semibold">
          {node.avatar ? `${node.avatar} ` : ''}
          {node.label}
        </span>
        <div className="flex-1" />
        <Button size="iconSm" variant="ghost" aria-label="Đóng" onClick={() => actions.select(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {node.kind === 'assistant' && (
          <>
            <Note>
              Trợ lý không tự làm việc. Nó chia việc, và chỉ nhìn thấy giới thiệu của những người{' '}
              <b>có dây nối</b> tới đây.
            </Note>
            <AssistantName node={node} />
            <ModelPicker node={node} />
            <Row k="Đang trực" v={`${onDuty.length} người`} />
            <Row k="Đang nghỉ" v={`${off.length} người`} />
            <Row k="Sổ tay riêng" v={`${node.count ?? 0} ghi chú`} />
            <ArmList ids={node.mcp} nodes={canvas.nodes} />
            <Note>
              Mỗi người đang trực chiếm một dòng giới thiệu trong ngữ cảnh của Trợ lý, ở <b>mọi</b> lượt trò
              chuyện. Ngắt dây người không dùng đến là tiết kiệm thật, không phải dọn cho gọn.
            </Note>
            <Button className="w-full" onClick={() => onShowPrompt('assistant')}>
              <FileCode2 className="h-4 w-4" />
              Xem prompt phân lớp
            </Button>
          </>
        )}

        {/*
          Nhánh `knowledge` đã BỎ (17/08). Hai đoạn giải thích của nó không mất
          — chúng chuyển vào chính ngăn kéo Tri thức, nơi chúng vốn thuộc về:
          đó là sự thật về cái KHO, không phải về cái node trên sơ đồ.
        */}

        {node.kind === 'mcp' && (
          <>
            <Row k="Loại" v="MCP server" />
            <Row
              k="Đang dùng"
              v={
                canvas.edges
                  .filter((e) => e.from === node.id)
                  .map((e) => canvas.nodes.find((n) => n.id === e.to)?.label ?? e.to)
                  .join(', ') || 'chưa ai'
              }
            />
            <ArmFolders folders={node.folders} />
            {node.missing && (
              <Note>
                <span className="text-danger">Không còn khai trong company.yaml.</span>
              </Note>
            )}
            <Note>
              Nối vào một nhân viên = ghi <code>mcp:</code> vào <code>roles/&lt;id&gt;.yaml</code> của người đó.
            </Note>

            {/*
              HAI MỨC, đúng như nhân viên có "Cho nghỉ" và "Cất đi" — ranh giới
              là *dựng lại được hay không*:

                Gỡ khỏi văn phòng  cắt mọi sợi dây ở ĐÂY. Cấu hình và chìa còn
                                   nguyên ở cấp công ty, nên nó quay lại qua
                                   "đã cắm ở văn phòng khác" trong `+ Kết nối`.
                Xoá hẳn            bỏ khỏi company.yaml. ⚠ CHÌA VẪN GIỮ — rút
                                   dây ≠ vứt chìa: người ta hay rút để xoay
                                   token, bắt đi lấy lại là phạt một thao tác
                                   vốn vô hại.
            */}
            <ArmName node={node} />

            {/*
              MỘT MỨC, KHÔNG HAI. (user chốt 23/08)

              Nhân viên có "Cất đi" và "Xoá hẳn" vì họ mang thứ dựng lại KHÔNG
              ĐƯỢC — kỹ năng, giới thiệu, sổ kinh nghiệm. Cánh tay chỉ mang cấu
              hình, mà cấu hình sống trong SỔ CHUNG và không ai xoá nó. Nên "xoá"
              ở đây đã có sẵn tính chất của "cất đi": cắm lại đúng thư mục ⇒ cùng
              băm ⇒ tìm thấy nguyên vẹn, không phải nhập lại gì.

              Mượn một khái niệm từ chỗ nó xứng đáng sang chỗ nó không, là thứ
              vừa được gỡ ra. → SPEC-arms.md §6i
            */}
            <Button variant="danger" className="mt-4 w-full" onClick={() => setConfirmRemove(node)}>
              Xoá khỏi văn phòng này
            </Button>
            <Note>
              Cấu hình và chìa khoá <b>vẫn được giữ</b>. Cắm lại đúng thứ này lúc nào cũng được — nút{' '}
              <b>Kết nối</b> sẽ tự tìm ra nó.
            </Note>
            <Note>
              Nối vào Trợ lý = việc vặt Trợ lý tự xử lý. Dây này hiện mới được <b>ghi nhận</b>: nó cần{' '}
              <code>concierge</code> (M1) mới chạy được — Trợ lý không tự cầm MCP, vì MCP phá prompt cache ở
              mỗi lượt trò chuyện.
            </Note>
          </>
        )}

        {node.kind === 'agent' && (
          <>
            <AgentProfile node={node} />
            <ModelPicker node={node} />
            <Row k="Mã vai trò" v={node.role} />
            <Row k="Sổ tay riêng" v={`${node.count ?? 0} ghi chú`} />
            <Row k="Trạng thái" v={node.connected ? 'đang trực' : 'đang nghỉ'} />
            <ArmList ids={node.mcp} nodes={canvas.nodes} />
            {node.missing && (
              <Note>
                <span className="text-danger">Không tìm thấy roles/{node.role}.yaml</span>
              </Note>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button onClick={() => onShowPrompt(node.role!)}>
                <FileCode2 className="h-4 w-4" />
                Xem prompt phân lớp
              </Button>
              <Button onClick={() => toggleDuty(node)}>
                {node.connected ? 'Cho nghỉ' : 'Cho trực lại'}
              </Button>
              {/* "Cho nghỉ" = còn trên sơ đồ, chỉ mất dây → tạm thời.
                  "Cất đi"  = biến khỏi sơ đồ, file còn nguyên → lâu dài.
                  Hai mức khác nhau thật, nên là hai nút, không phải một nút hỏi lại. */}
              <Button onClick={() => void actions.archiveAgent(node.role!, true)}>
                <Archive className="h-4 w-4" />
                Cất vào lưu trữ
              </Button>
              <Button variant="danger" onClick={() => setConfirmRemove(node)}>
                <Trash2 className="h-4 w-4" />
                Xoá hẳn
              </Button>
            </div>

            <Note>
              Mọi nhân viên đã có sẵn: đọc/ghi file trong văn phòng, và tìm trên web. Không cần bật gì.
            </Note>
            <BashSwitch node={node} />
          </>
        )}
      </div>

      <SectionTitle className="flex-none border-t border-line px-4 py-2">{node.kind}</SectionTitle>

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmRemove?.kind === 'mcp'
                ? `Xoá “${confirmRemove.label}” khỏi văn phòng này?`
                : `Xoá hẳn “${confirmRemove?.label}”?`}
            </DialogTitle>
            <DialogDescription>
              {confirmRemove?.kind === 'mcp' ? (
                <>
                  Kết nối này biến khỏi sơ đồ, và những nhân viên đang nối tới nó thôi dùng được.{' '}
                  <b>Chỉ văn phòng này</b> — nơi khác không bị chạm.
                  <br />
                  <br />
                  {/* Không doạ, vì không có gì đáng doạ: sổ chung giữ cấu hình và
                      chìa, nên đây là thao tác HOÀN TÁC ĐƯỢC. Nói đúng mức độ
                      của nó là cách giữ cho những cảnh báo THẬT còn sức nặng. */}
                  Cấu hình và chìa khoá <b>vẫn được giữ</b>. Cắm lại đúng thứ này thì không phải nhập
                  lại gì — chỉ mất công nối dây.
                </>
              ) : (
                <>
                  Mất file <code>roles/{confirmRemove?.role}.yaml</code> và toàn bộ kỹ năng bạn đã viết
                  cho người này. <b>Không lấy lại được.</b>
                  <br />
                  <br />
                  Sổ tay kinh nghiệm ở <code>knowledge/agents/{confirmRemove?.role}/</code> vẫn được giữ
                  — đó là thứ văn phòng đã học được, không phải tài sản riêng của một cái tên.
                  <br />
                  <br />
                  Chỉ muốn cất đi cho gọn? Bấm <b>Thôi</b> rồi chọn <b>Cất vào lưu trữ</b> — khôi phục
                  được bất cứ lúc nào.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRemove(null)}>Thôi</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmRemove?.kind === 'mcp' && confirmRemove.server) {
                  void actions.removeArm(confirmRemove.server);
                } else if (confirmRemove?.role) {
                  void actions.removeAgent(confirmRemove.role);
                }
                setConfirmRemove(null);
              }}
            >
              {confirmRemove?.kind === 'mcp' ? 'Xoá khỏi văn phòng' : 'Xoá hẳn'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
