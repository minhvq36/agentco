import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

import { canConnect, type CanvasEdge, type CanvasNode, type CanvasState } from '@/lib/types';
import type { LiveAgent } from '@/lib/store';
import { NodeShape } from './NodeShape';
import {
  anchor,
  arrange,
  curve,
  DRAG_THRESHOLD,
  fitViewport,
  screenToWorld,
  sizeOf,
  ZOOM_MAX,
  ZOOM_MIN,
  type Point,
  type Viewport,
} from './geometry';

export interface CanvasHandle {
  fit(): void;
  autoArrange(): void;
  zoomBy(factor: number): void;
}

interface Props {
  canvas: CanvasState;
  live: Record<string, LiveAgent>;
  selected: string | null;
  onSelect(id: string | null): void;
  /** immediate = cạnh nối vừa đổi -> gửi ngay, đừng gộp nhịp. */
  onCommit(nodes: CanvasNode[], edges: CanvasEdge[], immediate?: boolean): void;
  /**
   * Bấm vào một node KHO (kho tri thức / tủ tài liệu) → mở thẳng ngăn kéo trái.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO KHÔNG ĐI QUA BẢNG CHI TIẾT BÊN PHẢI                               │
   * │                                                                          │
   * │ Bảng bên phải tồn tại để CHỈNH một đối tượng: đổi model, sửa hồ sơ,      │
   * │ nối/ngắt dây, cho nghỉ. Hai node kho KHÔNG có gì để chỉnh — chúng là     │
   * │ CỬA, không phải đối tượng. Bảng của chúng chỉ có vài con số và một nút   │
   * │ "Mở kho", tức là một cái sảnh phải đi qua để tới nơi mình muốn tới.      │
   * │                                                                          │
   * │ Và cái sảnh đó đẻ ra lỗi: tủ tài liệu chưa có nhánh trong Inspector nên  │
   * │ bấm vào nó mở ra một bảng RỖNG, chỉ có dấu ✕.                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  onOpenStore(kind: 'knowledge' | 'library'): void;
  /**
   * File thả thẳng lên node Tủ tài liệu.
   *
   * Canvas KHÔNG tự tải lên — nó chỉ chuyển tay. Toàn bộ việc tải lên (hỏi lại
   * khi trùng tên, câu từ chối, trạng thái từng file) sống ở đúng MỘT chỗ là
   * `LibraryPanel`. Hai cửa vào, một đường xử lý: nếu canvas gọi API riêng thì
   * đến ngày sửa luật trùng tên sẽ có một cửa được sửa và một cửa bị quên.
   */
  onDropDocs(files: File[]): void;
}

const edgeKey = (e: CanvasEdge): string => `${e.from} ${e.to}`;

/**
 * Canvas SVG viết tay. → docs/SPEC-canvas.md, docs/SPEC-ui.md §0
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG DÙNG STATE CHO VỊ TRÍ NODE                                  │
 * │                                                                          │
 * │ Kéo một node bắn ra ~60 sự kiện mỗi giây. Nếu mỗi sự kiện là một         │
 * │ setState thì React reconcile cả cây 60 lần/giây — và điều đó xảy ra ĐÚNG │
 * │ lúc công ty đang chạy, tức là đang có sự kiện SSE bắn vào cùng lúc.      │
 * │                                                                          │
 * │ Nên: vị trí sống trong `posRef` (Map thường), và lúc kéo ta ghi thẳng    │
 * │ `transform` lên thẻ <g> qua ref. React chỉ được biết khi THẢ CHUỘT.      │
 * │ Đây là chỗ tiêu chí "Hiệu năng" được thi hành, không phải được hứa.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { canvas, live, selected, onSelect, onCommit, onOpenStore, onDropDocs },
  ref,
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const ghostRef = useRef<SVGPathElement | null>(null);

  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, { wire: SVGPathElement; hit: SVGPathElement; cut: SVGGElement }>());

  /** Vị trí SỐNG. Nguồn sự thật trong lúc tương tác. */
  const posRef = useRef(new Map<string, Point>());
  const viewRef = useRef<Viewport>({ x: 0, y: 0, k: 1 });
  const edgesRef = useRef<CanvasEdge[]>(canvas.edges);
  const didFit = useRef(false);

  const drag = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const link = useRef<{ from: string; target: string | null } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);

  // ── đồng bộ dữ liệu từ server vào bản sống (không đụng khi đang kéo)
  useLayoutEffect(() => {
    if (drag.current || link.current) return;
    const next = new Map<string, Point>();
    for (const n of canvas.nodes) next.set(n.id, { x: n.x, y: n.y });
    posRef.current = next;
    edgesRef.current = canvas.edges;
    paintAll();
    if (!didFit.current && canvas.nodes.length > 0) {
      didFit.current = true;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  // ── trạng thái sống: gắn class + câu say, KHÔNG render lại node
  useEffect(() => {
    for (const n of canvas.nodes) {
      const g = nodeEls.current.get(n.id);
      if (!g) continue;
      const st = n.role ? live[n.role] : undefined;
      g.classList.toggle('is-working', st?.status === 'working');
      g.classList.toggle('is-done', st?.status === 'done');
      g.classList.toggle('is-error', st?.status === 'error');
      const say = g.querySelector<SVGTextElement>('.node-say');
      if (say) say.textContent = st ? trim(st.say, 30) : '';
    }
    for (const [key, els] of edgeEls.current) {
      const to = key.split(' ')[1] ?? '';
      const node = canvas.nodes.find((n) => n.id === to);
      const busy = !!(node?.role && live[node.role]?.status === 'working');
      els.wire.classList.toggle('wire-busy', busy);
      els.wire.classList.toggle('is-busy', busy);
    }
  }, [live, canvas.nodes]);

  // ── selection
  useEffect(() => {
    for (const [id, g] of nodeEls.current) g.classList.toggle('is-selected', id === selected);
  }, [selected, canvas.nodes]);

  const applyView = useCallback(() => {
    const v = viewRef.current;
    worldRef.current?.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
  }, []);

  const paintNode = useCallback((id: string) => {
    const p = posRef.current.get(id);
    const g = nodeEls.current.get(id);
    if (p && g) g.setAttribute('transform', `translate(${p.x},${p.y})`);
  }, []);

  const paintEdges = useCallback(
    (onlyTouching?: string) => {
      const nodeById = new Map(canvas.nodes.map((n) => [n.id, n]));
      for (const e of edgesRef.current) {
        if (onlyTouching && e.from !== onlyTouching && e.to !== onlyTouching) continue;
        const els = edgeEls.current.get(edgeKey(e));
        const from = nodeById.get(e.from);
        const to = nodeById.get(e.to);
        if (!els || !from || !to) continue;
        const pf = posRef.current.get(e.from) ?? from;
        const pt = posRef.current.get(e.to) ?? to;
        const up = from.kind === 'mcp';
        const a = anchor({ kind: from.kind, ...pf }, 'out', up);
        const b = anchor({ kind: to.kind, ...pt }, 'in', up);
        const d = curve(a, b, up);
        els.wire.setAttribute('d', d);
        els.hit.setAttribute('d', d);
        els.cut.setAttribute('transform', `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`);
      }
    },
    [canvas.nodes],
  );

  const paintAll = useCallback(() => {
    for (const id of posRef.current.keys()) paintNode(id);
    paintEdges();
    applyView();
  }, [paintNode, paintEdges, applyView]);

  const fit = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    viewRef.current = fitViewport(canvas.nodes, posRef.current, rect);
    applyView();
  }, [canvas.nodes, applyView]);

  const autoArrange = useCallback(() => {
    const placed = arrange(canvas.nodes);
    for (const [id, p] of placed) posRef.current.set(id, p);
    paintAll();
    fit();
    commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.nodes, paintAll, fit]);

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const v = viewRef.current;
      const k = clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX);
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      viewRef.current = { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
      applyView();
    },
    [applyView],
  );

  useImperativeHandle(ref, () => ({ fit, autoArrange, zoomBy }), [fit, autoArrange, zoomBy]);

  /**
   * Đẩy bản sống lên server. Gọi khi THẢ chuột, không gọi lúc đang kéo.
   *
   * `immediate` phân biệt hai loại thay đổi đi chung một hàm nhưng khác hẳn
   * bản chất: toạ độ là liên tục (gộp nhịp), cạnh nối là rời rạc (gửi ngay).
   * Gộp nhịp cho cạnh nối thì không có gì để gộp, chỉ có độ trễ để chịu.
   */
  const commit = useCallback(
    (immediate = false) => {
      const nodes = canvas.nodes.map((n) => {
        const p = posRef.current.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      });
      onCommit(nodes, edgesRef.current, immediate);
    },
    [canvas.nodes, onCommit],
  );

  // ── chuột

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      if (ev.button !== 0) return;
      const target = ev.target as Element;
      const rect = svgRef.current!.getBoundingClientRect();

      const portHost = target.closest<SVGGElement>('[data-port]');
      const nodeHost = target.closest<SVGGElement>('[data-node]');

      // Kéo từ cổng RA để nối dây. Node agent không có cổng ra, nên
      // agent→agent không vẽ ra được — đó là ràng buộc vật lý, không phải
      // một thông báo lỗi sau khi vẽ xong.
      /*
        KÉO ĐƯỢC TỪ CẢ HAI CỔNG CỦA NHÂN VIÊN. (user chốt 23/08)

        Luật: **thao tác khoan dung, hiển thị không bao giờ sai.** Người dùng
        bấm cổng trên của nhân viên rồi kéo vào một cánh tay — ý họ rõ ràng là
        "nối cái này vào người này", và bắt họ đoán đúng cổng nào là bắt họ học
        một luật của ta. Chiều thật được nắn lúc THẢ (`normalize`), còn chỗ vẽ
        thì luôn suy từ `from.kind` — nên không có ca nào hiện sai.
      */
      if (portHost?.dataset['port'] && nodeHost) {
        ev.preventDefault();
        link.current = { from: nodeHost.dataset['node']!, target: null };
        svgRef.current?.setPointerCapture(ev.pointerId);
        svgRef.current?.classList.add('is-linking');
        return;
      }
      if (portHost) {
        ev.preventDefault();
        return;
      }

      if (nodeHost) {
        ev.preventDefault();
        const id = nodeHost.dataset['node']!;
        const p = posRef.current.get(id);
        if (!p) return;
        const w = screenToWorld(ev, rect, viewRef.current);
        drag.current = { id, dx: w.x - p.x, dy: w.y - p.y, sx: ev.clientX, sy: ev.clientY, moved: false };
        svgRef.current?.setPointerCapture(ev.pointerId);
        nodeHost.classList.add('is-dragging');
        return;
      }

      if (target.closest('[data-edge]')) return;

      pan.current = { x: ev.clientX - viewRef.current.x, y: ev.clientY - viewRef.current.y };
      svgRef.current?.setPointerCapture(ev.pointerId);
      svgRef.current?.classList.add('is-panning');
      onSelect(null);
    },
    [onSelect],
  );

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      const d = drag.current;
      if (d) {
        if (!d.moved && Math.abs(ev.clientX - d.sx) < DRAG_THRESHOLD && Math.abs(ev.clientY - d.sy) < DRAG_THRESHOLD) {
          return;
        }
        d.moved = true;
        const w = screenToWorld(ev, rect, viewRef.current);
        posRef.current.set(d.id, { x: Math.round(w.x - d.dx), y: Math.round(w.y - d.dy) });
        paintNode(d.id);
        paintEdges(d.id);
        return;
      }

      const l = link.current;
      if (l) {
        const from = canvas.nodes.find((n) => n.id === l.from);
        if (!from) return;
        const pf = posRef.current.get(l.from) ?? from;
        const w = screenToWorld(ev, rect, viewRef.current);
        const gUp = from.kind === 'mcp';
        ghostRef.current?.setAttribute('d', curve(anchor({ kind: from.kind, ...pf }, 'out', gUp), w, gUp));

        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const host = over?.closest<SVGGElement>('[data-node]');
        const id = host?.dataset['node'] ?? null;
        const to = id ? canvas.nodes.find((n) => n.id === id) : undefined;
        // Nhận cả chiều ngược: kéo từ nhân viên sang cánh tay vẫn sáng lên, vì
        // `mcp → agent` hợp lệ. Chiều thật được nắn lúc thả.
        const ok =
          to && (canConnect(from, to, edgesRef.current) || canConnect(to, from, edgesRef.current))
            ? to.id
            : null;
        if (ok !== l.target) {
          if (l.target) nodeEls.current.get(l.target)?.classList.remove('is-droptarget');
          l.target = ok;
          if (ok) nodeEls.current.get(ok)?.classList.add('is-droptarget');
        }
        return;
      }

      if (pan.current) {
        viewRef.current = { ...viewRef.current, x: ev.clientX - pan.current.x, y: ev.clientY - pan.current.y };
        applyView();
      }
    },
    [canvas.nodes, paintNode, paintEdges, applyView],
  );

  const onPointerUp = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      svgRef.current?.releasePointerCapture(ev.pointerId);

      const d = drag.current;
      if (d) {
        nodeEls.current.get(d.id)?.classList.remove('is-dragging');
        drag.current = null;
        if (d.moved) commit();
        else {
          // Bấm (không kéo). Node kho mở thẳng ngăn kéo và KHÔNG được chọn —
          // chọn nó là mở kèm một bảng chi tiết rỗng bên phải.
          const kind = canvas.nodes.find((n) => n.id === d.id)?.kind;
          if (kind === 'knowledge' || kind === 'library') onOpenStore(kind);
          else onSelect(d.id);
        }
      }

      const l = link.current;
      if (l) {
        if (l.target) {
          nodeEls.current.get(l.target)?.classList.remove('is-droptarget');
          // Kéo ngược chiều thì ĐẢO LẠI, đừng từ chối: `mcp → agent` là chiều
          // duy nhất hợp lệ, nên kéo từ nhân viên sang cánh tay vẫn ra đúng nó.
          const a = canvas.nodes.find((n) => n.id === l.from);
          const b = canvas.nodes.find((n) => n.id === l.target);
          const flip = a && b && !canConnect(a, b, edgesRef.current) && canConnect(b, a, edgesRef.current);
          edgesRef.current = [
            ...edgesRef.current,
            flip ? { from: l.target, to: l.from } : { from: l.from, to: l.target },
          ];
          commit(true);
        }
        ghostRef.current?.removeAttribute('d');
        svgRef.current?.classList.remove('is-linking');
        link.current = null;
      }

      if (pan.current) {
        pan.current = null;
        svgRef.current?.classList.remove('is-panning');
      }
    },
    [canvas.nodes, commit, onSelect, onOpenStore],
  );

  const onWheel = useCallback(
    (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const v = viewRef.current;
      const k = clamp(v.k * (ev.deltaY < 0 ? 1.12 : 0.89), ZOOM_MIN, ZOOM_MAX);
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      viewRef.current = { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
      applyView();
    },
    [applyView],
  );

  // `passive: false` bắt buộc để preventDefault chặn được zoom của trình duyệt.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const cutEdge = useCallback(
    (e: CanvasEdge) => {
      edgesRef.current = edgesRef.current.filter((x) => !(x.from === e.from && x.to === e.to));
      commit(true);
    },
    [commit],
  );

  const nodeById = new Map(canvas.nodes.map((n) => [n.id, n]));

  return (
    <svg
      ref={svgRef}
      className="canvas-root h-full w-full touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <g ref={worldRef}>
        <g>
          {canvas.edges.map((e) => {
            const from = nodeById.get(e.from);
            const to = nodeById.get(e.to);
            if (!from || !to) return null;
            // Cánh tay ĐẨY LÊN, Trợ lý GIAO XUỐNG — hai quan hệ ngược chiều thì
            // phải vào hai cổng khác nhau. → `geometry.ts §anchor`
            const up = from.kind === 'mcp';
            const a = anchor(from, 'out', up);
            const b = anchor(to, 'in', up);
            const d = curve(a, b, up);
            return (
              <g key={edgeKey(e)} className="edge group" data-edge="">
                <path
                  className="wire"
                  d={d}
                  ref={(el) => bindEdge(edgeEls, edgeKey(e), 'wire', el)}
                />
                <path className="wire-hit" d={d} ref={(el) => bindEdge(edgeEls, edgeKey(e), 'hit', el)} />
                <g
                  className="cut"
                  transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`}
                  ref={(el) => bindEdge(edgeEls, edgeKey(e), 'cut', el)}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    cutEdge(e);
                  }}
                  role="button"
                  aria-label="Ngắt dây"
                >
                  <circle r={9} />
                  <text y={4} textAnchor="middle">
                    ✕
                  </text>
                </g>
              </g>
            );
          })}
        </g>

        <g>
          {canvas.nodes.map((n) => {
            const s = sizeOf(n.kind);
            return (
              <g
                key={n.id}
                className={`node node-${n.kind}${n.missing ? ' is-missing' : ''}${
                  n.kind === 'agent' && !n.connected ? ' is-off' : ''
                }`}
                data-node={n.id}
                transform={`translate(${n.x},${n.y})`}
                ref={(el) => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                // Không còn `onDoubleClick`: một cái bấm đã mở ngăn kéo rồi, và
                // `showPanel` không đảo trạng thái nên bấm đúp cũng chỉ là mở
                // hai lần. Bản trước dùng `openPanel` (có đảo) nên bấm đúp là
                // mở rồi đóng ngay — trông y hệt "bấm không ăn".
                //
                // Thả file THẲNG lên node. `preventDefault` ở `dragOver` là bắt
                // buộc — thiếu nó thì trình duyệt coi như không cho thả và mở
                // luôn file trong tab, cuốn mất cả trang đang mở.
                onDragOver={n.kind === 'library' ? (e) => e.preventDefault() : undefined}
                onDrop={
                  n.kind === 'library'
                    ? (e) => {
                        e.preventDefault();
                        onDropDocs([...e.dataTransfer.files]);
                      }
                    : undefined
                }
              >
                <NodeShape node={n} />

                {/*
                  ┌──────────────────────────────────────────────────────────┐
                  │ CỔNG PHẢI KHỚP CHỖ SỢI DÂY THẬT SỰ ĐI RA/VÀO.            │
                  │                                                          │
                  │   Trợ lý    dưới  → giao việc xuống                      │
                  │   nhân viên trên  ← nhận việc  ·  DƯỚI ← nhận cánh tay   │
                  │   cánh tay  TRÊN  → đẩy năng lực lên                     │
                  │                                                          │
                  │ Bản trước cho MCP một cổng ở ĐÁY trong khi dây đã đổi ra │
                  │ đi từ đỉnh (§anchor) — vòng tròn nằm một chỗ, dây mọc ra │
                  │ chỗ khác. Và nhân viên chỉ có MỘT cổng cho HAI quan hệ    │
                  │ ngược chiều nhau.                                        │
                  └──────────────────────────────────────────────────────────┘
                */}
                {(n.kind === 'agent' || n.kind === 'assistant') && (
                  <g data-port="in">
                    <circle className="port-hit" cx={s.w / 2} cy={0} r={13} />
                    <circle className="port" cx={s.w / 2} cy={0} r={5.5} />
                  </g>
                )}
                {n.kind === 'agent' && (
                  <g data-port="arm">
                    <circle className="port-hit" cx={s.w / 2} cy={s.h} r={13} />
                    <circle className="port" cx={s.w / 2} cy={s.h} r={5.5} />
                  </g>
                )}
                {n.kind === 'assistant' && (
                  <g data-port="out">
                    <circle className="port-hit" cx={s.w / 2} cy={s.h} r={13} />
                    <circle className="port" cx={s.w / 2} cy={s.h} r={5.5} />
                  </g>
                )}
                {n.kind === 'mcp' && (
                  <g data-port="out">
                    <circle className="port-hit" cx={s.w / 2} cy={0} r={13} />
                    <circle className="port" cx={s.w / 2} cy={0} r={5.5} />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        <path ref={ghostRef} className="ghost" />
      </g>
    </svg>
  );
});

function bindEdge(
  store: React.RefObject<Map<string, { wire: SVGPathElement; hit: SVGPathElement; cut: SVGGElement }>>,
  key: string,
  slot: 'wire' | 'hit' | 'cut',
  el: SVGPathElement | SVGGElement | null,
): void {
  const map = store.current;
  if (!el) {
    map.delete(key);
    return;
  }
  const cur = map.get(key) ?? ({} as { wire: SVGPathElement; hit: SVGPathElement; cut: SVGGElement });
  // @ts-expect-error — ba slot ba kiểu phần tử khác nhau, gán theo tên slot là đúng.
  cur[slot] = el;
  map.set(key, cur);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
