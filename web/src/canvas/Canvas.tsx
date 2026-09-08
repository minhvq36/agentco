import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { Trash2 } from 'lucide-react';

import { canConnect, type CanvasEdge, type CanvasNode, type CanvasState } from '@/lib/types';
import type { LiveAgent } from '@/lib/store';
import { NodeShape } from './NodeShape';
import { t } from '@i18n';
import { nearWire } from '@core/layout-geometry';
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
  /** immediate = an edge just changed → send now, do not coalesce. */
  onCommit(nodes: CanvasNode[], edges: CanvasEdge[], immediate?: boolean): void;
  /**
   * Clicking a STORE node (knowledge store / library) → open the left drawer
   * directly.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY IT DOES NOT GO THROUGH THE INSPECTOR ON THE RIGHT                    │
   * │                                                                          │
   * │ The right-hand panel exists to EDIT an object: change the model, edit a  │
   * │ profile, wire and unwire, send someone home. The two store nodes have    │
   * │ NOTHING to edit — they are DOORS, not objects. Their panel held a couple │
   * │ of numbers and an "Open store" button: a lobby to walk through on the    │
   * │ way to where you were going.                                             │
   * │                                                                          │
   * │ And that lobby produced a bug: the library had no branch in the          │
   * │ Inspector, so clicking it opened an EMPTY panel with nothing but a ✕.    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  onOpenStore(kind: 'knowledge' | 'library'): void;
  /**
   * Files dropped straight onto the library node.
   *
   * The canvas does NOT upload — it only hands over. All of uploading (asking on
   * a name clash, the refusal messages, per-file state) lives in exactly ONE
   * place, `LibraryPanel`. Two entrances, one path: if the canvas called the API
   * itself, then the day the name-clash rule changes, one entrance gets fixed and
   * the other is forgotten.
   */
  onDropDocs(files: File[]): void;
}

const edgeKey = (e: CanvasEdge): string => `${e.from} ${e.to}`;

/**
 * A hand-written SVG canvas. → docs/SPEC-canvas.md, docs/SPEC-ui.md §0
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY NODE POSITIONS ARE NOT IN STATE                                      │
 * │                                                                          │
 * │ Dragging a node fires ~60 events a second. If each one were a setState,  │
 * │ React would reconcile the whole tree 60 times a second — and that        │
 * │ happens EXACTLY while the company is working, i.e. while SSE events are  │
 * │ arriving at the same time.                                               │
 * │                                                                          │
 * │ So: positions live in `posRef` (a plain Map), and during a drag we write │
 * │ `transform` straight onto the <g> element through a ref. React is only   │
 * │ told on POINTER UP. This is where the "Performance" bar is enforced      │
 * │ rather than promised.                                                    │
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
  const edgeEls = useRef(new Map<string, EdgeEls>());

  /** LIVE positions. The source of truth while the user is interacting. */
  const posRef = useRef(new Map<string, Point>());
  const viewRef = useRef<Viewport>({ x: 0, y: 0, k: 1 });
  const edgesRef = useRef<CanvasEdge[]>(canvas.edges);
  const didFit = useRef(false);

  const drag = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  /** `top` = the TOP port is being held. Decides where the ghost wire grows from. */
  const link = useRef<{ from: string; target: string | null; top: boolean } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);

  // ── sync server data into the live copy (untouched while a drag is in flight)
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

  // ── live state: toggle classes and the say line, WITHOUT re-rendering the node
  useEffect(() => {
    for (const n of canvas.nodes) {
      const g = nodeEls.current.get(n.id);
      if (!g) continue;
      const st = n.role ? live[n.role] : undefined;
      g.classList.toggle('is-working', st?.status === 'working');
      g.classList.toggle('is-done', st?.status === 'done');
      g.classList.toggle('is-error', st?.status === 'error');
      const say = g.querySelector<SVGTextElement>('.node-say');
      if (say) fitSay(say, st ? st.say : '');
    }
    for (const [key, els] of edgeEls.current) {
      const to = key.split(' ')[1] ?? '';
      const node = canvas.nodes.find((n) => n.id === to);
      const busy = !!(node?.role && live[node.role]?.status === 'working');
      els.wire?.classList.toggle('wire-busy', busy);
      els.wire?.classList.toggle('is-busy', busy);
    }
  }, [live, canvas.nodes]);

  /**
   * ── WHICH WIRE IS UNDER THE POINTER. → SPEC-office-animation.md §17j
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A CLASS TOGGLE THROUGH THE REF MAP, NOT REACT STATE.                     │
   * │                                                                          │
   * │ Hovering a wire must not re-render a canvas that is holding 60 fps while │
   * │ SSE delivers into it — the rule this file has enforced since day one.    │
   * │ The elements are already in `edgeEls`; two `classList.toggle` calls do   │
   * │ the whole job.                                                           │
   * │                                                                          │
   * │ ⚠ AND THE DELAY IS NOT A FUDGE. The wire and its button are now in two    │
   * │ different groups, so the pointer travelling from one to the other fires  │
   * │ `leave` before `enter`. Clearing immediately would make the button       │
   * │ vanish underneath the finger reaching for it — which is a sharper        │
   * │ version of the bug being fixed.                                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const coolTimer = useRef(0);
  /**
   * 🔴 THE CHOSEN WIRE, AND IT OUTLIVES THE POINTER. → §17j′
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HOVER ALONE COULD NOT REACH ITS OWN BUTTON, AND THE USER SAID SO         │
   * │ EXACTLY: *"if I go for the delete button and meet another node on the    │
   * │ way, the wire is lost and I cannot delete it."*                          │
   * │                                                                          │
   * │ The button sits at the wire's MIDPOINT, which on this diagram is         │
   * │ routinely on top of, or behind, a third node. Crossing that node fires   │
   * │ `pointerleave` on the wire and nothing fires `enter`, so the 90 ms grace │
   * │ expires and the button goes out from under the finger. A longer grace is │
   * │ the same bug with a wider window — the pointer can dwell over the node   │
   * │ for as long as it likes.                                                 │
   * │                                                                          │
   * │ ⇒ A CLICK LATCHES IT. Hover still previews, and preview still expires;   │
   * │ a latched wire stays lit until the user clicks somewhere else or presses │
   * │ Escape, so the trip to the button has no time limit at all. This is the  │
   * │ same shape as node selection, which is why it reads as one idea.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const stuck = useRef<string | null>(null);
  /**
   * ⚠ TWO CLASSES, NOT ONE. `is-hot` says *lit*; `is-stuck` says *this one is
   * CHOSEN and will stay*. They looked identical in the first cut, so a click
   * that latched an edge produced no change on screen and the user went on
   * tracing the wire with the pointer — the gesture this was built to replace.
   * A state the user cannot see is a state they will not use.
   */
  /**
   * 🔴 WHICH WIRE IS LIT RIGHT NOW — the one Delete acts on. → §17j″
   *
   * ⚠ NOT `stuck`. A latched edge and a hovered edge are two different answers,
   * and while the pointer is previewing edge B the LATCHED one is edge A: a
   * shortcut reading `stuck` would cut a wire the user cannot see highlighted.
   * The key acts on what is on screen, which is the only thing the user is
   * looking at — and it hands hover users the same shortcut for free.
   */
  const lit = useRef<string | null>(null);
  const paintHot = useCallback((key: string | null) => {
    lit.current = key;
    const held = stuck.current;
    for (const [k, els] of edgeEls.current) {
      const on = k === key;
      const held_ = k === held && on;
      for (const el of [els.wire, els.cut, els.halo]) {
        el?.classList.toggle('is-hot', on);
        el?.classList.toggle('is-stuck', held_);
      }
    }
  }, []);
  const hot = useCallback(
    (key: string) => {
      if (coolTimer.current) {
        clearTimeout(coolTimer.current);
        coolTimer.current = 0;
      }
      paintHot(key);
    },
    [paintHot],
  );
  const cool = useCallback(() => {
    if (coolTimer.current) clearTimeout(coolTimer.current);
    coolTimer.current = window.setTimeout(() => {
      coolTimer.current = 0;
      // ⚠ Back to the LATCHED wire, not to nothing. Without this the preview's
      // expiry would silently cancel a choice the user made with a click.
      paintHot(stuck.current);
    }, COOL_MS);
  }, [paintHot]);
  /** Latch a wire, or let go of the one latched. `null` clears. */
  const stick = useCallback(
    (key: string | null) => {
      if (stuck.current === key) return;
      stuck.current = key;
      if (coolTimer.current) {
        clearTimeout(coolTimer.current);
        coolTimer.current = 0;
      }
      paintHot(key);
    },
    [paintHot],
  );
  useEffect(() => () => clearTimeout(coolTimer.current), []);


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
        els.wire?.setAttribute('d', d);
        els.hit?.setAttribute('d', d);
        // ⚠ The halo takes the SAME `d`, from the same variable, in the same
        // pass. It is a second drawing of one curve — the pair this file has to
        // keep identical, which is why neither is allowed its own arithmetic.
        els.halo?.setAttribute('d', d);
        els.cut?.setAttribute('transform', `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`);
      }
    },
    [canvas.nodes],
  );

  /**
   * The two ends of ONE wire, in world units, from the LIVE positions.
   *
   * ⚠ `posRef` first, `canvas.nodes` second — the same order `paintEdges` reads
   * in. While a node is being dragged the store is a frame behind, and a reach
   * test against last frame's anchors would drop the wire the user is holding.
   */
  const endsOf = useCallback(
    (key: string): { a: Point; b: Point; up: boolean } | null => {
      const e = edgesRef.current.find((x) => edgeKey(x) === key);
      if (!e) return null;
      const from = canvas.nodes.find((n) => n.id === e.from);
      const to = canvas.nodes.find((n) => n.id === e.to);
      if (!from || !to) return null;
      const up = from.kind === 'mcp';
      const pf = posRef.current.get(e.from) ?? from;
      const pt = posRef.current.get(e.to) ?? to;
      return {
        a: anchor({ kind: from.kind, ...pf }, 'out', up),
        b: anchor({ kind: to.kind, ...pt }, 'in', up),
        up,
      };
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
    const placed = arrange(canvas.nodes, canvas.edges);
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
   * Push the live copy to the server. Called on POINTER UP, never mid-drag.
   *
   * `immediate` separates two kinds of change that share one function but are
   * nothing alike: coordinates are continuous (coalesce them), edges are discrete
   * (send at once). Coalescing an edge change has nothing to coalesce — only
   * latency to pay.
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

  // ── pointer

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      if (ev.button !== 0) return;
      /**
       * ⚠ ANY pointer-down that reaches the canvas lets go of the latched wire.
       * The two places that must NOT — the wire's own hit path and its delete
       * button — both `stopPropagation`, so this handler never sees them. One
       * rule, expressed by which events arrive, rather than a list of
       * exceptions here that a new element could fall off the end of. → §17j′
       */
      stick(null);
      const target = ev.target as Element;
      const rect = svgRef.current!.getBoundingClientRect();

      const portHost = target.closest<SVGGElement>('[data-port]');
      const nodeHost = target.closest<SVGGElement>('[data-node]');

      // Drag from an OUT port to make a wire. An agent node has no out port, so
      // agent→agent cannot be drawn at all — a physical constraint, not an error
      // message after the fact.
      /*
        BOTH OF AN EMPLOYEE'S PORTS CAN BE DRAGGED FROM. (the user's call, 23/08)

        The rule: **forgiving on input, never wrong on display.** A user grabs an
        employee's top port and drags to an arm — their intent is plainly "connect
        this to this person", and making them guess the right port makes them
        learn a rule of ours. The real direction is straightened out on DROP
        (`normalize`), and where things are drawn is always derived from
        `from.kind` — so there is no case that renders wrongly.
      */
      if (portHost?.dataset['port'] && nodeHost) {
        ev.preventDefault();
        // Remember WHICH PORT is being held: the ghost wire has to grow from the
        // exact place the finger went down. Deriving it from `from.kind`, the way
        // a real wire does, is wrong here — a real wire already knows what is at
        // the other end, and a ghost does not.
        link.current = {
          from: nodeHost.dataset['node']!,
          target: null,
          // Read the SIDE, do not infer it from the port's name.
          // → `data-side` where the node is drawn
          top: portHost.dataset['side'] === 'top',
        };
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
    [onSelect, stick],
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
        // `up` here means "the TOP port", derived from the port being held — not
        // from the node's kind. An MCP node only has a top port, so the two agree
        // there; an employee has two ports, so they DIFFER, and that is the case
        // the user caught.
        const gUp = l.top;
        ghostRef.current?.setAttribute('d', curve(anchor({ kind: from.kind, ...pf }, 'out', gUp), w, gUp));

        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const host = over?.closest<SVGGElement>('[data-node]');
        const id = host?.dataset['node'] ?? null;
        const to = id ? canvas.nodes.find((n) => n.id === id) : undefined;
        // Accept the reverse direction too: dragging from an employee onto an arm
        // still lights up, because `mcp → agent` is the legal edge. The real
        // direction is straightened out on drop.
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
        return;
      }

      /**
       * 🔴 THE LIT WIRE'S REACH — the user's proposal, and the point of it is
       * the second half. → SPEC-office-animation.md §17j‴
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ *"Widen the wire's select region while it IS selected — but leave it  │
       * │ as it is when it is not, so picking one by accident stays hard."*     │
       * │                                                                       │
       * │ So the 16-unit hit path is untouched: it is still the only way to     │
       * │ CHOOSE a wire, and it still lives under the nodes. What widens is the │
       * │ region that KEEPS a chosen wire, and it widens as a DISTANCE rather   │
       * │ than as a bigger transparent stroke.                                  │
       * │                                                                       │
       * │ ⚠ THAT DIFFERENCE IS THE WHOLE DESIGN. A 96-unit band laid over the   │
       * │ diagram would own every pixel it covers, so the nodes the wire runs   │
       * │ THROUGH would go dead exactly while the user is looking at that wire  │
       * │ — and clicking a node is the escape from the latch, so it would eat   │
       * │ its own way out. A comparison steals nothing from anybody.            │
       * │                                                                       │
       * │ ⚠ Only when nothing else is happening. A drag, a link and a pan each  │
       * │ returned above, so by here the pointer is doing nothing but moving.   │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const key = lit.current;
      if (!key) return;
      const ends = endsOf(key);
      if (!ends) return;
      const w = screenToWorld(ev, rect, viewRef.current);
      if (nearWire(ends.a, ends.b, ends.up, w)) {
        // ⚠ Cancel the pending cool, do NOT repaint. The wire is already lit —
        // `lit.current` is where `key` came from — so `hot()` here would rewrite
        // the same classes on every edge on every pointer move to change nothing.
        if (coolTimer.current) {
          clearTimeout(coolTimer.current);
          coolTimer.current = 0;
        }
      } else if (key !== stuck.current && !coolTimer.current) {
        cool();
      }
    },
    [canvas.nodes, paintNode, paintEdges, applyView, endsOf, cool],
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
          // A click, not a drag. A store node opens the drawer directly and is
          // NOT selected — selecting it would also open an empty inspector panel
          // on the right.
          const kind = canvas.nodes.find((n) => n.id === d.id)?.kind;
          if (kind === 'knowledge' || kind === 'library') onOpenStore(kind);
          else onSelect(d.id);
        }
      }

      const l = link.current;
      if (l) {
        if (l.target) {
          nodeEls.current.get(l.target)?.classList.remove('is-droptarget');
          // A backwards drag gets FLIPPED, not refused: `mcp → agent` is the only
          // legal direction, so dragging from an employee to an arm still lands
          // on exactly that edge.
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

  // `passive: false` is required for preventDefault to stop the browser's zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const cutEdge = useCallback(
    (e: CanvasEdge) => {
      edgesRef.current = edgesRef.current.filter((x) => !(x.from === e.from && x.to === e.to));
      // ⚠ The latch has to go with the wire. Left pointing at a key nothing owns
      // any more, the next `cool()` would repaint a hot state onto an edge that
      // was deleted — and `bindEdge` would have dropped its elements by then, so
      // the failure is silent rather than visible.
      stick(null);
      commit(true);
    },
    [commit, stick],
  );

  /**
   * 🔴 DELETE CUTS THE CHOSEN WIRE — the door that involves NO JOURNEY. → §17j″
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE BUTTON IS AT THE WIRE'S MIDPOINT, AND THAT IS THE PROBLEM.           │
   * │                                                                          │
   * │ On a real diagram the midpoint is routinely on top of a third node, so   │
   * │ reaching it means dragging the pointer across other things — and the     │
   * │ user reported the same difficulty twice, in two rounds: once after the   │
   * │ button was lifted above the nodes, again after the whole wire was lit.   │
   * │ Both fixes were right and neither removed the JOURNEY.                   │
   * │                                                                          │
   * │ ⇒ Point at the wire and press Delete. The mouse never has to leave it.   │
   * │ Clicking first LATCHES the edge so the pointer is free to go anywhere    │
   * │ before pressing the key; the button stays for people who prefer it, and  │
   * │ Escape lets go.                                                          │
   * │                                                                          │
   * │ ⚠ NOT WHILE SOMEBODY IS TYPING. This listens on `window`, and the chat   │
   * │ box, the rename field and every inspector input share that window —      │
   * │ Backspace in a text field must delete a character, not a connection.     │
   * │                                                                          │
   * │ ⚠ IT IS DECLARED BELOW `cutEdge` AND MUST STAY THERE. The dependency     │
   * │ array is evaluated during render; a `const` does not hoist, so an effect │
   * │ written above it throws before the canvas ever paints. This file's own   │
   * │ store learned that the expensive way on 07/09 (`store.ts §LOCALE_KEY`).  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        stick(null);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const key = lit.current;
      if (!key || typing()) return;
      const edge = edgesRef.current.find((x) => edgeKey(x) === key);
      if (!edge) return;
      // ⚠ Backspace is "go back" in a browser when nothing has claimed it.
      e.preventDefault();
      cutEdge(edge);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stick, cutEdge]);

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
            // An arm PUSHES UP, the assistant HANDS DOWN — two relationships
            // running in opposite directions must land on different ports.
            // → `geometry.ts §anchor`
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
                {/* ⚠ THE HIT PATH STAYS DOWN HERE, UNDER THE NODES, and only the
                    button moves up. A 16-unit transparent stroke lifted above the
                    nodes would steal every click where a wire crosses a box — the
                    wire runs THROUGH the employee it points at, so that is not a
                    corner case, it is every edge. → SPEC-office-animation §17j */}
                <path
                  className="wire-hit"
                  d={d}
                  ref={(el) => bindEdge(edgeEls, edgeKey(e), 'hit', el)}
                  onPointerEnter={() => hot(edgeKey(e))}
                  onPointerLeave={cool}
                  /* ⚠ `stopPropagation`, or the svg's own handler reads this as
                     a click on the background: it would start a pan and clear
                     the node selection on the way to latching the wire. */
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    stick(edgeKey(e));
                  }}
                />
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
                /*
                  `is-keydead` — a service refused a credential this arm runs
                  on, so the office is NOT fully green until someone signs in
                  again. Its own class rather than reusing `is-error`: that one
                  is live task state and clears itself, while this one only
                  clears when a person acts. The server decides it from a fact
                  it wrote down, never from a guess. → `office.ts §keyDeadOf`

                  ⚠ `keyGone` shares the class, and only the class: the arm
                  cannot run and a person has to act, which is the same red.
                  What differs is the SENTENCE, and that lives in the subtitle
                  — one colour, two instructions. → `office.ts §keyGoneOf`
                */
                className={`node node-${n.kind}${n.missing ? ' is-missing' : ''}${
                  n.keyDead || n.keyGone ? ' is-keydead' : ''
                }${n.kind === 'agent' && !n.connected ? ' is-off' : ''}`}
                data-node={n.id}
                transform={`translate(${n.x},${n.y})`}
                ref={(el) => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                // No `onDoubleClick` any more: one click already opens the
                // drawer, and `showPanel` does not toggle, so a double click just
                // opens it twice. The previous version used `openPanel` (which
                // toggles), so a double click opened and immediately closed it —
                // indistinguishable from "the click did nothing".
                //
                // Files drop STRAIGHT onto the node. `preventDefault` on
                // `dragOver` is required — without it the browser treats the drop
                // as refused and opens the file in the tab, taking the whole page
                // with it.
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
                  │ A PORT MUST SIT WHERE THE WIRE ACTUALLY LEAVES/ARRIVES.  │
                  │                                                          │
                  │   assistant  bottom → hands work down                    │
                  │   employee   top    ← receives work · BOTTOM ← takes arm │
                  │   arm        TOP    → pushes capability up               │
                  │                                                          │
                  │ The previous version gave MCP a port at the BOTTOM while │
                  │ the wire had already been moved to leave from the top    │
                  │ (§anchor) — the circle in one place, the wire growing    │
                  │ out of another. And an employee had ONE port for TWO     │
                  │ relationships running in opposite directions.            │
                  └──────────────────────────────────────────────────────────┘
                */}
                {/*
                  ⚠ `data-side` is THE TRUTH ABOUT POSITION, not a name.

                  The previous version inferred direction from the port's name
                  (`'in'` ⇒ top). An MCP node has a port named `out` that SITS AT
                  THE TOP, so the ghost wire grew from the bottom while the finger
                  was on the top. Taking the name for the position — the same
                  mistake as `pitch` vs `tools`, one layer down in pixels.
                */}
                {/*
                  ┌──────────────────────────────────────────────────────────┐
                  │ PORT COUNT = NUMBER OF RELATIONSHIPS TOUCHING THAT NODE. │
                  │ (settled 23/08)                                          │
                  │                                                          │
                  │   assistant  only SENDS         → 1 port, at the BOTTOM  │
                  │   arm        only SENDS         → 1 port, at the TOP     │
                  │   employee   RECEIVES from both → 2 ports                │
                  │                                                          │
                  │ The assistant used to carry an extra top port, from when │
                  │ `mcp → assistant` was still legal. That edge is gone (it │
                  │ did nothing, and had it really run it would have cost    │
                  │ ~36,000 tokens a turn), so the port left behind was an   │
                  │ inbound socket THAT COULD RECEIVE NOTHING — an invitation│
                  │ to drag a wire that can never land.                      │
                  │                                                          │
                  │ Same rule as the one just applied to that wire: do not   │
                  │ display a path that leads nowhere.                       │
                  └──────────────────────────────────────────────────────────┘
                */}
                {n.kind === 'agent' && (
                  <g data-port="in" data-side="top">
                    <circle className="port-hit" cx={s.w / 2} cy={0} r={13} />
                    <circle className="port" cx={s.w / 2} cy={0} r={5.5} />
                  </g>
                )}
                {n.kind === 'agent' && (
                  <g data-port="arm" data-side="bottom">
                    <circle className="port-hit" cx={s.w / 2} cy={s.h} r={13} />
                    <circle className="port" cx={s.w / 2} cy={s.h} r={5.5} />
                  </g>
                )}
                {n.kind === 'assistant' && (
                  <g data-port="out" data-side="bottom">
                    <circle className="port-hit" cx={s.w / 2} cy={s.h} r={13} />
                    <circle className="port" cx={s.w / 2} cy={s.h} r={5.5} />
                  </g>
                )}
                {n.kind === 'mcp' && (
                  <g data-port="out" data-side="top">
                    <circle className="port-hit" cx={s.w / 2} cy={0} r={13} />
                    <circle className="port" cx={s.w / 2} cy={0} r={5.5} />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/*
          ┌──────────────────────────────────────────────────────────────────────┐
          │ 🔴 THE DELETE BUTTONS LIVE ABOVE THE NODES. → SPEC-office-animation  │
          │ §17j                                                                 │
          │                                                                      │
          │ SVG has no `z-index`. It paints in DOCUMENT ORDER and nothing else,  │
          │ so a button that has to beat a node has to be written after the      │
          │ nodes — there is no CSS that lifts it, and `will-change` / a         │
          │ stacking context do not reorder SVG children.                        │
          │                                                                      │
          │ ⚠ Before this, a wire's ✕ sat under every node it passed behind.     │
          │ The user's account of it is the whole bug report: *"I have to drag   │
          │ the nodes apart to find a moment when the ✕ appears."* A door you    │
          │ have to rearrange the room to reach is a door that does not work.    │
          │                                                                      │
          │ ⚠ ONE GROUP FOR ALL OF THEM, positioned by `paintEdges` through the  │
          │ same `edgeEls` ref map as before. The button did not change owner —  │
          │ only where it is written.                                            │
          └──────────────────────────────────────────────────────────────────────┘
        */}
        {/*
          ┌──────────────────────────────────────────────────────────────────────┐
          │ 🔴 …AND SO DOES THE WIRE ITSELF, WHEN IT IS THE CHOSEN ONE. → §17j′  │
          │                                                                      │
          │ §17j promised *"a hovered edge lifts above every other edge and      │
          │ every node"*. Only the BUTTON was lifted, and the user read the      │
          │ difference straight off the screen: *"it lights up the bin but not   │
          │ the whole wire."* Recolouring a line that runs behind three boxes    │
          │ shows three orange fragments — which is not an answer to *which      │
          │ connection am I about to delete*.                                    │
          │                                                                      │
          │ ⚠ A SECOND DRAWING OF THE SAME CURVE, not a moved one. The wire has  │
          │ to stay under the nodes in its ordinary state — that is the whole    │
          │ depth story of the diagram — so the lifted copy is drawn here and    │
          │ shown only while the edge is hot. `paintEdges` gives both the same   │
          │ `d` in the same pass, from one variable.                             │
          │                                                                      │
          │ ⚠ `pointer-events: none` (in the stylesheet). It crosses every node  │
          │ the wire crosses; a hit-taking copy up here would swallow the click  │
          │ that opens them — the exact trap the hit path is kept downstairs to  │
          │ avoid.                                                               │
          └──────────────────────────────────────────────────────────────────────┘
        */}
        <g className="edge-tools">
          {canvas.edges.map((e) => {
            const from = nodeById.get(e.from);
            const to = nodeById.get(e.to);
            if (!from || !to) return null;
            const up = from.kind === 'mcp';
            const a = anchor(from, 'out', up);
            const b = anchor(to, 'in', up);
            return (
              <Fragment key={edgeKey(e)}>
                <path
                  className="wire-halo"
                  d={curve(a, b, up)}
                  ref={(el) => bindEdge(edgeEls, edgeKey(e), 'halo', el)}
                />
                <g
                  className="cut"
                  transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`}
                  ref={(el) => bindEdge(edgeEls, edgeKey(e), 'cut', el)}
                  /* The button is in a different group from the wire it belongs to,
                     so moving the pointer from one to the other fires `leave` on the
                     first. Both ends claim the hover; `cool` is what resolves it. */
                  onPointerEnter={() => hot(edgeKey(e))}
                  onPointerLeave={cool}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    cutEdge(e);
                  }}
                  role="button"
                  aria-label={t('canvas.cutEdge')}
                >
                  <circle r={11} />
                  {/* The same `Trash2` the Inspector, the Results panel and the
                      Documents panel all delete with. A ✕ means *close*; this
                      removes a relationship, and the two should not look alike. */}
                  <Trash2 x={-7} y={-7} width={14} height={14} strokeWidth={2} />
                </g>
              </Fragment>
            );
          })}
        </g>

        <path ref={ghostRef} className="ghost" />
      </g>
    </svg>
  );
});

/**
 * ⚠ ONE SLOT AT A TIME, AND AN ENTRY DIES ONLY WHEN IT IS EMPTY.
 *
 * It used to `map.delete(key)` the moment ANY slot detached. That was survivable
 * while all three elements were siblings inside one `<g>` — they always mounted
 * and unmounted together. The delete button and the lifted highlight now live in
 * a different group (§`.edge-tools`), so "one slot detached" and "this edge is
 * gone" stopped being the same event, and the old version would have thrown the
 * wire away every time either of them re-bound.
 */
/**
 * How long a hover PREVIEW survives after the pointer leaves the wire. → §17j″
 *
 * ⚠ 320, up from 90, and it is a real measurement of a real gesture rather than
 * a nicer-looking number: the pointer going from a wire to that wire's own
 * button crosses whatever the diagram has put in between, and on this canvas
 * that is usually a node. 90 ms is not long enough to cross one.
 *
 * ⚠ It is a BACKSTOP, not the fix. A pointer can dwell over that node for as
 * long as it likes, so a preview that expires can always be outlasted — the
 * answer to that is the latch, and this only makes the common case work without
 * anybody having to learn about it.
 */
const COOL_MS = 320;

/**
 * Is a text field focused? The Delete/Backspace shortcut must not fire then.
 *
 * ⚠ `isContentEditable` as well as the two tag names: a rich-text field is a
 * `<div>`, and forgetting it is how a shortcut eats somebody's typing in the one
 * input that did not look like an input.
 */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

interface EdgeEls {
  wire?: SVGPathElement;
  hit?: SVGPathElement;
  cut?: SVGGElement;
  /** The lifted copy drawn above the nodes while this edge is hot. → §17j′ */
  halo?: SVGPathElement;
}

function bindEdge(
  store: React.RefObject<Map<string, EdgeEls>>,
  key: string,
  slot: 'wire' | 'hit' | 'cut' | 'halo',
  el: SVGPathElement | SVGGElement | null,
): void {
  const map = store.current;
  const cur = map.get(key);
  if (!el) {
    if (!cur) return;
    delete cur[slot];
    if (!cur.wire && !cur.hit && !cur.cut && !cur.halo) map.delete(key);
    return;
  }
  const next = cur ?? {};
  // @ts-expect-error — three slots, three element types; assigning by slot name is right.
  next[slot] = el;
  map.set(key, next);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `say` IS TRUNCATED BY MEASUREMENT, NOT BY CHARACTER COUNT. (overflow      │
 * │ reported by the user 24/08)                                               │
 * │                                                                           │
 * │ Before: `trim(st.say, 30)`. An `agent` node is **168px** wide (shrunk on  │
 * │ 23/08), `.node-say` starts at `x=16`, font 12px ⇒ ~142px of room, about   │
 * │ **22–23 characters**. 30 characters ≈ 186px ⇒ the text spills out of the  │
 * │ rectangle.                                                                │
 * │                                                                           │
 * │ And it got worse on 22/08, when `describeCall` stopped saying "running a  │
 * │ command" and started printing the command itself (up to 60 characters) —  │
 * │ then on 24/08 it added the arm's name too.                                │
 * │                                                                           │
 * │ This is EXACTLY the trap the "COORDINATES ANCHORED TO THE BOTTOM" note in │
 * │ `NodeShape.tsx` warned about, on the other axis: a legitimate constant    │
 * │ (`NODE_SIZE`) changed in ANOTHER FILE, and the number here went unedited. │
 * │ That note anchors `y` to `s.h`; this line is the other half — anchoring   │
 * │ WIDTH to the real width.                                                  │
 * │                                                                           │
 * │ Why NOT change 30 to 22: 22 is a GUESS as well. Vietnamese carries        │
 * │ diacritics, `iiii` and `MMMM` differ in width by a factor of two, and the │
 * │ day somebody adjusts `NODE_SIZE` again the bug returns unchanged and just │
 * │ as silent. `getComputedTextLength()` asks the browser about what it just  │
 * │ drew.                                                                     │
 * │                                                                           │
 * │ Why NOT widen the node: +16px × 4 nodes per row = +64px across, in        │
 * │ exchange for ~2 characters. The node was deliberately shrunk because the  │
 * │ diagram runs out of room fast.                                            │
 * │                                                                           │
 * │ NOTHING IS LOST: the full sentence already exists in two other places —   │
 * │ the log panel (`PlansPanel`, verbatim) and the activity line above the    │
 * │ chat box. The diagram is for GLANCING at, not for reading. `<title>`      │
 * │ hands back the rest on hover through SVG's own mechanism: 0 state, 0      │
 * │ renders, 0 libraries.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Write `textContent` FIRST, then measure — `getComputedTextLength` reads what
 * is on screen, not the string we are about to write. Two characters come off per
 * iteration so a long sentence does not become hundreds of measurements.
 */
const SAY_PAD = 26; // `.node-say`'s x=16 + 10px of right-hand margin

function fitSay(el: SVGTextElement, full: string): void {
  // Assigning `textContent` wipes every child, including the previous turn's
  // `<title>` — so the empty branch has nothing left to clean up.
  el.textContent = full;
  if (!full) return;

  const room = sizeOf('agent').w - SAY_PAD;
  // A rough cut to 60 BEFORE measuring: `describeCall` can return a long command,
  // and measure-then-trim-two from 200 characters is 70 forced layouts for one
  // line of text.
  let cut = trim(full, 60);
  el.textContent = cut;
  // A loop ceiling: `getComputedTextLength()` returns 0 while the node is hidden
  // (background tab, `display:none`) — without the ceiling this is a while loop
  // with no way out.
  let guard = 40;
  while (guard-- > 0 && cut.length > 1 && el.getComputedTextLength() > room) {
    cut = cut.slice(0, -2);
    el.textContent = `${cut}…`;
  }

  const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  tip.textContent = full;
  el.appendChild(tip);
}
