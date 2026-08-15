import { memo } from 'react';

import { agentInk } from '@/lib/colors';
import { sizeOf } from './geometry';
import type { CanvasNode } from '@/lib/types';

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
          <text className="node-av" x={16} y={36}>
            {node.avatar || '★'}
          </text>
          <text className="node-nm" x={46} y={30}>
            {cut(node.label, 18)}
          </text>
          <text className="node-sub" x={46} y={50}>
            {cut(node.tier, 26)}
          </text>
          <text className="node-sub" x={16} y={70}>
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
            Kho tri thức chung
          </text>
          <text className="node-sub" x={44} y={50}>
            {node.count ?? 0} ghi chú · bấm để mở
          </text>
        </>
      )}

      {node.kind === 'mcp' && (
        <>
          <text className="node-av" x={12} y={36}>
            🔌
          </text>
          <text className="node-nm" x={38} y={28}>
            {cut(node.label, 16)}
          </text>
          <text className="node-sub" x={38} y={45}>
            {node.missing ? 'chưa khai trong company.yaml' : 'tool ngoài'}
          </text>
        </>
      )}

      {node.kind === 'agent' && (
        <>
          <rect x={0} y={0} width={4} height={s.h} rx={2} fill={ink} className="node-stripe" />
          <text className="node-av" x={16} y={32}>
            {node.avatar || '•'}
          </text>
          <text className="node-nm" x={46} y={30}>
            {cut(node.label, 17)}
          </text>
          {/* Câu `say` lúc chạy — canvas ghi thẳng textContent vào đây. */}
          <text className="node-say" x={16} y={56} />
          <text className="node-sub" x={16} y={76}>
            {node.missing ? 'không tìm thấy vai trò' : `📒 ${node.count ?? 0}  ·  ${node.tier ?? ''}`}
          </text>
          {!node.connected && (
            <text className="node-sub" x={s.w - 12} y={76} textAnchor="end">
              đang nghỉ
            </text>
          )}
        </>
      )}
    </>
  );
});
