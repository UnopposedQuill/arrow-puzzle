import {
  buildCube, buildFigure, neighbor, opposite, step, findEdge, dirVector, sideSegments, DIRS, FIGURE_KINDS,
  type Cell, type Dir, type EdgeType, type Figure, type Vec3,
} from '../src/index.js';

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1] + 0,
  a[2] * b[0] - a[0] * b[2] + 0,
  a[0] * b[1] - a[1] * b[0] + 0,
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const allCells = (figure: Figure): Cell[] => figure.faces.flatMap((_, face) =>
  Array.from({ length: figure.size ** 2 }, (_, i) => ({ face, row: Math.floor(i / figure.size), col: i % figure.size })));

const count = (figure: Figure, crossing: string) => figure.edges.filter(e => e.crossing === crossing).length;

// The cube's front face is 0 and its top face 4; front row 0 borders top's last row.
const withEdge = (size: number, a: number, b: number, type: EdgeType, along?: 1 | -1): Figure => {
  const figure = buildCube(size);
  findEdge(figure, a, b)!.segments = [{ from: 0, to: size, type, along }];
  return figure;
};

describe('figures', () => {
  it.each(FIGURE_KINDS)('the %s has outward, consistent face frames', kind => {
    const figure = buildFigure(kind, 8);
    for (const f of figure.faces) {
      // u x v points along the outward normal, which the frontend relies on.
      expect(dot(cross(f.u, f.v), f.normal)).toBeGreaterThan(0);
      // Every face is `size` units a side, so a cell is one unit.
      expect(Math.hypot(...f.u)).toBeCloseTo(figure.size);
      expect(Math.hypot(...f.v)).toBeCloseTo(figure.size);
    }
  });

  it.each(FIGURE_KINDS)('the %s links every side both ways, consistently', kind => {
    const figure = buildFigure(kind, 8);
    figure.faces.forEach((face, f) => {
      for (const side of DIRS) {
        const link = face.links[side];
        const back = figure.faces[link.face].links[link.side];
        expect([back.face, back.side, back.reversed, back.crossing, back.edge]).toEqual([f, side, link.reversed, link.crossing, link.edge]);
        expect(face.sides[side]).toBe(link.crossing);
        expect(link.edge === null).toBe(link.crossing === 'flat');
      }
    });
  });

  it('cube: six square faces, twelve outer edges', () => {
    const cube = buildCube(3);
    expect([cube.faces.length, cube.size, cube.extent]).toEqual([6, 3, 3]);
    expect([count(cube, 'convex'), count(cube, 'concave')]).toEqual([12, 0]);
    expect(cube.edges.every(e => e.segments.length === 1 && e.segments[0].type === 'open')).toBe(true);
  });

  it('notch: a 2x2x2 with one corner block gone', () => {
    const notch = buildFigure('notch', 8);
    expect([notch.faces.length, notch.size, notch.extent]).toEqual([24, 4, 8]);
    // Convex: 12 cube edges split in two, minus the 3 halves cut away, plus the
    // 6 around the notch. Concave: the notch's 3 inner corners.
    expect([count(notch, 'convex'), count(notch, 'concave')]).toEqual([27, 3]);
  });

  it('step: a 2x2x2 with the two top-front blocks gone', () => {
    const stepFigure = buildFigure('step', 8);
    // 6 blocks x 6 sides, minus 2 for each of the 7 touching pairs.
    expect(stepFigure.faces).toHaveLength(22);
    // The one long inner corner, in two halves.
    expect(count(stepFigure, 'concave')).toBe(2);
  });

  it('cross: the centre of a 3x3x3 and its six face blocks', () => {
    const plus = buildFigure('cross', 9);
    expect([plus.faces.length, plus.size, plus.extent]).toEqual([30, 3, 9]);
    // Each arm: 4 around its cap and 4 along its length; each of the 12 pairs
    // of neighbouring arms meets at one inner corner.
    expect([count(plus, 'convex'), count(plus, 'concave')]).toEqual([48, 12]);
  });

  it('rhombic dodecahedron: twelve rhombi, all edges outer', () => {
    const rhombic = buildFigure('rhombic', 8);
    expect([rhombic.faces.length, rhombic.size]).toEqual([12, 4]);
    expect([count(rhombic, 'convex'), count(rhombic, 'concave')]).toEqual([24, 0]);
    // Rhombi, not squares: the sides meet at ~70.5 and ~109.5 degrees.
    const f = rhombic.faces[0];
    const cos = dot(f.u, f.v) / (Math.hypot(...f.u) * Math.hypot(...f.v));
    expect(Math.abs(cos)).toBeCloseTo(1 / 3);
  });

  it('rounds the grid up so blocks divide it evenly', () => {
    expect(buildFigure('notch', 7).size).toBe(4);
    expect(buildFigure('cross', 16).size).toBe(6);
  });

  it('finds an edge from either side, and none between faces that never meet', () => {
    const cube = buildCube(3);
    const [a, b] = cube.edges[0].faces;
    expect(findEdge(cube, b, a)).toBe(cube.edges[0]);
    expect(findEdge(cube, 0, 2)).toBeUndefined();
  });
});

describe('segments', () => {
  // The front-top edge split: a mirror on its first cell, open on the rest.
  const split = (): Figure => {
    const figure = buildCube(3);
    findEdge(figure, 0, 4)!.segments = [{ from: 0, to: 1, type: 'mirror' }, { from: 1, to: 3, type: 'open' }];
    return figure;
  };

  it('are seen in the same places from both faces of an edge', () => {
    const figure = split();
    const front = sideSegments(figure, 0, 0);
    const across = figure.faces[0].links[0];
    const top = sideSegments(figure, across.face, across.side);
    for (let k = 0; k < 3; k++) {
      // The cell on the far side of the edge from front cell (0, k).
      const there = neighbor(figure, { face: 0, row: 0, col: k }, 0).cell;
      const kThere = across.side % 2 === 0 ? there.col : there.row;
      expect(top.find(s => kThere >= s.from && kThere < s.to)!.segment)
        .toBe(front.find(s => k >= s.from && k < s.to)!.segment);
    }
  });

  it('cover a flat side with nothing', () => {
    expect(sideSegments(buildFigure('notch', 4), 0, buildFigure('notch', 4).faces[0].sides.indexOf('flat') as Dir)).toEqual([]);
  });

  it('decide what a head does where it meets the edge', () => {
    const figure = split();
    const typeAt = (k: number) => sideSegments(figure, 0, 0).find(s => k >= s.from && k < s.to)!.segment.type;
    // Wherever the mirror cell falls on the front, a head there bounces and
    // one on the open part leaves.
    for (let k = 0; k < 3; k++) {
      const result = step(figure, { face: 0, row: 0, col: k }, 0);
      expect(result.kind).toBe(typeAt(k) === 'mirror' ? 'cell' : 'exit');
    }
  });
});

describe('neighbor', () => {
  it('moves within a face', () => {
    expect(neighbor(buildCube(3), { face: 2, row: 1, col: 1 }, 0)).toEqual({ cell: { face: 2, row: 0, col: 1 }, dir: 0, crossing: 'flat' });
  });

  it('folds over a convex edge: front onto top', () => {
    expect(neighbor(buildCube(3), { face: 0, row: 0, col: 1 }, 0)).toEqual({ cell: { face: 4, row: 2, col: 1 }, dir: 0, crossing: 'convex' });
  });

  it('climbs a concave corner onto the wall ahead', () => {
    const notch = buildFigure('notch', 8);
    const f = notch.faces.findIndex(face => face.sides.includes('concave'));
    const dir = notch.faces[f].sides.indexOf('concave') as Dir;
    const from: Cell = [{ face: f, row: 0, col: 1 }, { face: f, row: 1, col: 3 }, { face: f, row: 3, col: 1 }, { face: f, row: 1, col: 0 }][dir];
    const there = neighbor(notch, from, dir);
    expect(there.crossing).toBe('concave');
    // The wall faces back toward where the arrow came from, and the arrow
    // heads up it, out along the old face's normal.
    expect(dot(notch.faces[there.cell.face].normal, dirVector(notch.faces[f], dir))).toBeLessThan(0);
    expect(dot(dirVector(notch.faces[there.cell.face], there.dir), notch.faces[f].normal)).toBeGreaterThan(0);
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
  const top: Cell = { face: 0, row: 0, col: 1 };

  it('moves within the face', () => {
    expect(step(buildCube(3), { face: 2, row: 1, col: 1 }, 1)).toEqual({ kind: 'cell', cell: { face: 2, row: 1, col: 2 }, dir: 1 });
  });

  it('exits over an open edge', () => {
    const cube = buildCube(3);
    expect(step(cube, { face: 2, row: 1, col: 2 }, 1)).toEqual({ kind: 'exit', edge: findEdge(cube, 2, 3), dir: 1 });
  });

  it('carries on over flat seams, and exits over concave corners like any open edge', () => {
    const notch = buildFigure('notch', 8);
    const last = notch.size - 1;
    for (const [f, face] of notch.faces.entries()) {
      for (const dir of DIRS) {
        const boundary: Cell = [{ face: f, row: 0, col: 1 }, { face: f, row: 1, col: last }, { face: f, row: last, col: 1 }, { face: f, row: 1, col: 0 }][dir];
        expect(step(notch, boundary, dir).kind).toBe(face.sides[dir] === 'flat' ? 'cell' : 'exit');
      }
    }
  });

  it('sticky: carries the head onto the next face', () => {
    expect(step(withEdge(3, 0, 4, 'sticky'), top, 0)).toEqual({ kind: 'cell', cell: { face: 4, row: 2, col: 1 }, dir: 0 });
  });

  it('mirror: sends the head straight back', () => {
    expect(step(withEdge(3, 0, 4, 'mirror'), top, 0)).toEqual({ kind: 'cell', cell: { face: 0, row: 1, col: 1 }, dir: 2 });
  });

  it('turn: sends the head along the edge, the way the edge points, from either side', () => {
    // Along +1 runs toward higher columns on the front's top side.
    const figure = withEdge(3, 0, 4, 'turn', 1);
    expect(step(figure, top, 0)).toEqual({ kind: 'cell', cell: { face: 0, row: 0, col: 2 }, dir: 1 });
    // From the top face the same edge turns the head the same way in space.
    const fromTop = step(figure, { face: 4, row: 2, col: 1 }, 2);
    expect(fromTop.kind).toBe('cell');
    expect(fromTop.kind === 'cell' && dirVector(figure.faces[4], fromTop.dir)).toEqual(dirVector(figure.faces[0], 1));
  });

  it('turn into an open edge at a corner leaves over that edge, heading the turned way', () => {
    const figure = withEdge(3, 0, 4, 'turn', 1);
    expect(step(figure, { face: 0, row: 0, col: 2 }, 0)).toEqual({ kind: 'exit', edge: findEdge(figure, 0, 1), dir: 1 });
  });

  it('gets stuck when edges keep redirecting the head on the spot', () => {
    // Top side turns toward the right side, which turns back up.
    const figure = withEdge(3, 0, 4, 'turn', 1);
    const right = findEdge(figure, 0, 1)!;
    const rightAlong = right.faces[0] === 0 ? -1 : (figure.faces[0].links[1].reversed ? 1 : -1);
    right.segments = [{ from: 0, to: 3, type: 'turn', along: rightAlong }];
    expect(step(figure, { face: 0, row: 0, col: 2 }, 0)).toEqual({ kind: 'stuck' });
  });
});
