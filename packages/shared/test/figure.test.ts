import { buildCube, crossEdge, step, neighbor, opposite, findEdge, dirVector, DIRS, type Cell, type Vec3 } from '../src/index.js';

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1] + 0,
  a[2] * b[0] - a[0] * b[2] + 0,
  a[0] * b[1] - a[1] * b[0] + 0,
];

describe('buildCube', () => {
  const cube = buildCube(3);

  it('has six right-handed face frames', () => {
    expect(cube.faces).toHaveLength(6);
    // u x v = normal keeps every face's front side facing outwards, which the
    // frontend relies on for backface culling.
    for (const f of cube.faces) expect(cross(f.u, f.v)).toEqual(f.normal);
  });

  it('joins every face to exactly four others with open edges', () => {
    expect(cube.edges).toHaveLength(12);
    cube.faces.forEach((_, i) => {
      expect(cube.edges.filter(e => e.faces.includes(i))).toHaveLength(4);
    });
    expect(cube.edges.every(e => e.type === 'open')).toBe(true);
  });

  it('finds an edge from either side', () => {
    const [a, b] = cube.edges[0].faces;
    expect(findEdge(cube, b, a)).toBe(cube.edges[0]);
  });
});

describe('crossEdge', () => {
  it('folds the front face onto the top one', () => {
    const cube = buildCube(3);
    // Front is face 0, top is face 4; the top face's last row borders the front.
    expect(crossEdge(cube, { face: 0, row: 0, col: 1 }, 0)).toMatchObject({
      cell: { face: 4, row: 2, col: 1 },
      dir: 0,
      edge: findEdge(cube, 0, 4),
    });
  });

  it('is undone by crossing back, for every boundary cell of every face', () => {
    const n = 4;
    const cube = buildCube(n);
    cube.faces.forEach((face, f) => {
      for (const dir of DIRS) {
        for (let i = 0; i < n; i++) {
          const cell: Cell = [
            { face: f, row: 0, col: i },
            { face: f, row: i, col: n - 1 },
            { face: f, row: n - 1, col: i },
            { face: f, row: i, col: 0 },
          ][dir];
          const there = crossEdge(cube, cell, dir);
          // Lands on the face the step pointed at, heading away from the edge.
          expect(cube.faces[there.cell.face].normal).toEqual(dirVector(face, dir));
          const back = crossEdge(cube, there.cell, opposite(there.dir));
          expect(back.cell).toEqual(cell);
          expect(back.dir).toBe(opposite(dir));
          expect(back.edge).toBe(there.edge);
        }
      }
    });
  });
});

describe('neighbor', () => {
  const cube = buildCube(3);

  it('moves within the face', () => {
    expect(neighbor(cube, { face: 2, row: 1, col: 1 }, 0)).toEqual({ cell: { face: 2, row: 0, col: 1 }, dir: 0 });
  });

  it('crosses an edge regardless of its type', () => {
    const { cell, dir } = crossEdge(cube, { face: 0, row: 0, col: 1 }, 0);
    expect(neighbor(cube, { face: 0, row: 0, col: 1 }, 0)).toEqual({ cell, dir });
  });

  it('is undone by going the opposite way', () => {
    for (const dir of DIRS) {
      const there = neighbor(cube, { face: 5, row: 0, col: 0 }, dir);
      expect(neighbor(cube, there.cell, opposite(there.dir))).toEqual({ cell: { face: 5, row: 0, col: 0 }, dir: opposite(dir) });
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
});
