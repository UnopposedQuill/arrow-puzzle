// Renders a figure as a rotatable 3D solid with CSS transforms.
//
// Each face is a flat div placed by a matrix3d built straight from its frame
// in packages/shared (u, v, normal are CSS-oriented already), at its position
// in the figure. The whole solid carries one rotation matrix; dragging rotates
// it about the screen axes, so a horizontal drag always spins left/right
// however the figure is tilted.
//
// The faces are see-through, so arrows on the far side stay visible and the
// player can keep track of what is left. Far-side arrows are dimmed and can't
// be tapped. Arrows are drawn by arrowGeometry.ts, face by face; a move is
// animated by sliding the arrow along the path traceMove() reports.
//
// Zoom: mouse wheel, or a two-finger pinch. It scales the figure, not the
// perspective, so the solid keeps its shape.
//
// Taps are resolved here, not by the browser: Chrome's hit testing of SVG
// inside perspective 3D transforms misses often on slanted faces. A tap is
// traced from the eye through the screen point onto the nearest face turned
// toward the viewer, and whichever arrow occupies that cell is tapped -- so the
// whole cell is the target, not just the thin drawn line.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cellKey, sideSegments, turnDir, DIR_DELTAS, type Arrow, type BlockedArrows, type Cell, type Dir, type Face, type Figure, type Trace, type Vec3 } from '@arrow-puzzle/shared';
import { arrowPieces, moveTrack, restingTrack, type Piece } from './arrowGeometry';
import { EDGE_STYLES } from './edgeStyles';

// Row-major 3x3 rotation matrices.
type Mat3 = number[];

const rotX = (a: number): Mat3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a: number): Mat3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const multiply = (a: Mat3, b: Mat3): Mat3 =>
  [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
const rotate = (m: Mat3, p: Vec3): Vec3 => [0, 1, 2].map(r => m[r * 3] * p[0] + m[r * 3 + 1] * p[1] + m[r * 3 + 2] * p[2]) as Vec3;
// The inverse of a rotation is its transpose.
const unrotate = (m: Mat3, p: Vec3): Vec3 => [0, 1, 2].map(c => m[c] * p[0] + m[3 + c] * p[1] + m[6 + c] * p[2]) as Vec3;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// matrix3d() is column-major.
const rotationCss = (m: Mat3) =>
  `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,0,0,0,1)`;

const unit = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

// A face's div is a square; this maps it onto the face: its x axis along u,
// its y axis along v (not necessarily square to u -- rhombi), facing out.
const faceCss = ({ u, v, normal: n }: Face, [x, y, z]: Vec3) =>
  `matrix3d(${unit(u).join(',')},0,${unit(v).join(',')},0,${n.join(',')},0,${x},${y},${z},1)`;

// Front, right and top in view, so the figure reads as a solid from the start
// (and the notched cube's notch is in sight).
const INITIAL_ROTATION = multiply(rotX(-0.45), rotY(-0.6));
// Perspective distance, in figure extents (its bounding box's largest side).
const PERSPECTIVE = 6;
// Share of the board area the starting view fills, leaving a small margin.
const FIT = 0.94;

// Room a figure's starting view needs, in figure extents: its face corners
// rotated and projected with the CSS perspective. The starting size fits this
// snugly; other rotations may clip a little at the stage's edges, which zoom
// covers.
function startingSilhouette(figure: Figure) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { origin, u, v } of figure.faces) {
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const corner = [0, 1, 2].map(k => (origin[k] + a * u[k] + b * v[k] - figure.center[k]) / figure.extent) as Vec3;
      const [rx, ry, rz] = rotate(INITIAL_ROTATION, corner);
      const k = PERSPECTIVE / (PERSPECTIVE - rz);
      xs.push(rx * k);
      ys.push(ry * k);
    }
  }
  // The figure is centred on the stage but its silhouette is not centred on
  // the figure, so fit twice its furthest reach from the centre each way.
  const reach = (vs: number[]) => 2 * Math.max(...vs.map(Math.abs));
  return { width: reach(xs), height: reach(ys) };
}

const DRAG_SPEED = 0.01; // radians per pixel
const TAP_SLOP = 6; // pixels a pointer may wander before a press becomes a drag
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const WHEEL_ZOOM_SPEED = 0.0015; // per wheel delta unit, exponential
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// Arrows are black; a blocked attempt flashes them red (see .arrow-bump in
// App.css). Arrows on faces turned away from the viewer are dimmed.
const ARROW_COLOR = '#111';
const BLOCKED_COLOR = '#e74c3c';
const FAR_SIDE_OPACITY = 0.3;

// Slides run at SLIDE_SPEED cells per second, kept within these durations so
// short hops stay visible and long ones don't hold the eye too long.
const SLIDE_SPEED = 30;
const SLIDE_MIN_MS = 180;
const SLIDE_MAX_MS = 900;

export interface SlideAnimation {
  key: number;
  trace: Trace;
  rule: BlockedArrows;
  start: number; // performance.now()
}

// How far along its track an animated arrow is at `elapsed` ms, and how to
// draw it then.
function slideFrame({ trace, rule }: SlideAnimation, elapsed: number) {
  const steps = trace.path.length;
  const length = trace.arrow.cells.length;
  // Exits travel until the tail has passed the edge; a blocked arrow under
  // 'return' goes to its blocker and back.
  const distance = trace.exited ? steps + length + 1 : rule === 'return' ? 2 * steps : steps;
  const duration = Math.min(SLIDE_MAX_MS, Math.max(SLIDE_MIN_MS, (distance / SLIDE_SPEED) * 1000));
  const p = Math.min(1, Math.max(0, elapsed / duration));
  const returning = !trace.exited && rule === 'return';
  const offset = returning ? steps * (p < 0.5 ? 2 * p : 2 - 2 * p) : p * (trace.exited ? distance : steps);
  return {
    done: p >= 1,
    offset,
    // Turns red once it has hit its blocker and is on the way back.
    red: returning && p >= 0.5,
    // Fades as it leaves the figure.
    opacity: trace.exited ? Math.max(0, Math.min(1, 1 - (offset - steps) / (length + 1))) : 1,
  };
}

// Where a face sits: its centre, in px from the figure's centre, and its side.
function facePlacement(figure: Figure, face: Face, cellPx: number) {
  const centre = [0, 1, 2].map(k =>
    (face.origin[k] + (face.u[k] + face.v[k]) / 2 - figure.center[k]) * cellPx) as Vec3;
  return { centre, side: figure.size * cellPx };
}

// Whether the viewer sees the outer side of a face: the eye, at z = perspective
// on the centre line, lies in front of the face's plane. With perspective this
// is stricter than "the normal points toward the screen". Drawing and
// pickCell() share this test, so every arrow drawn as tappable is.
function facesViewer(rotation: Mat3, face: Face, centre: Vec3, perspective: number) {
  return dot(sub([0, 0, perspective], rotate(rotation, centre)), rotate(rotation, face.normal)) > 0;
}

// The cell under screen offset (sx, sy) from the stage centre: the nearest hit
// on a face turned toward the viewer. Mirrors the CSS: `perspective` puts the
// eye at z = perspective on the centre line and the solid is rotated about the
// stage centre. With a notch, faces can stand in front of each other, hence
// nearest.
function pickCell(
  figure: Figure, rotation: Mat3, cellPx: number, perspective: number, sx: number, sy: number,
): Cell | null {
  const eye: Vec3 = [0, 0, perspective];
  const ray: Vec3 = [sx, sy, -perspective];
  let best: { t: number; cell: Cell } | null = null;
  figure.faces.forEach((face, f) => {
    const { centre, side } = facePlacement(figure, face, cellPx);
    if (!facesViewer(rotation, face, centre, perspective)) return;
    const normal = rotate(rotation, face.normal);
    const facing = dot(ray, normal);
    if (facing >= 0) return;
    const t = dot(normal, sub(rotate(rotation, centre), eye)) / facing;
    if (best && t >= best.t) return;
    const local = sub(unrotate(rotation, [eye[0] + t * ray[0], eye[1] + t * ray[1], eye[2] + t * ray[2]]), centre);
    // The hit as a * u^ + b * v^. On a rhombus u and v aren't square to each
    // other, so solve with their overlap g rather than project.
    const [u, v] = [unit(face.u), unit(face.v)];
    const g = dot(u, v);
    const [lu, lv] = [dot(local, u), dot(local, v)];
    const a = (lu - g * lv) / (1 - g * g);
    const b = (lv - g * lu) / (1 - g * g);
    const col = Math.floor((a + side / 2) / cellPx);
    const row = Math.floor((b + side / 2) / cellPx);
    if (row >= 0 && row < figure.size && col >= 0 && col < figure.size) best = { t, cell: { face: f, row, col } };
  });
  return (best as { t: number; cell: Cell } | null)?.cell ?? null;
}

// One arrow's part on one face.
function PieceView({ id, piece, bumped, color, opacity }: {
  id: number;
  piece: Piece;
  bumped: boolean;
  color: string;
  opacity: number;
}) {
  const head = piece.head;
  const [dx, dy] = head ? head.d : [0, 0];
  return (
    <g
      data-arrow-id={id}
      className={bumped ? 'arrow-bump' : undefined}
      // Nudge distance for the bump keyframes, in viewBox units (one cell = 1).
      style={{
        ...({ '--arrow-color': color, '--bump-x': `${dx * 0.2}px`, '--bump-y': `${dy * 0.2}px` } as CSSProperties),
        color: 'var(--arrow-color)',
        opacity,
      }}
    >
      {piece.strokes.map((points, i) => (
        <polyline
          key={i}
          points={points.map(p => p.join(',')).join(' ')}
          fill="none" stroke="currentColor" strokeWidth={0.18} strokeLinecap="round" strokeLinejoin="round"
        />
      ))}
      {head && (
        <polygon
          points={[
            [head.at[0] + dx * 0.42, head.at[1] + dy * 0.42],
            [head.at[0] + dx * 0.05 - dy * 0.25, head.at[1] + dy * 0.05 + dx * 0.25],
            [head.at[0] + dx * 0.05 + dy * 0.25, head.at[1] + dy * 0.05 - dx * 0.25],
          ].map(p => p.join(',')).join(' ')}
          fill="currentColor"
        />
      )}
    </g>
  );
}

// A face's sides as lines in cell units, indexed by Dir.
const SIDE_LINES = (n: number) => [[0, 0, n, 0], [n, 0, n, n], [0, n, n, n], [0, 0, 0, n]];

// The segments along one side of a face, each styled by its type: turn
// segments get chevrons pointing the way heads turn, and every split between
// segments gets a tick, so a split between two segments of the same type still
// shows.
function EdgeLine({ figure, face, side }: { figure: Figure; face: number; side: Dir }) {
  const n = figure.size;
  const segments = sideSegments(figure, face, side);
  if (segments.length === 0) return null;
  const [x1, y1] = SIDE_LINES(n)[side];
  const horizontal = side % 2 === 0;
  // Into the face, away from the side.
  const [iy, ix] = DIR_DELTAS[((side + 2) % 4) as Dir];
  // Point at `k` cells along the side, `inset` cells into the face.
  const at = (k: number, inset = 0): [number, number] =>
    horizontal ? [k, y1 + iy * inset] : [x1 + ix * inset, k];
  return (
    <g>
      {segments.map(({ segment, from, to }) => {
        const style = EDGE_STYLES[segment.type];
        const [ax, ay] = at(from);
        const [bx, by] = at(to);
        let chevrons = null;
        if (segment.type === 'turn') {
          const [dy, dx] = DIR_DELTAS[turnDir(figure, segment, face, side)];
          chevrons = Array.from({ length: Math.max(1, Math.floor((to - from) / 2)) }, (_, i) => {
            const [px, py] = at(from + (to - from) * (i + 0.5) / Math.max(1, Math.floor((to - from) / 2)), 0.35);
            const points = [[px - dx * 0.15 + dy * 0.2, py - dy * 0.15 + dx * 0.2], [px + dx * 0.15, py + dy * 0.15], [px - dx * 0.15 - dy * 0.2, py - dy * 0.15 - dx * 0.2]];
            return <polyline key={i} points={points.map(p => p.join(',')).join(' ')} fill="none" stroke={style.color} strokeWidth={0.1} strokeLinecap="round" strokeLinejoin="round" />;
          });
        }
        return (
          <g key={from}>
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={style.color} strokeWidth={style.width} vectorEffect="non-scaling-stroke" />
            {chevrons}
          </g>
        );
      })}
      {segments.slice(1).map(({ from }) => {
        const [ax, ay] = at(from);
        const [bx, by] = at(from, 0.3);
        return <line key={`tick-${from}`} x1={ax} y1={ay} x2={bx} y2={by} stroke="rgba(255, 255, 255, 0.9)" strokeWidth={2} vectorEffect="non-scaling-stroke" />;
      })}
    </g>
  );
}

interface Drawn {
  key: string;
  id: number;
  piece: Piece;
  bumped: boolean;
  color: string;
  opacity: number;
  // Drawn past the face's bounds: an arrow leaving the figure from this face.
  unclipped: boolean;
}

export function Figure3D({ figure, arrows, bump, animations, onAnimationDone, onArrowTap }: {
  figure: Figure;
  arrows: Arrow[];
  // An arrow that just failed to move, shown with a short nudge forward and back.
  bump: { id: number; n: number } | null;
  animations: SlideAnimation[];
  onAnimationDone: (key: number) => void;
  onArrowTap: (id: number) => void;
}) {
  const [rotation, setRotation] = useState<Mat3>(INITIAL_ROTATION);
  const [zoom, setZoom] = useState(1);
  const [now, setNow] = useState(() => performance.now());
  const stageRef = useRef<HTMLDivElement>(null);
  // Pointers that went down on the stage, by id. One is a drag or a tap; two
  // are a pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  // The board area this component fills, measured; the figure's side at zoom
  // 1 is chosen so the starting view fits it.
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Size of the whole figure (its extent), in px, at zoom 1.
  const silhouette = useMemo(() => startingSilhouette(figure), [figure]);
  const faceSize = stage
    ? Math.max(1, FIT * Math.min(stage.width / silhouette.width, stage.height / silhouette.height))
    : 1;

  // Perspective follows the unzoomed size, so zooming scales the figure
  // without changing how strongly it recedes.
  const perspective = faceSize * PERSPECTIVE;
  const cellPx = (faceSize * zoom) / figure.extent;

  // The window listeners are registered once, so they read the latest render
  // through this ref.
  const latest = useRef({ figure, arrows, rotation, cellPx, zoom, perspective, onArrowTap });
  useEffect(() => { latest.current = { figure, arrows, rotation, cellPx, zoom, perspective, onArrowTap }; });

  // Frame loop while anything is sliding.
  const finished = useRef(new Set<number>());
  useEffect(() => {
    if (animations.length === 0) return;
    let frame = requestAnimationFrame(function tick(t) {
      setNow(t);
      for (const a of animations) {
        if (!finished.current.has(a.key) && slideFrame(a, t - a.start).done) {
          finished.current.add(a.key);
          onAnimationDone(a.key);
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [animations, onAnimationDone]);

  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  // Wheel zoom needs a non-passive listener to stop the page from zooming or
  // scrolling instead; React registers onWheel as passive.
  useEffect(() => {
    const el = stageRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => clampZoom(z * Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current) {
        if (pointers.current.size >= 2) {
          const p = pinch.current;
          setZoom(clampZoom(p.zoom * (pinchDistance() / p.distance)));
        }
        return;
      }
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      drag.current = { x: e.clientX, y: e.clientY, moved: true };
      // Slower when zoomed in, so the figure turns at the same pace under the finger.
      const speed = DRAG_SPEED / latest.current.zoom;
      setRotation(r => multiply(multiply(rotY(dx * speed), rotX(-dy * speed)), r));
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.delete(e.pointerId)) return;
      if (pinch.current) {
        // Back to one finger: it carries on rotating from where it is, and the
        // gesture can no longer end in a tap.
        if (pointers.current.size < 2) {
          pinch.current = null;
          const rest = [...pointers.current.values()][0];
          drag.current = rest ? { ...rest, moved: true } : null;
        }
        return;
      }
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved || !stageRef.current) return;
      const { figure, arrows, rotation, cellPx, perspective, onArrowTap } = latest.current;
      const box = stageRef.current.getBoundingClientRect();
      const cell = pickCell(
        figure, rotation, cellPx, perspective,
        e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2),
      );
      if (!cell) return;
      const key = cellKey(cell);
      const arrow = arrows.find(a => a.cells.some(c => cellKey(c) === key));
      if (arrow) onArrowTap(arrow.id);
    };
    const cancel = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      drag.current = null;
      if (pointers.current.size < 2) pinch.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  // Resting arrows' geometry only changes with the board, not with rotation
  // or zoom.
  const resting = useMemo(
    () => arrows.map(a => ({ id: a.id, pieces: arrowPieces(figure, restingTrack(figure, a), a.cells.length, 0) })),
    [figure, arrows],
  );
  const tracks = useMemo(
    () => new Map(animations.map(a => [a.key, moveTrack(figure, a.trace)])),
    [figure, animations],
  );

  // Everything to draw, by face.
  const byFace = new Map<number, Drawn[]>();
  const put = (face: number, d: Drawn) => {
    if (!byFace.has(face)) byFace.set(face, []);
    byFace.get(face)!.push(d);
  };
  // Slides still under way at this frame; a finished one shows its arrow at
  // rest again (or nothing, if it left the figure) until App drops it.
  const sliding = animations
    .map(a => ({ a, frame: slideFrame(a, now - a.start) }))
    .filter(({ frame }) => !frame.done);
  const animating = new Set(sliding.map(({ a }) => a.trace.arrow.id));
  for (const { id, pieces } of resting) {
    if (animating.has(id)) continue;
    for (const [face, piece] of pieces) {
      // Remounting on each new bump restarts its animation.
      const bumped = bump?.id === id;
      put(face, { key: bumped ? `${id}-${bump.n}` : `${id}`, id, piece, bumped, color: ARROW_COLOR, opacity: 1, unclipped: false });
    }
  }
  for (const { a, frame } of sliding) {
    const track = tracks.get(a.key)!;
    const exitFace = a.trace.exited ? track[track.length - 1].cell.face : -1;
    for (const [face, piece] of arrowPieces(figure, track, a.trace.arrow.cells.length, frame.offset)) {
      put(face, {
        key: `slide-${a.key}`, id: a.trace.arrow.id, piece, bumped: false,
        color: frame.red ? BLOCKED_COLOR : ARROW_COLOR, opacity: frame.opacity, unclipped: face === exitFace,
      });
    }
  }

  const n = figure.size;

  return (
    <div
      ref={stageRef}
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 1) {
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
        } else if (pointers.current.size === 2) {
          // A second finger turns the gesture into a pinch: no tap, no rotation.
          drag.current = null;
          pinch.current = { distance: pinchDistance(), zoom: latest.current.zoom };
        }
      }}
      // The stage fills the board area, so a zoomed-in figure can be dragged
      // and tapped anywhere it shows; it is clipped at the area's edges.
      style={{
        position: 'relative', flex: '1 1 auto', alignSelf: 'stretch', minHeight: 0, overflow: 'hidden',
        perspective: `${perspective}px`, cursor: 'grab', touchAction: 'none',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: rotationCss(rotation) }}>
        {figure.faces.map((face, f) => {
          const { centre, side } = facePlacement(figure, face, cellPx);
          const near = facesViewer(rotation, face, centre, perspective);
          const drawn = byFace.get(f) ?? [];
          const view = (d: Drawn) => (
            <PieceView key={d.key} id={d.id} piece={d.piece} bumped={d.bumped} color={d.color} opacity={d.opacity} />
          );
          return (
            <div
              key={f}
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: side, height: side, marginLeft: -side / 2, marginTop: -side / 2,
                transform: faceCss(face, centre),
                // Translucent glass, light enough for black arrows to read. No
                // grid lines: arrow positions have to be read from the arrows
                // themselves. No CSS border either: edges are drawn in the svg
                // below, under the arrows.
                background: 'rgba(236, 240, 241, 0.55)',
                // Taps are resolved by pickCell(); every press lands on the stage.
                pointerEvents: 'none',
              }}
            >
              <svg viewBox={`0 0 ${n} ${n}`} width={side} height={side} style={{ display: 'block', overflow: 'visible' }}>
                <defs>
                  <clipPath id={`face-clip-${f}`}>
                    <rect x={0} y={0} width={n} height={n} />
                  </clipPath>
                </defs>
                {([0, 1, 2, 3] as Dir[]).map(side => <EdgeLine key={side} figure={figure} face={f} side={side} />)}
                <g style={{ opacity: near ? 1 : FAR_SIDE_OPACITY }}>
                  <g clipPath={`url(#face-clip-${f})`}>{drawn.filter(d => !d.unclipped).map(view)}</g>
                  {drawn.filter(d => d.unclipped).map(view)}
                </g>
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}
