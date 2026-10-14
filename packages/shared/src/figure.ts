// The figure: a solid whose faces each carry a square grid of cells, joined
// along typed edges.
//
// Every face has a 3D frame -- an outward `normal` and the in-plane axes `u`
// (grid columns, "right") and `v` (grid rows, "down"), with u x v = normal.
// Coordinates follow CSS (x right, y down, z toward the viewer), so the same
// frames position the faces in the frontend's 3D transforms.
//
// Cell centres are kept on an integer lattice: on a figure of grid size N the
// solid spans [-N, N] on each axis and cell centres sit at odd offsets. That
// makes crossing from one face to the next exact integer arithmetic.

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

// What happens to an arrow whose head crosses an edge. Only 'open' exists so
// far: the arrow leaves the figure and is cleared. New kinds (e.g. 'sticky',
// carrying the arrow onto the next face so it has to clear another edge) are
// added here and handled in step().
export type EdgeType = 'open';

export interface Face {
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

export interface Edge {
  faces: [number, number];
  type: EdgeType;
}

export interface Figure {
  kind: 'cube';
  size: number;
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
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
// `+ 0` turns -0 into 0, so negated axes compare and serialise cleanly.
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k + 0, a[1] * k + 0, a[2] * k + 0];
const equal = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const CUBE_FACES: Face[] = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },   // front
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },  // right
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }, // back
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },  // left
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },  // top
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },  // bottom
];

export function buildCube(size: number, edgeType: EdgeType = 'open'): Figure {
  const edges: Edge[] = [];
  CUBE_FACES.forEach((a, i) => {
    CUBE_FACES.forEach((b, j) => {
      // Faces of a cube share an edge exactly when their normals are perpendicular.
      if (i < j && dot(a.normal, b.normal) === 0) edges.push({ faces: [i, j], type: edgeType });
    });
  });
  return { kind: 'cube', size, faces: CUBE_FACES, edges };
}

export function dirVector(face: Face, dir: Dir): Vec3 {
  return [scale(face.v, -1), face.u, face.v, scale(face.u, -1)][dir];
}

export function cellPosition(figure: Figure, cell: Cell): Vec3 {
  const { normal, u, v } = figure.faces[cell.face];
  const n = figure.size;
  return add(add(scale(normal, n), scale(u, 2 * cell.col + 1 - n)), scale(v, 2 * cell.row + 1 - n));
}

export function findEdge(figure: Figure, a: number, b: number): Edge {
  return figure.edges.find(e => (e.faces[0] === a && e.faces[1] === b) || (e.faces[0] === b && e.faces[1] === a))!;
}

// Where a cell on the boundary of its face lands when it steps over the edge
// in `dir`: the matching cell on the neighbouring face, and the heading it has
// there. Folding over the edge swaps the roles of the old normal and the step
// direction, which on the integer lattice is a single vector addition.
export function crossEdge(figure: Figure, cell: Cell, dir: Dir): { cell: Cell; dir: Dir; edge: Edge } {
  const face = figure.faces[cell.face];
  const out = dirVector(face, dir);
  const landed = add(add(cellPosition(figure, cell), out), scale(face.normal, -1));
  const nextFace = figure.faces.findIndex(f => equal(f.normal, out));
  const next = figure.faces[nextFace];
  const n = figure.size;
  return {
    cell: { face: nextFace, row: (dot(landed, next.v) + n - 1) / 2, col: (dot(landed, next.u) + n - 1) / 2 },
    dir: DIRS.find(d => equal(dirVector(next, d), scale(face.normal, -1)))!,
    edge: findEdge(figure, cell.face, nextFace),
  };
}

// One step forward from `cell` heading `dir`.
export function step(figure: Figure, cell: Cell, dir: Dir): StepResult {
  const [dRow, dCol] = DIR_DELTAS[dir];
  const row = cell.row + dRow;
  const col = cell.col + dCol;
  if (row >= 0 && row < figure.size && col >= 0 && col < figure.size) {
    return { kind: 'cell', cell: { face: cell.face, row, col }, dir };
  }
  const crossing = crossEdge(figure, cell, dir);
  switch (crossing.edge.type) {
    case 'open':
      return { kind: 'exit', edge: crossing.edge };
    // An edge type that carries arrows across returns
    // { kind: 'cell', cell: crossing.cell, dir: crossing.dir } instead. Once
    // one exists, slides can circle the figure: bound the loops that call step().
  }
}
