// Renders a figure as a rotatable 3D solid with CSS transforms.
//
// Each face is a flat div placed by a matrix3d built straight from its frame
// in packages/shared (u, v, normal are CSS-oriented already). The whole solid
// carries one rotation matrix; dragging rotates it about the screen axes, so a
// horizontal drag always spins left/right however the figure is tilted.
// Faces turned away are culled with backface-visibility, which also keeps
// their arrows from receiving taps.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DIR_DELTAS, type Arrow, type Face, type Figure } from '@arrow-puzzle/shared';

// Row-major 3x3 rotation matrices.
type Mat3 = number[];

const rotX = (a: number): Mat3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a: number): Mat3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const multiply = (a: Mat3, b: Mat3): Mat3 =>
  [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));

// matrix3d() is column-major.
const rotationCss = (m: Mat3) =>
  `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,0,0,0,1)`;

const faceCss = ({ u, v, normal: n }: Face, half: number) =>
  `matrix3d(${u.join(',')},0,${v.join(',')},0,${n.join(',')},0,${n[0] * half},${n[1] * half},${n[2] * half},1)`;

// Front, right and top in view, so the figure reads as a solid from the start.
const INITIAL_ROTATION = multiply(rotX(-0.45), rotY(-0.6));
const DRAG_SPEED = 0.01; // radians per pixel
const TAP_SLOP = 6; // pixels a pointer may wander before a press becomes a drag

const ARROW_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#e84393', '#34495e'];

function ArrowShape({ arrow, face, bumped, onTap }: { arrow: Arrow; face: number; bumped: boolean; onTap: () => void }) {
  const onFace = arrow.cells.filter(c => c.face === face);
  if (onFace.length === 0) return null;

  const head = arrow.cells[arrow.cells.length - 1];
  const [dy, dx] = DIR_DELTAS[arrow.dir];
  const points = onFace.map(c => [c.col + 0.5, c.row + 0.5]);
  const color = ARROW_COLORS[arrow.id % ARROW_COLORS.length];

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
        fill={color}
      />
    );
  }

  const path = points.map(p => p.join(',')).join(' ');
  return (
    <g
      onClick={onTap}
      className={bumped ? 'arrow-bump' : undefined}
      // Nudge distance for the bump keyframes, in viewBox units (one cell = 1).
      style={{ cursor: 'pointer', '--bump-x': `${dx * 0.2}px`, '--bump-y': `${dy * 0.2}px` } as CSSProperties}
    >
      <polyline points={path} fill="none" stroke={color} strokeWidth={0.18} strokeLinecap="round" strokeLinejoin="round" />
      {headShape}
      {/* Generous invisible hit area: the drawn shaft is thin for a finger. */}
      <polyline points={path} fill="none" stroke="transparent" strokeWidth={0.8} pointerEvents="stroke" />
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
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // Survives until the click that ends a drag, so that click can be ignored.
  const suppressTap = useRef(false);

  // Window listeners rather than pointer capture: capture would retarget the
  // closing click to the container and arrows would never see their taps.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      d.moved = true;
      drag.current = { x: e.clientX, y: e.clientY, moved: true };
      setRotation(r => multiply(multiply(rotY(dx * DRAG_SPEED), rotX(-dy * DRAG_SPEED)), r));
    };
    const up = () => {
      suppressTap.current = drag.current?.moved ?? false;
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const n = figure.size;
  const stage = faceSize * 2;

  return (
    <div
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
        suppressTap.current = false;
      }}
      style={{ width: stage, height: stage, perspective: `${stage * 3}px`, position: 'relative', flex: '0 0 auto', cursor: 'grab' }}
    >
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: rotationCss(rotation) }}>
        {figure.faces.map((face, f) => (
          <div
            key={f}
            style={{
              position: 'absolute', left: '50%', top: '50%',
              width: faceSize, height: faceSize, marginLeft: -faceSize / 2, marginTop: -faceSize / 2,
              transform: faceCss(face, faceSize / 2),
              backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
              background: '#ecf0f1', boxSizing: 'border-box', border: '2px solid #1c2833',
            }}
          >
            <svg viewBox={`0 0 ${n} ${n}`} width={faceSize - 4} height={faceSize - 4} style={{ display: 'block' }}>
              {Array.from({ length: n - 1 }, (_, i) => (
                <g key={i} stroke="#bdc3c7" strokeWidth={0.02}>
                  <line x1={i + 1} y1={0} x2={i + 1} y2={n} />
                  <line x1={0} y1={i + 1} x2={n} y2={i + 1} />
                </g>
              ))}
              {arrows.map(arrow => (
                <ArrowShape
                  // Remounting on each new bump restarts its animation.
                  key={bump?.id === arrow.id ? `${arrow.id}-${bump.n}` : arrow.id}
                  arrow={arrow}
                  face={f}
                  bumped={bump?.id === arrow.id}
                  onTap={() => {
                    if (suppressTap.current) { suppressTap.current = false; return; }
                    onArrowTap(arrow.id);
                  }}
                />
              ))}
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
