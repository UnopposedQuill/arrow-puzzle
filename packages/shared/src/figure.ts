// The figure: a closed surface made of four-sided faces, each carrying a
// square `size` x `size` grid of cells, linked to each other side by side.
//
// Faces are parallelograms: a corner `origin` and the side vectors `u` (along
// the grid's columns, "right") and `v` (along its rows, "down"), each `size`
// figure units long, so a cell is one unit along both. u x v points outward
// (`normal`). Coordinates follow CSS (x right, y down, z toward the viewer), so
// the same frames position the faces in the frontend's 3D transforms. Square
// faces (block figures) and rhombi (the rhombic dodecahedron) both fit, and so
// would any other solid with four-sided faces.
//
// Each side of a face links to a side of another face. Crossing it goes one of
// three ways, found from the geometry:
//
//   flat     the next face lies in the same plane -- not an edge, arrows carry
//            straight on;
//   convex   the surface folds away -- an outer edge;
//   concave  the surface folds up into a wall -- an inner corner.
//
// Convex and concave sides are the figure's edges. An edge is split into
// segments, runs of its cells each with a type that decides what an arrow's
// head does on reaching it there (step()); bodies simply lie across edges of
// any type (neighbor()). Where a head meets an edge therefore matters, not just
// which edge it meets.

export type Vec3 = [number, number, number];

// Face-local headings, in grid terms. A face's sides are numbered the same way:
// side 0 is row 0, side 1 the last column, side 2 the last row, side 3 column 0.
export type Dir = 0 | 1 | 2 | 3; // up, right, down, left
export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DIR_DELTAS: Record<Dir, readonly [dRow: number, dCol: number]> = {
  0: [-1, 0],
  1: [0, 1],
  2: [1, 0],
  3: [0, -1],
};
export const opposite = (dir: Dir) => ((dir + 2) % 4) as Dir;

// What a head does on reaching an edge:
//   open    leaves its side and the arrow is cleared;
//   sticky  carries on onto the next face, so it has to leave over another edge;
//   mirror  bounces straight back -- into its own body unless the arrow is short;
//   turn    turns to run along the edge, the way the edge points (`along`).
export type EdgeType = 'open' | 'sticky' | 'mirror' | 'turn';
export const EDGE_TYPES: readonly EdgeType[] = ['open', 'sticky', 'mirror', 'turn'];

export type Crossing = 'flat' | 'convex' | 'concave';

export type FigureKind = 'cube' | 'notch' | 'step' | 'cross' | 'rhombic';
export const FIGURE_KINDS: readonly FigureKind[] = ['cube', 'notch', 'step', 'cross', 'rhombic'];

export interface Link {
  face: number;
  side: Dir;
  // Whether the side's cells run the other way on the linked face.
  reversed: boolean;
  crossing: Crossing;
  // Index into Figure.edges; null for flat links.
  edge: number | null;
}

export interface Face {
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  origin: Vec3;
  // How the surface continues past each side, indexed by Dir.
  sides: [Crossing, Crossing, Crossing, Crossing];
  links: [Link, Link, Link, Link];
}

// A run of an edge's cells with one type: cell indices [from, to) along the
// edge's first face's side.
export interface Segment {
  from: number;
  to: number;
  type: EdgeType;
  // For 'turn': which way along the edge heads turn, in the same terms (+1
  // toward higher cell indices, -1 toward lower).
  along?: 1 | -1;
}

export interface Edge {
  faces: [number, number];
  sides: [Dir, Dir];
  crossing: 'convex' | 'concave';
  // Contiguous, in order, covering the whole edge: [0, size).
  segments: Segment[];
}

export interface Figure {
  kind: FigureKind;
  // Cells along a face's side.
  size: number;
  // Centre and largest side of the bounding box, in figure units.
  center: Vec3;
  extent: number;
  faces: Face[];
  edges: Edge[];
}

export interface Cell {
  face: number;
  row: number;
  col: number;
}

export type StepResult =
  | { kind: 'cell'; cell: Cell; dir: Dir }
  // `dir` is the heading the head leaves in, which redirecting edges may have
  // changed on the way (a turn at a corner sends it out over the side edge).
  | { kind: 'exit'; edge: Edge; dir: Dir }
  // Edges send the head back and forth without it getting anywhere (e.g. two
  // turn edges at a corner pointing into each other): it can't go on.
  | { kind: 'stuck' };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (...vs: Vec3[]): Vec3 => vs.reduce<Vec3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// `+ 0` turns -0 into 0, so negated axes compare and serialise cleanly.
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k + 0, a[1] * k + 0, a[2] * k + 0];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1] + 0,
  a[2] * b[0] - a[0] * b[2] + 0,
  a[0] * b[1] - a[1] * b[0] + 0,
];
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const equal = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// --- Building figures ---

// A face as the builders produce it, in their own integer coordinates.
interface RawFace {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

// The corners a side runs between, in the direction its cell index grows.
function sideCorners({ origin, u, v }: RawFace, side: Dir): [Vec3, Vec3] {
  return [
    [origin, add(origin, u)],
    [add(origin, u), add(origin, u, v)],
    [add(origin, v), add(origin, u, v)],
    [origin, add(origin, v)],
  ][side] as [Vec3, Vec3];
}

// Turns a list of faces into a figure: links the sides that share corners,
// classifies each link, and scales the faces to `size` units a side. The
// surface must be closed and edge-manifold: every side shared by exactly two
// faces.
function mesh(kind: FigureKind, size: number, raw: RawFace[]): Figure {
  const key = (p: Vec3) => p.join(',');
  const bySide = new Map<string, { face: number; side: Dir; start: string }[]>();
  raw.forEach((face, f) => {
    for (const side of DIRS) {
      const [a, b] = sideCorners(face, side).map(key);
      const id = [a, b].sort().join('|');
      if (!bySide.has(id)) bySide.set(id, []);
      bySide.get(id)!.push({ face: f, side, start: a });
    }
  });

  const unit = size / length(raw[0].u);
  const faces: Face[] = raw.map(r => ({
    normal: scale(cross(r.u, r.v), 1 / length(cross(r.u, r.v))),
    u: scale(r.u, unit),
    v: scale(r.v, unit),
    origin: scale(r.origin, unit),
    sides: ['flat', 'flat', 'flat', 'flat'],
    links: [] as unknown as Face['links'],
  }));
  const centroid = (f: number) => add(faces[f].origin, scale(add(faces[f].u, faces[f].v), 0.5));

  const edges: Edge[] = [];
  for (const [a, b] of bySide.values()) {
    const fa = faces[a.face];
    const fb = faces[b.face];
    // Same plane: flat. Otherwise convex when the other face falls away
    // behind this one's plane, concave when it rises in front of it.
    const crossing: Crossing = Math.abs(dot(fa.normal, fb.normal) - 1) < 1e-9 ? 'flat'
      : dot(sub(centroid(b.face), fa.origin), fa.normal) < 0 ? 'convex' : 'concave';
    let edge: number | null = null;
    if (crossing !== 'flat') {
      edge = edges.length;
      edges.push({ faces: [a.face, b.face], sides: [a.side, b.side], crossing, segments: [{ from: 0, to: size, type: 'open' }] });
    }
    const reversed = a.start !== b.start;
    fa.links[a.side] = { face: b.face, side: b.side, reversed, crossing, edge };
    fb.links[b.side] = { face: a.face, side: a.side, reversed, crossing, edge };
    fa.sides[a.side] = crossing;
    fb.sides[b.side] = crossing;
  }

  const corners = faces.flatMap(f => [f.origin, add(f.origin, f.u), add(f.origin, f.v), add(f.origin, f.u, f.v)]);
  const lo = [0, 1, 2].map(k => Math.min(...corners.map(c => c[k])));
  const hi = [0, 1, 2].map(k => Math.max(...corners.map(c => c[k])));
  return {
    kind,
    size,
    center: [0, 1, 2].map(k => (lo[k] + hi[k]) / 2) as Vec3,
    extent: Math.max(...[0, 1, 2].map(k => hi[k] - lo[k])),
    faces,
    edges,
  };
}

// Frames for the six outward directions of a block. Their order is the face
// order of the plain cube: front, right, back, left, top, bottom.
const FRAMES: { normal: Vec3; u: Vec3; v: Vec3 }[] = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
];

// A cube split into blocks x blocks x blocks, keeping the blocks `keep` says.
// Each exposed side of a kept block is a face. Kept blocks must share faces,
// never just an edge, so the surface stays edge-manifold.
function blockFaces(blocks: number, keep: (b: Vec3) => boolean): RawFace[] {
  const solid = (b: Vec3) => b.every(c => c >= 0 && c < blocks) && keep(b);
  const faces: RawFace[] = [];
  for (let x = 0; x < blocks; x++) {
    for (let y = 0; y < blocks; y++) {
      for (let z = 0; z < blocks; z++) {
        const block: Vec3 = [x, y, z];
        if (!solid(block)) continue;
        for (const { normal, u, v } of FRAMES) {
          if (solid(add(block, normal))) continue;
          // Doubled to stay integral: the face's centre is the block's centre
          // pushed out half a block along the normal.
          const centre2 = add(scale(block, 2), [1, 1, 1], normal);
          faces.push({ origin: scale(sub(centre2, add(u, v)), 0.5), u, v });
        }
      }
    }
  }
  return faces;
}

// The rhombic dodecahedron: 12 rhombi, one per edge direction of a cube. Its
// corners are the cube's (+-1, +-1, +-1) and the octahedron's (+-2, 0, 0) etc.
function rhombicFaces(): RawFace[] {
  const faces: RawFace[] = [];
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const k = 3 - i - j;
    for (const si of [1, -1]) {
      for (const sj of [1, -1]) {
        const axis = (a: number, s: number) => { const p: Vec3 = [0, 0, 0]; p[a] = s; return p; };
        const normal = add(axis(i, si), axis(j, sj));
        const tip = axis(i, 2 * si);
        let u = sub(add(normal, axis(k, 1)), tip);
        let v = sub(add(normal, axis(k, -1)), tip);
        if (dot(cross(u, v), normal) < 0) [u, v] = [v, u];
        faces.push({ origin: tip, u, v });
      }
    }
  }
  return faces;
}

// Builds a figure. `size` is the "Grid" setting: for block figures the cells
// across the whole figure (rounded up so blocks divide it evenly); for the
// rhombic dodecahedron, whose faces are smaller relative to its width, faces
// get half as many cells a side.
export function buildFigure(kind: FigureKind, size: number): Figure {
  switch (kind) {
    case 'cube':
      return mesh(kind, size, blockFaces(1, () => true));
    case 'notch':
      // The top-front-right corner block (x right, y down, z toward the viewer)
      // removed: the one the initial view looks into.
      return mesh(kind, Math.ceil(size / 2), blockFaces(2, b => !equal(b, [1, 0, 1])));
    case 'step':
      // The two top-front blocks removed: one long inner corner across the figure.
      return mesh(kind, Math.ceil(size / 2), blockFaces(2, b => !(b[1] === 0 && b[2] === 1)));
    case 'cross':
      // The centre of a 3x3x3 and the six blocks on its faces.
      return mesh(kind, Math.ceil(size / 3), blockFaces(3, b => b.filter(c => c === 1).length >= 2));
    case 'rhombic':
      return mesh(kind, Math.ceil(size / 2), rhombicFaces());
  }
}

export const buildCube = (size: number) => buildFigure('cube', size);

export function dirVector(face: Face, dir: Dir): Vec3 {
  return [scale(face.v, -1), face.u, face.v, scale(face.u, -1)][dir];
}

export function findEdge(figure: Figure, a: number, b: number): Edge | undefined {
  return figure.edges.find(e => (e.faces[0] === a && e.faces[1] === b) || (e.faces[0] === b && e.faces[1] === a));
}

// --- Moving on the surface ---

// The cell at index `k` along `side` of a face.
function sideCell(face: number, side: Dir, k: number, n: number): Cell {
  return [
    { face, row: 0, col: k },
    { face, row: k, col: n - 1 },
    { face, row: n - 1, col: k },
    { face, row: k, col: 0 },
  ][side];
}

// The cell next to `cell` in `dir` along the surface, the heading it has
// there, and how the surface got there. Pure geometry: edge types don't apply.
// This is how an arrow's body lies on the figure, and it may wrap over edges;
// only its head is subject to them (step()).
export function neighbor(figure: Figure, cell: Cell, dir: Dir): { cell: Cell; dir: Dir; crossing: Crossing } {
  const n = figure.size;
  const [dRow, dCol] = DIR_DELTAS[dir];
  const row = cell.row + dRow;
  const col = cell.col + dCol;
  if (row >= 0 && row < n && col >= 0 && col < n) return { cell: { face: cell.face, row, col }, dir, crossing: 'flat' };
  const link = figure.faces[cell.face].links[dir];
  const k = dir % 2 === 0 ? cell.col : cell.row;
  return {
    cell: sideCell(link.face, link.side, link.reversed ? n - 1 - k : k, n),
    dir: opposite(link.side),
    crossing: link.crossing,
  };
}

// Whether `side` of `face` counts its cells the other way from its edge (whose
// segments are in its first face's terms).
function reversedOnEdge(figure: Figure, face: number, side: Dir): boolean {
  const link = figure.faces[face].links[side];
  const edge = figure.edges[link.edge!];
  return !(edge.faces[0] === face && edge.sides[0] === side) && link.reversed;
}

// The segments along `side` of `face`, with `from`/`to` in this face's own cell
// indices. Empty for a flat side. What the frontend draws.
export function sideSegments(figure: Figure, face: number, side: Dir): { segment: Segment; from: number; to: number }[] {
  const link = figure.faces[face].links[side];
  if (link.edge === null) return [];
  const n = figure.size;
  const reversed = reversedOnEdge(figure, face, side);
  return figure.edges[link.edge].segments.map(segment =>
    reversed ? { segment, from: n - segment.to, to: n - segment.from } : { segment, from: segment.from, to: segment.to });
}

// The segment a head meets leaving `cell` over `side`.
function segmentAt(figure: Figure, cell: Cell, side: Dir): Segment {
  const k = side % 2 === 0 ? cell.col : cell.row;
  return sideSegments(figure, cell.face, side).find(s => k >= s.from && k < s.to)!.segment;
}

// The heading a turn segment gives a head arriving on `face` at `side`. Also
// what the frontend's chevrons point along.
export function turnDir(figure: Figure, segment: Segment, face: number, side: Dir): Dir {
  const along = reversedOnEdge(figure, face, side) ? -segment.along! : segment.along!;
  // Along the side means along columns for sides 0/2, along rows for 1/3.
  return side % 2 === 0 ? (along > 0 ? 1 : 3) : (along > 0 ? 2 : 0);
}

// How many edges in a row may redirect a head within one step before it is
// declared stuck (mirror + turn at a corner, two turns into each other, ...).
const MAX_REDIRECTS = 4;

// One step forward for an arrow's head at `cell` heading `dir`.
export function step(figure: Figure, cell: Cell, dir: Dir, redirects = 0): StepResult {
  const next = neighbor(figure, cell, dir);
  if (next.crossing === 'flat') return { kind: 'cell', cell: next.cell, dir: next.dir };
  const edge = figure.edges[figure.faces[cell.face].links[dir].edge!];
  const segment = segmentAt(figure, cell, dir);
  if (segment.type === 'open') return { kind: 'exit', edge, dir };
  if (segment.type === 'sticky') return { kind: 'cell', cell: next.cell, dir: next.dir };
  if (redirects >= MAX_REDIRECTS) return { kind: 'stuck' };
  // Mirror: back the way it came. Turn: along the edge. Either may meet
  // another edge straight away at a corner, which then has its say.
  const redirected = segment.type === 'mirror' ? opposite(dir) : turnDir(figure, segment, cell.face, dir);
  return step(figure, cell, redirected, redirects + 1);
}
