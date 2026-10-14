// The figure: a cube split into blocks x blocks x blocks subcubes, some of them
// removed. The plain cube is a single block; the notched cube is 2x2x2 with
// one corner block taken out.
//
// Its surface is made of faces, one per exposed side of a block. Every face is
// a square grid of `size` x `size` cells with a 3D frame: an outward `normal`
// and the in-plane axes `u` (grid columns, "right") and `v` (grid rows,
// "down"), with u x v = normal. Coordinates follow CSS (x right, y down, z
// toward the viewer), so the same frames position the faces in the frontend's
// 3D transforms. `origin` is the lattice corner where row 0 / col 0 starts.
//
// The solid is a lattice of unit voxels spanning [0, extent] on each axis,
// where extent = blocks * size; each surface cell sits on one voxel. Moving off
// a cell goes one of three ways (see neighbor()):
//
//   flat     the surface carries on in the same plane (within a face, or onto
//            the next face of the same flat side);
//   convex   the surface folds away from the arrow -- an outer edge;
//   concave  the surface folds up into a wall -- an inner corner.
//
// Convex and concave crossings are the figure's edges: each carries an
// EdgeType, and an arrow is cleared once its head leaves a side over an open
// one (at an inner corner it slides into the wall). Flat seams are not edges:
// arrows carry straight on over them. A head therefore stays on one flat side
// until it leaves it, so no slide can loop.

export type Vec3 = [number, number, number];

// Face-local headings, in grid terms.
export type Dir = 0 | 1 | 2 | 3; // up, right, down, left
export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DIR_DELTAS: Record<Dir, readonly [dRow: number, dCol: number]> = {
  0: [-1, 0],
  1: [0, 1],
  2: [1, 0],
  3: [0, -1],
};
export const opposite = (dir: Dir) => ((dir + 2) % 4) as Dir;

// What happens to an arrow whose head crosses an edge. Only 'open' exists so
// far: the arrow leaves its side and is cleared. New kinds (e.g.
// 'sticky', carrying the arrow onto the next face so it has to clear another
// edge) are added here and handled in step().
export type EdgeType = 'open';

export type Crossing = 'flat' | 'convex' | 'concave';

export type FigureKind = 'cube' | 'notch';
export const FIGURE_KINDS: readonly FigureKind[] = ['cube', 'notch'];

export interface Face {
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  origin: Vec3;
  // How the surface continues past each side, indexed by Dir.
  sides: [Crossing, Crossing, Crossing, Crossing];
}

// An edge between two faces, outer (convex) or inner (concave).
export interface Edge {
  faces: [number, number];
  crossing: 'convex' | 'concave';
  type: EdgeType;
}

export interface Figure {
  kind: FigureKind;
  // Cells along a face's side.
  size: number;
  // Side of the bounding cube, in cells.
  extent: number;
  blocks: number;
  removed: Vec3[];
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
  | { kind: 'exit'; edge: Edge };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (...vs: Vec3[]): Vec3 => vs.reduce<Vec3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
// `+ 0` turns -0 into 0, so negated axes compare and serialise cleanly.
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k + 0, a[1] * k + 0, a[2] * k + 0];
const equal = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// Frames for the six outward directions. Their order is the face order of the
// plain cube: front, right, back, left, top, bottom.
const FRAMES: { normal: Vec3; u: Vec3; v: Vec3 }[] = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
];

// Blocks removed from each figure, in block coordinates. The notch takes out
// the top-front-right corner block (x right, y down, z toward the viewer), the
// one the initial view looks into.
const SHAPES: Record<FigureKind, { blocks: number; removed: Vec3[] }> = {
  cube: { blocks: 1, removed: [] },
  notch: { blocks: 2, removed: [[1, 0, 1]] },
};

// `size` is the grid across the whole figure's side, as in the "Grid" setting.
// Figures split into blocks need it to divide evenly, so it is rounded up.
export function buildFigure(kind: FigureKind, size: number, edgeType: EdgeType = 'open'): Figure {
  const { blocks, removed } = SHAPES[kind];
  const faceSize = Math.ceil(size / blocks);
  const figure: Figure = { kind, size: faceSize, extent: faceSize * blocks, blocks, removed, faces: [], edges: [] };

  const blockSolid = (b: Vec3) =>
    b.every(c => c >= 0 && c < blocks) && !removed.some(r => equal(r, b));
  for (let bx = 0; bx < blocks; bx++) {
    for (let by = 0; by < blocks; by++) {
      for (let bz = 0; bz < blocks; bz++) {
        const block: Vec3 = [bx, by, bz];
        if (!blockSolid(block)) continue;
        for (const { normal, u, v } of FRAMES) {
          if (blockSolid(add(block, normal))) continue;
          // Doubled coordinates keep the arithmetic integral: the face's centre
          // is the block's centre pushed out half a block along the normal.
          const centre2 = add(scale(block, 2 * faceSize), [faceSize, faceSize, faceSize], scale(normal, faceSize));
          const origin = scale(add(centre2, scale(u, -faceSize), scale(v, -faceSize)), 0.5);
          figure.faces.push({ normal, u, v, origin, sides: ['flat', 'flat', 'flat', 'flat'] });
        }
      }
    }
  }

  // Classify each face's sides, and collect the edges between faces.
  const mid = Math.floor(faceSize / 2);
  figure.faces.forEach((face, f) => {
    for (const dir of DIRS) {
      const boundary: Cell = [
        { face: f, row: 0, col: mid },
        { face: f, row: mid, col: faceSize - 1 },
        { face: f, row: faceSize - 1, col: mid },
        { face: f, row: mid, col: 0 },
      ][dir];
      const next = neighbor(figure, boundary, dir);
      face.sides[dir] = next.crossing;
      if (next.crossing !== 'flat' && !findEdge(figure, f, next.cell.face)) {
        figure.edges.push({ faces: [f, next.cell.face], crossing: next.crossing, type: edgeType });
      }
    }
  });
  return figure;
}

export const buildCube = (size: number, edgeType: EdgeType = 'open') => buildFigure('cube', size, edgeType);

export function dirVector(face: Face, dir: Dir): Vec3 {
  return [scale(face.v, -1), face.u, face.v, scale(face.u, -1)][dir];
}

export function findEdge(figure: Figure, a: number, b: number): Edge | undefined {
  return figure.edges.find(e => (e.faces[0] === a && e.faces[1] === b) || (e.faces[0] === b && e.faces[1] === a));
}

// Doubled lattice position of a cell's centre, on the surface.
function cellPoint2(figure: Figure, cell: Cell): Vec3 {
  const { origin, u, v } = figure.faces[cell.face];
  return add(scale(origin, 2), scale(u, 2 * cell.col + 1), scale(v, 2 * cell.row + 1));
}

// Whether the voxel whose doubled centre is `c2` is part of the solid.
function solid(figure: Figure, c2: Vec3): boolean {
  const voxel = c2.map(c => (c - 1) / 2);
  if (voxel.some(c => c < 0 || c >= figure.extent)) return false;
  const block = voxel.map(c => Math.floor(c / figure.size)) as Vec3;
  return !figure.removed.some(r => equal(r, block));
}

// The surface cell at doubled position `p2` on a face with `normal`.
function cellAt(figure: Figure, p2: Vec3, normal: Vec3): Cell {
  const local = (f: Face) => add(p2, scale(f.origin, -2));
  const coords = (f: Face) => ({ row: (dot(local(f), f.v) - 1) / 2, col: (dot(local(f), f.u) - 1) / 2 });
  const face = figure.faces.findIndex(f => {
    if (!equal(f.normal, normal) || dot(local(f), f.normal) !== 0) return false;
    const { row, col } = coords(f);
    return col >= 0 && col < figure.size && row >= 0 && row < figure.size;
  });
  return { face, ...coords(figure.faces[face]) };
}

// The cell next to `cell` in `dir` along the surface, the heading it has
// there, and how the surface got there. Pure geometry: edge types don't apply.
// This is how an arrow's body lies on the figure, and it may wrap over edges;
// only its head is subject to them (step()).
export function neighbor(figure: Figure, cell: Cell, dir: Dir): Neighbor {
  // Generation and replay ask for the same neighbours over and over; the
  // answers depend only on the figure, so they are cached per figure object.
  // Kept outside the figure itself, which stays plain serialisable data.
  let cache = neighborCache.get(figure);
  if (!cache) neighborCache.set(figure, cache = new Map());
  const key = `${cell.face}:${cell.row}:${cell.col}:${dir}`;
  let result = cache.get(key);
  if (!result) cache.set(key, result = computeNeighbor(figure, cell, dir));
  return result;
}

export type Neighbor = Readonly<{ cell: Cell; dir: Dir; crossing: Crossing }>;
const neighborCache = new WeakMap<Figure, Map<string, Neighbor>>();

function computeNeighbor(figure: Figure, cell: Cell, dir: Dir): Neighbor {
  const face = figure.faces[cell.face];
  const n = face.normal;
  const d = dirVector(face, dir);
  // Doubled centre of the voxel under the cell.
  const voxel = add(cellPoint2(figure, cell), scale(n, -1));

  let point: Vec3, normal: Vec3, heading: Vec3, crossing: Crossing;
  if (solid(figure, add(voxel, scale(d, 2), scale(n, 2)))) {
    // A wall rises ahead: climb onto it, heading out along the old normal.
    [point, normal, heading, crossing] = [add(voxel, scale(n, 2), d), scale(d, -1), n, 'concave'];
  } else if (solid(figure, add(voxel, scale(d, 2)))) {
    [point, normal, heading, crossing] = [add(voxel, scale(d, 2), n), n, d, 'flat'];
  } else {
    // Nothing ahead: fold over the edge, heading down the far side.
    [point, normal, heading, crossing] = [add(voxel, d), d, scale(n, -1), 'convex'];
  }
  const next = cellAt(figure, point, normal);
  return {
    cell: next,
    dir: DIRS.find(h => equal(dirVector(figure.faces[next.face], h), heading))!,
    crossing,
  };
}

// One step forward for an arrow's head at `cell` heading `dir`.
export function step(figure: Figure, cell: Cell, dir: Dir): StepResult {
  const next = neighbor(figure, cell, dir);
  if (next.crossing === 'flat') return { kind: 'cell', cell: next.cell, dir: next.dir };
  const edge = findEdge(figure, cell.face, next.cell.face)!;
  switch (edge.type) {
    case 'open':
      return { kind: 'exit', edge };
    // An edge type that carries arrows across returns
    // { kind: 'cell', cell: next.cell, dir: next.dir } instead.
  }
}
