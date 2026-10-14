// Renders a figure as a rotatable 3D solid with CSS transforms.
//
// Each face is a flat div placed by a matrix3d built straight from its frame
// in packages/shared (u, v, normal are CSS-oriented already). The whole solid
// carries one rotation matrix; dragging rotates it about the screen axes, so a
// horizontal drag always spins left/right however the figure is tilted.
//
// The faces are see-through, so arrows on the far side stay visible and the
// player can keep track of what is left. Far-side arrows are dimmed and can't
// be tapped. An arrow's body may run over an edge onto other faces; each face
// draws the part of it that lies there.
//
// Zoom: mouse wheel, or a two-finger pinch. It scales the figure, not the
// perspective, so the solid keeps its shape.
//
// Taps are resolved here, not by the browser: Chrome's hit testing of SVG
// inside perspective 3D transforms misses often on slanted faces. A tap is
// traced from the eye through the screen point onto the nearest face turned
// toward the viewer, and whichever arrow occupies that cell is tapped -- so the
// whole cell is the target, not just the thin drawn line.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DIR_DELTAS, DIRS, cellKey, neighbor, type Arrow, type Cell, type Face, type Figure, type Vec3 } from '@arrow-puzzle/shared';

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

// matrix3d() is column-major.
const rotationCss = (m: Mat3) =>
  `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,0,0,0,1)`;

const faceCss = ({ u, v, normal: n }: Face, half: number) =>
  `matrix3d(${u.join(',')},0,${v.join(',')},0,${n.join(',')},0,${n[0] * half},${n[1] * half},${n[2] * half},1)`;

// Front, right and top in view, so the figure reads as a solid from the start.
const INITIAL_ROTATION = multiply(rotX(-0.45), rotY(-0.6));
const DRAG_SPEED = 0.01; // radians per pixel
const TAP_SLOP = 6; // pixels a pointer may wander before a press becomes a drag
// Width of the outline drawn along each face's edges, in screen px. It is part
// of the face's drawing, *under* the arrows, so an arrow crossing an edge runs
// over it unbroken. Half of it lies outside the face and is clipped, so where
// two faces meet the edge shows the full width.
const EDGE_WIDTH = 2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const WHEEL_ZOOM_SPEED = 0.0015; // per wheel delta unit, exponential
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// Arrows are black; a blocked attempt flashes them red (see .arrow-bump in
// App.css). Arrows on faces turned away from the viewer are dimmed.
const ARROW_COLOR = '#111';
const FAR_SIDE_OPACITY = 0.3;

// Whether the viewer sees the outer side of a face: the eye, at z = perspective
// on the centre line, lies in front of the face's plane. With perspective this
// is stricter than "the normal points toward the screen" (z > 0): a face just
// past edge-on is seen from behind until z > size / 2 / perspective. Drawing
// and pickCell() share this test, so every arrow drawn as tappable is.
const facesViewer = (rotation: Mat3, { normal }: Face, size: number, perspective: number) =>
  rotate(rotation, normal)[2] * perspective > size / 2;

// The cell under screen offset (sx, sy) from the stage centre, on a face
// turned toward the viewer. Mirrors the CSS: `perspective` puts the eye at
// z = perspective on the centre line, the solid is rotated about the stage
// centre, and each face sits `faceSize / 2` out along its normal.
function pickCell(
  figure: Figure, rotation: Mat3, faceSize: number, perspective: number, sx: number, sy: number,
): Cell | null {
  const eye: Vec3 = [0, 0, perspective];
  const ray: Vec3 = [sx, sy, -perspective];
  const half = faceSize / 2;

  for (let f = 0; f < figure.faces.length; f++) {
    const face = figure.faces[f];
    const normal = rotate(rotation, face.normal);
    // Only faces turned toward the viewer, which the ray meets from outside.
    // On a convex solid at most one of them contains the hit.
    const facing = dot(ray, normal);
    if (!facesViewer(rotation, face, faceSize, perspective) || facing >= 0) continue;
    const t = dot(normal, [normal[0] * half - eye[0], normal[1] * half - eye[1], normal[2] * half - eye[2]]) / facing;
    const local = unrotate(rotation, [eye[0] + t * ray[0], eye[1] + t * ray[1], eye[2] + t * ray[2]]);
    const col = Math.floor(((dot(local, face.u) + half) / faceSize) * figure.size);
    const row = Math.floor(((dot(local, face.v) + half) / faceSize) * figure.size);
    if (row >= 0 && row < figure.size && col >= 0 && col < figure.size) return { face: f, row, col };
  }
  return null;
}

type Point = [x: number, y: number];

const centre = (cell: Cell): Point => [cell.col + 0.5, cell.row + 0.5];

// The midpoint of the edge `cell` shares with `other`, on `cell`'s face.
function edgePoint(figure: Figure, cell: Cell, other: Cell): Point {
  const key = cellKey(other);
  const dir = DIRS.find(d => cellKey(neighbor(figure, cell, d).cell) === key)!;
  const [dy, dx] = DIR_DELTAS[dir];
  return [cell.col + 0.5 + dx * 0.5, cell.row + 0.5 + dy * 0.5];
}

// The runs of consecutive cells of `arrow` on `face`. Where the body continues
// on another face, the run is extended to the shared edge, so the arrow reads
// as one line over it.
function runsOnFace(figure: Figure, arrow: Arrow, face: number): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] | null = null;
  arrow.cells.forEach((cell, i) => {
    if (cell.face !== face) { run = null; return; }
    const prev = arrow.cells[i - 1];
    const next = arrow.cells[i + 1];
    if (!run) {
      run = prev ? [edgePoint(figure, cell, prev)] : [];
      runs.push(run);
    }
    run.push(centre(cell));
    if (next && next.face !== face) run.push(edgePoint(figure, cell, next));
  });
  return runs;
}

function ArrowShape({ figure, arrow, face, near, bumped }: {
  figure: Figure;
  arrow: Arrow;
  face: number;
  // On a face turned toward the viewer.
  near: boolean;
  bumped: boolean;
}) {
  const runs = runsOnFace(figure, arrow, face);
  if (runs.length === 0) return null;

  const head = arrow.cells[arrow.cells.length - 1];
  const [dy, dx] = DIR_DELTAS[arrow.dir];

  let headShape = null;
  if (head.face === face) {
    const points = runs[runs.length - 1];
    const [hx, hy] = centre(head);
    // A one-cell arrow still needs a visible shaft behind its head.
    if (arrow.cells.length === 1) points.unshift([hx - dx * 0.35, hy - dy * 0.35]);
    points.push([hx + dx * 0.1, hy + dy * 0.1]);
    const tip = [hx + dx * 0.42, hy + dy * 0.42];
    const base = [hx + dx * 0.05, hy + dy * 0.05];
    headShape = (
      <polygon
        points={`${tip} ${base[0] - dy * 0.25},${base[1] + dx * 0.25} ${base[0] + dy * 0.25},${base[1] - dx * 0.25}`}
        fill="currentColor"
      />
    );
  }

  return (
    <g
      data-arrow-id={arrow.id}
      className={bumped ? 'arrow-bump' : undefined}
      // Nudge distance for the bump keyframes, in viewBox units (one cell = 1).
      style={{
        ...({ '--arrow-color': ARROW_COLOR, '--bump-x': `${dx * 0.2}px`, '--bump-y': `${dy * 0.2}px` } as CSSProperties),
        color: 'var(--arrow-color)',
        opacity: near ? 1 : FAR_SIDE_OPACITY,
      }}
    >
      {runs.map((points, i) => (
        <polyline
          key={i}
          points={points.map(p => p.join(',')).join(' ')}
          fill="none" stroke="currentColor" strokeWidth={0.18} strokeLinecap="round" strokeLinejoin="round"
        />
      ))}
      {headShape}
    </g>
  );
}

export function Figure3D({ figure, arrows, faceSize, bump, onArrowTap }: {
  figure: Figure;
  arrows: Arrow[];
  faceSize: number;
  // An arrow that just failed to move, shown with a short nudge forward and back.
  bump: { id: number; n: number } | null;
  onArrowTap: (id: number) => void;
}) {
  const [rotation, setRotation] = useState<Mat3>(INITIAL_ROTATION);
  const [zoom, setZoom] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  // Pointers that went down on the stage, by id. One is a drag or a tap; two
  // are a pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  // Perspective follows the unzoomed size, so zooming scales the figure
  // without changing how strongly it recedes.
  const perspective = faceSize * 6;
  const size = faceSize * zoom;

  // The window listeners are registered once, so they read the latest render
  // through this ref.
  const latest = useRef({ figure, arrows, rotation, size, zoom, perspective, onArrowTap });
  useEffect(() => { latest.current = { figure, arrows, rotation, size, zoom, perspective, onArrowTap }; });

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
      const { figure, arrows, rotation, size, perspective, onArrowTap } = latest.current;
      const box = stageRef.current.getBoundingClientRect();
      const cell = pickCell(
        figure, rotation, size, perspective,
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
          const near = facesViewer(rotation, face, size, perspective);
          return (
            <div
              key={f}
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2,
                transform: faceCss(face, size / 2),
                // Translucent glass, light enough for black arrows to read. No
                // grid lines: arrow positions have to be read from the arrows
                // themselves. No CSS border either: the edges are drawn in the
                // svg below, under the arrows.
                background: 'rgba(236, 240, 241, 0.55)',
                // Taps are resolved by pickCell(); every press lands on the stage.
                pointerEvents: 'none',
              }}
            >
              <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} style={{ display: 'block' }}>
                <rect
                  x={0} y={0} width={n} height={n} fill="none"
                  stroke="rgba(255, 255, 255, 0.8)" strokeWidth={EDGE_WIDTH} vectorEffect="non-scaling-stroke"
                />
                {arrows.map(arrow => (
                  <ArrowShape
                    // Remounting on each new bump restarts its animation.
                    key={bump?.id === arrow.id ? `${arrow.id}-${bump.n}` : arrow.id}
                    figure={figure}
                    arrow={arrow}
                    face={f}
                    near={near}
                    bumped={bump?.id === arrow.id}
                  />
                ))}
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}
