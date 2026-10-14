// Renders a figure as a rotatable 3D solid with CSS transforms.
//
// Each face is a flat div placed by a matrix3d built straight from its frame
// in packages/shared (u, v, normal are CSS-oriented already). The whole solid
// carries one rotation matrix; dragging rotates it about the screen axes, so a
// horizontal drag always spins left/right however the figure is tilted.
//
// The faces are see-through, so arrows on the far side stay visible and the
// player can keep track of what is left. Far-side arrows are dimmed and can't
// be tapped.
//
// Taps are resolved here, not by the browser: Chrome's hit testing of SVG
// inside perspective 3D transforms misses often on slanted faces. A tap is
// traced from the eye through the screen point onto the nearest face turned
// toward the viewer, and whichever arrow occupies that cell is tapped -- so the
// whole cell is the target, not just the thin drawn line.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DIR_DELTAS, cellKey, type Arrow, type Cell, type Face, type Figure, type Vec3 } from '@arrow-puzzle/shared';

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
const FACE_BORDER = 2; // px; the arrow grid starts inside it

// Arrows are black; a blocked attempt flashes them red (see .arrow-bump in
// App.css). Arrows on faces turned away from the viewer are dimmed.
const ARROW_COLOR = '#111';
const FAR_SIDE_OPACITY = 0.3;

// Whether a face points toward the viewer under `rotation`: the z component
// (toward the screen) of its rotated normal.
const facesViewer = (rotation: Mat3, { normal }: Face) => rotate(rotation, normal)[2] > 0;

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
  const inner = faceSize - 2 * FACE_BORDER;
  for (let f = 0; f < figure.faces.length; f++) {
    const face = figure.faces[f];
    const normal = rotate(rotation, face.normal);
    // Only faces turned toward the viewer, which the ray meets from outside.
    // On a convex solid at most one of them contains the hit.
    const facing = dot(ray, normal);
    if (normal[2] <= 0 || facing >= 0) continue;
    const t = dot(normal, [normal[0] * half - eye[0], normal[1] * half - eye[1], normal[2] * half - eye[2]]) / facing;
    const local = unrotate(rotation, [eye[0] + t * ray[0], eye[1] + t * ray[1], eye[2] + t * ray[2]]);
    const col = Math.floor(((dot(local, face.u) + half - FACE_BORDER) / inner) * figure.size);
    const row = Math.floor(((dot(local, face.v) + half - FACE_BORDER) / inner) * figure.size);
    if (row >= 0 && row < figure.size && col >= 0 && col < figure.size) return { face: f, row, col };
  }
  return null;
}

function ArrowShape({ arrow, face, near, bumped }: {
  arrow: Arrow;
  face: number;
  // On a face turned toward the viewer.
  near: boolean;
  bumped: boolean;
}) {
  const onFace = arrow.cells.filter(c => c.face === face);
  if (onFace.length === 0) return null;

  const head = arrow.cells[arrow.cells.length - 1];
  const [dy, dx] = DIR_DELTAS[arrow.dir];
  const points = onFace.map(c => [c.col + 0.5, c.row + 0.5]);

  let headShape = null;
  if (head.face === face) {
    const [hx, hy] = [head.col + 0.5, head.row + 0.5];
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
      <polyline
        points={points.map(p => p.join(',')).join(' ')}
        fill="none" stroke="currentColor" strokeWidth={0.18} strokeLinecap="round" strokeLinejoin="round"
      />
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
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const stage = faceSize * 2;
  const perspective = stage * 3;

  // The window listeners are registered once, so they read the latest render
  // through this ref.
  const latest = useRef({ figure, arrows, rotation, faceSize, perspective, onArrowTap });
  useEffect(() => { latest.current = { figure, arrows, rotation, faceSize, perspective, onArrowTap }; });

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      drag.current = { x: e.clientX, y: e.clientY, moved: true };
      setRotation(r => multiply(multiply(rotY(dx * DRAG_SPEED), rotX(-dy * DRAG_SPEED)), r));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved || !stageRef.current) return;
      const { figure, arrows, rotation, faceSize, perspective, onArrowTap } = latest.current;
      const box = stageRef.current.getBoundingClientRect();
      const cell = pickCell(
        figure, rotation, faceSize, perspective,
        e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2),
      );
      if (!cell) return;
      const key = cellKey(cell);
      const arrow = arrows.find(a => a.cells.some(c => cellKey(c) === key));
      if (arrow) onArrowTap(arrow.id);
    };
    const cancel = () => { drag.current = null; };
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
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; }}
      style={{ width: stage, height: stage, perspective: `${perspective}px`, position: 'relative', flex: '0 0 auto', cursor: 'grab' }}
    >
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: rotationCss(rotation) }}>
        {figure.faces.map((face, f) => {
          const near = facesViewer(rotation, face);
          return (
            <div
              key={f}
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: faceSize, height: faceSize, marginLeft: -faceSize / 2, marginTop: -faceSize / 2,
                transform: faceCss(face, faceSize / 2),
                // Translucent glass, light enough for black arrows to read, with
                // visible edges. No grid lines: arrow positions have to be read
                // from the arrows themselves.
                background: 'rgba(236, 240, 241, 0.55)', boxSizing: 'border-box',
                border: `${FACE_BORDER}px solid rgba(255, 255, 255, 0.8)`,
                // Taps are resolved by pickCell(); every press lands on the stage.
                pointerEvents: 'none',
              }}
            >
              <svg viewBox={`0 0 ${n} ${n}`} width={faceSize - 2 * FACE_BORDER} height={faceSize - 2 * FACE_BORDER} style={{ display: 'block' }}>
                {arrows.map(arrow => (
                  <ArrowShape
                    // Remounting on each new bump restarts its animation.
                    key={bump?.id === arrow.id ? `${arrow.id}-${bump.n}` : arrow.id}
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
