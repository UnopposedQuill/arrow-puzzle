import {
  buildCube, buildFigure, neighbor, opposite, step, findEdge, dirVector, DIRS, FIGURE_KINDS,
  type Cell, type Figure, type Vec3,
} from '../src/index.js';

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1] + 0,
  a[2] * b[0] - a[0] * b[2] + 0,
  a[0] * b[1] - a[1] * b[0] + 0,
];

const allCells = (figure: Figure): Cell[] => figure.faces.flatMap((_, face) =>
  Array.from({ length: figure.size ** 2 }, (_, i) => ({ face, row: Math.floor(i / figure.size), col: i % figure.size })));

describe('buildCube', () => {
  const cube = buildCube(3);

  it('has six right-handed faces covering the whole grid', () => {
    expect(cube.faces).toHaveLength(6);
    expect(cube.size).toBe(3);
    expect(cube.extent).toBe(3);
    // u x v = normal keeps every face's front side facing outwards, which the
    // frontend relies on.
    for (const f of cube.faces) expect(cross(f.u, f.v)).toEqual(f.normal);
  });

  it('joins every face to four others over open convex edges', () => {
    expect(cube.edges).toHaveLength(12);
    expect(cube.edges.every(e => e.crossing === 'convex')).toBe(true);
    cube.faces.forEach((face, i) => {
      expect(face.sides).toEqual(['convex', 'convex', 'convex', 'convex']);
      expect(cube.edges.filter(e => e.faces.includes(i))).toHaveLength(4);
    });
    expect(cube.edges.every(e => e.type === 'open')).toBe(true);
  });

  it('finds an edge from either side, and none between opposite faces', () => {
    const [a, b] = cube.edges[0].faces;
    expect(findEdge(cube, b, a)).toBe(cube.edges[0]);
    // Front (0) and back (2) never meet.
    expect(findEdge(cube, 0, 2)).toBeUndefined();
  });
});

describe('notched cube', () => {
  // 2x2x2 blocks of 4x4-cell faces, with the top-front-right block removed.
  const notch = buildFigure('notch', 8);

  it('is made of one face per exposed block side', () => {
    expect(notch.size).toBe(4);
    expect(notch.extent).toBe(8);
    // 24 outer block sides, minus the removed block's 3, plus the 3 it exposes.
    expect(notch.faces).toHaveLength(24);
    for (const f of notch.faces) expect(cross(f.u, f.v)).toEqual(f.normal);
  });

  it('has flat seams, convex outer edges and three concave inner corners', () => {
    const sides = notch.faces.flatMap(f => f.sides);
    expect(sides.filter(s => s === 'concave')).toHaveLength(6); // 3 corners, seen from both faces
    expect(sides.filter(s => s === 'flat').length).toBeGreaterThan(0);
    // Convex: 12 cube edges split in two, minus the 3 halves cut away, plus the
    // 6 around the notch. Concave: the notch's 3 inner corners.
    expect(notch.edges.filter(e => e.crossing === 'convex')).toHaveLength(27);
    expect(notch.edges.filter(e => e.crossing === 'concave')).toHaveLength(3);
  });

  it('rounds an odd grid up so blocks divide it evenly', () => {
    expect(buildFigure('notch', 7).size).toBe(4);
  });
});

describe('neighbor', () => {
  it('moves within a face', () => {
    const cube = buildCube(3);
    expect(neighbor(cube, { face: 2, row: 1, col: 1 }, 0)).toEqual({ cell: { face: 2, row: 0, col: 1 }, dir: 0, crossing: 'flat' });
  });

  it('folds over a convex edge: front onto top', () => {
    const cube = buildCube(3);
    // Front is face 0, top is face 4; the top face's last row borders the front.
    expect(neighbor(cube, { face: 0, row: 0, col: 1 }, 0)).toEqual({ cell: { face: 4, row: 2, col: 1 }, dir: 0, crossing: 'convex' });
  });

  it('climbs a concave corner onto the wall ahead', () => {
    const notch = buildFigure('notch', 4);
    // Find a face side marked concave and step over it from its middle.
    const f = notch.faces.findIndex(face => face.sides.includes('concave'));
    const dir = notch.faces[f].sides.indexOf('concave') as 0 | 1 | 2 | 3;
    const from: Cell = [{ face: f, row: 0, col: 1 }, { face: f, row: 1, col: 1 }, { face: f, row: 1, col: 1 }, { face: f, row: 1, col: 0 }][dir];
    const there = neighbor(notch, from, dir);
    expect(there.crossing).toBe('concave');
    // The wall faces back toward where the arrow came from, and the arrow
    // heads up it, out along the old face's normal.
    expect(notch.faces[there.cell.face].normal).toEqual(dirVector(notch.faces[f], dir).map(c => -c + 0));
    expect(dirVector(notch.faces[there.cell.face], there.dir)).toEqual(notch.faces[f].normal);
  });

  it.each(FIGURE_KINDS)('is undone by going the opposite way, everywhere on the %s', kind => {
    const figure = buildFigure(kind, 6);
    for (const cell of allCells(figure)) {
      for (const dir of DIRS) {
        const there = neighbor(figure, cell, dir);
        const back = neighbor(figure, there.cell, opposite(there.dir));
        expect(back.cell).toEqual(cell);
        expect(back.dir).toBe(opposite(dir));
        expect(back.crossing).toBe(there.crossing);
      }
    }
  });
});

describe('step', () => {
  const cube = buildCube(3);

  it('moves within the face', () => {
    expect(step(cube, { face: 2, row: 1, col: 1 }, 1)).toEqual({ kind: 'cell', cell: { face: 2, row: 1, col: 2 }, dir: 1 });
  });

  it('exits over an open edge', () => {
    expect(step(cube, { face: 2, row: 1, col: 2 }, 1)).toEqual({ kind: 'exit', edge: findEdge(cube, 2, 3) });
  });

  it('carries on over flat seams, and exits over concave corners like any edge', () => {
    const notch = buildFigure('notch', 4);
    const last = notch.size - 1;
    for (const [f, face] of notch.faces.entries()) {
      for (const dir of DIRS) {
        const boundary: Cell = [{ face: f, row: 0, col: 1 }, { face: f, row: 1, col: last }, { face: f, row: last, col: 1 }, { face: f, row: 1, col: 0 }][dir];
        expect(step(notch, boundary, dir).kind).toBe(face.sides[dir] === 'flat' ? 'cell' : 'exit');
      }
    }
  });
});
