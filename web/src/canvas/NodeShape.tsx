import { memo } from 'react';

import { ArmIcon } from '@/components/ArmIcon';
import { agentInk } from '@/lib/colors';
import { useApp } from '@/lib/store';
import { sizeOf } from './geometry';
import type { CanvasNode } from '@/lib/types';
import { plural, t } from '@i18n';

/**
 * Ruột của node Tủ tài liệu — tách riêng CHỈ để giữ ràng buộc hiệu năng.
 *
 * Nó phải theo `libraryBusy`, mà `libraryBusy` đổi khi có sự kiện SSE. Đăng ký
 * store ngay trong `NodeShape` thì mọi node trên sơ đồ render lại theo, đúng
 * thứ "một sự kiện SSE không kéo theo một lần render cây" đã cấm. Tách ra thì
 * chỉ đúng cái node này render lại.
 */
function LibraryBody({ count }: { count: number }) {
  const busy = useApp((s) => s.libraryBusy);
  return (
    <>
      <text className="node-av" x={14} y={40}>
        🗄
      </text>
      <text className="node-nm" x={44} y={30}>
        {t('node.library')}
      </text>
      {/*
        Câu phụ nói THẲNG cách đưa file vào, vì đây là node duy nhất trên sơ đồ
        mà người dùng làm gì đó với NÓ chứ không phải với một người — "bấm để mở"
        không đủ để đoán ra là thả file được.
      */}
      <text className="node-sub" x={44} y={50}>
        {busy > 0
          ? t('node.libraryBusy', { n: busy })
          : `${plural('node.libraryCount', count)} · ${t('node.libraryHint')}`}
      </text>
    </>
  );
}

function cut(s: string | undefined, n: number): string {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Một node. `memo` vì lúc kéo, component này KHÔNG render lại — vị trí do
 * canvas set thẳng vào `transform` của thẻ `<g>` bọc ngoài.
 *
 * Trạng thái sống (đang làm / xong / lỗi) cũng không đi qua props: canvas gắn
 * class lên `<g>`, CSS lo phần còn lại. Nhờ vậy một sự kiện SSE không kéo theo
 * một lần render cây.
 */
export const NodeShape = memo(function NodeShape({ node }: { node: CanvasNode }) {
  const s = sizeOf(node.kind);
  const ink = node.hue !== undefined ? agentInk(node.hue) : 'var(--color-muted)';

  return (
    <>
      <rect className="node-box" width={s.w} height={s.h} rx={12} />

      {node.kind === 'assistant' && (
        <>
          <text className="node-av" x={16} y={32}>
            {node.avatar || '★'}
          </text>
          <text className="node-nm" x={44} y={26}>
            {cut(node.label, 16)}
          </text>
          <text className="node-sub" x={44} y={44}>
            {cut(node.tier, 22)}
          </text>
          <text className="node-sub" x={16} y={s.h - 10}>
            📒 {node.count ?? 0}
          </text>
        </>
      )}

      {node.kind === 'knowledge' && (
        <>
          <text className="node-av" x={14} y={40}>
            📚
          </text>
          <text className="node-nm" x={44} y={30}>
            {t('node.knowledge')}
          </text>
          <text className="node-sub" x={44} y={50}>
            {plural('knowledge.noteCount', node.count ?? 0)} · {t('node.knowledgeHint')}
          </text>
        </>
      )}

      {/*
        Tủ tài liệu. Câu phụ nói THẲNG cách đưa file vào, vì đây là node duy
        nhất trên sơ đồ mà người dùng làm gì đó với NÓ chứ không phải với một
        người — "bấm để mở" không đủ để đoán ra là thả file được.
      */}
      {node.kind === 'library' && <LibraryBody count={node.count ?? 0} />}

      {node.kind === 'mcp' && (
        <>
          {/*
            ┌────────────────────────────────────────────────────────────────┐
            │ HÌNH CỦA HÃNG, KHÔNG PHẢI EMOJI PHÍCH CẮM. (user chốt 28/08)   │
            │                                                                │
            │ > *"đổi cái biểu tượng phích cắm thành chính đơn giản như vừa  │
            │ >  đổi (reuse, tôi thấy rất tối giản và đẹp)"*                  │
            │                                                                │
            │ Cùng hàm với hộp thoại Kết nối (`ArmIcon`), nên một cánh tay    │
            │ giữ nguyên hình từ lúc chọn tới lúc nằm trên sơ đồ. Emoji 🔌    │
            │ vừa mang màu của phông chữ hệ điều hành, vừa nói **loại giao    │
            │ thức** trong khi thứ người dùng cần phân biệt là **hãng nào**.  │
            │                                                                │
            │ ⚠ Vị trí bằng `x`/`y`/`size`, không bằng class: đây là bên      │
            │ trong `<svg>` của sơ đồ, Tailwind không với tới hệ toạ độ này.  │
            └────────────────────────────────────────────────────────────────┘
          */}
          <g className="node-av-mark">
            <ArmIcon
              mark={node.mark}
              kind={node.armKind ?? 'custom'}
              x={12}
              y={s.h / 2 - 9}
              size={18}
            />
          </g>
          <text className="node-nm" x={38} y={s.h / 2 - 3}>
            {cut(node.label, 14)}
          </text>
          {/*
            ┌────────────────────────────────────────────────────────────────┐
            │ DÒNG PHỤ NÓI **TÀI KHOẢN**, không nói "kết nối". (user 27/08)  │
            │                                                                │
            │ > *"ra canvas thì không còn phân biệt được nữa"*               │
            │                                                                │
            │ Chữ "kết nối" lặp lại đúng thứ hình phích cắm đã nói — nó tốn  │
            │ một dòng để không thêm gì. Còn thứ người dùng thật sự cần phân │
            │ biệt (hai cánh tay GitHub của hai tài khoản) thì trước nay chỉ │
            │ nằm trong `label`, và nhãn thì ĐÓNG BĂNG ở tài khoản đầu tiên. │
            │                                                                │
            │ `via` do server tra từ `arms[].secrets` mỗi lần đọc sơ đồ, nên │
            │ nó không lỗi thời được. Vắng `via` ⇒ mục không dùng OAuth (hay │
            │ workspace đã bị gỡ) ⇒ quay về câu cũ, KHÔNG bịa một cái tên.   │
            │ → `ArmDialog.tsx` (chỗ bỏ ghép tài khoản vào nhãn)             │
            └────────────────────────────────────────────────────────────────┘
          */}
          <text className="node-sub" x={38} y={s.h / 2 + 13}>
            {node.missing ? t('node.armMissing') : node.via ? cut(node.via, 16) : t('node.armFallback')}
          </text>
        </>
      )}

      {/*
        ⚠ TOẠ ĐỘ BÁM ĐÁY, KHÔNG PHẢI SỐ CỐ ĐỊNH.

        Bản trước ghi `y={76}` cho dòng cuối, đúng lúc node cao 88 — tức chừa
        12px. Ngày thu nhỏ node xuống 76 (23/08) thì dòng đó rơi ĐÚNG mép dưới,
        dính vào viền. Một hằng số hợp lệ đổi ở file khác, và chỗ này hỏng im
        lặng — cùng họ với hai test khoá cứng bước lưới hỏng cùng ngày.

        Neo theo `s.h` thì mọi lần chỉnh kích thước sau này tự đúng.
      */}
      {node.kind === 'agent' && (
        <>
          <rect x={0} y={0} width={4} height={s.h} rx={2} fill={ink} className="node-stripe" />
          <text className="node-av" x={16} y={30}>
            {node.avatar || '•'}
          </text>
          <text className="node-nm" x={44} y={28}>
            {cut(node.label, 15)}
          </text>
          {/* Câu `say` lúc chạy — canvas ghi thẳng textContent vào đây. */}
          <text className="node-say" x={16} y={s.h - 30} />
          <text className="node-sub" x={16} y={s.h - 12}>
            {node.missing ? t('node.roleMissing') : `📒 ${node.count ?? 0}  ·  ${node.tier ?? ''}`}
          </text>
          {!node.connected && (
            <text className="node-sub" x={s.w - 12} y={s.h - 12} textAnchor="end">
              {t('node.resting')}
            </text>
          )}
        </>
      )}
    </>
  );
});
