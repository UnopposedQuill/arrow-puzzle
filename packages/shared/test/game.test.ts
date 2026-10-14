import {
  generatePuzzle, applyMove, traceMove, isValidMove, replayMoves, checkWin, isValidOptions, mulberry32,
  buildCube, buildFigure, cellKey, neighbor, DIRS, DEFAULT_OPTIONS, OPTION_LIMITS, FIGURE_KINDS,
  type Arrow, type BlockedArrows, type Cell, type FigureKind, type GameState,
} from '../src/index.js';

const c = (row: number, col: number, face = 0): Cell => ({ face, row, col });
const board = (size: number, arrows: Arrow[], blockedArrows: BlockedArrows = 'stay'): GameState =>
  ({ figure: buildCube(size), arrows, blockedArrows });
const solution = (state: GameState) => state.arrows.map(a => a.id).sort((a, b) => b - a);

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('isValidOptions', () => {
  it('accepts options within the limits', () => {
    expect(isValidOptions(DEFAULT_OPTIONS)).toBe(true);
    expect(isValidOptions({ figure: 'cube', size: OPTION_LIMITS.size.min, maxLength: OPTION_LIMITS.maxLength.min, blockedArrows: 'stay' })).toBe(true);
    expect(isValidOptions({ figure: 'notch', size: OPTION_LIMITS.size.max, maxLength: OPTION_LIMITS.maxLength.max, blockedArrows: 'return' })).toBe(true);
  });

  it('rejects out-of-range, fractional or unknown options', () => {
    expect(isValidOptions({ ...DEFAULT_OPTIONS, size: OPTION_LIMITS.size.min - 1 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, size: OPTION_LIMITS.size.max + 1 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, maxLength: OPTION_LIMITS.maxLength.max + 1 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, size: 2.5 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, blockedArrows: 'bounce' as BlockedArrows })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, figure: 'sphere' as FigureKind })).toBe(false);
  });
});

describe('generatePuzzle', () => {
  const options = { figure: 'cube' as const, size: 4, maxLength: 4, blockedArrows: 'stay' as const };

  it('is deterministic per seed', () => {
    expect(generatePuzzle(123, options)).toEqual(generatePuzzle(123, options));
    expect(generatePuzzle(123, options)).not.toEqual(generatePuzzle(124, options));
  });

  it('uses the default options when none are given', () => {
    const state = generatePuzzle(1);
    expect(DEFAULT_OPTIONS.size).toBeGreaterThanOrEqual(10);
    expect(state.figure.size).toBe(DEFAULT_OPTIONS.size);
    expect(state.blockedArrows).toBe('return');
  });

  it('carries the blocked-arrows rule into the state without changing the board', () => {
    const stay = generatePuzzle(77, options);
    const ret = generatePuzzle(77, { ...options, blockedArrows: 'return' });
    expect(stay.blockedArrows).toBe('stay');
    expect(ret.blockedArrows).toBe('return');
    expect(ret.arrows).toEqual(stay.arrows);
  });

  it('builds well-formed, non-overlapping arrows', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { arrows } = generatePuzzle(seed, options);
      expect(arrows.length).toBeGreaterThan(0);
      const keys = arrows.flatMap(a => a.cells.map(cellKey));
      expect(new Set(keys).size).toBe(keys.length);
      for (const a of arrows) {
        expect(a.cells.length).toBeGreaterThanOrEqual(1);
        expect(a.cells.length).toBeLessThanOrEqual(options.maxLength);
        // Consecutive cells are neighbours on the figure, possibly across an
        // edge, and the head points straight on from the cell behind it.
        const figure = buildFigure(options.figure, options.size);
        a.cells.slice(1).forEach((cell, i) => {
          expect(DIRS.map(d => neighbor(figure, a.cells[i], d).cell)).toContainEqual(cell);
        });
        if (a.cells.length > 1) {
          const [head, neck] = [a.cells[a.cells.length - 1], a.cells[a.cells.length - 2]];
          expect(DIRS.map(d => neighbor(figure, neck, d))).toContainEqual(expect.objectContaining({ cell: head, dir: a.dir }));
        }
      }
    }
  });

  it('makes long arrows, some of them spanning more than one face', () => {
    const { arrows } = generatePuzzle(3, DEFAULT_OPTIONS);
    const lengths = arrows.map(a => a.cells.length);
    expect(Math.max(...lengths)).toBe(DEFAULT_OPTIONS.maxLength);
    // Most arrows reach at least half of maxLength.
    expect(lengths.filter(l => l >= DEFAULT_OPTIONS.maxLength / 2).length).toBeGreaterThan(arrows.length / 2);
    expect(arrows.some(a => new Set(a.cells.map(c => c.face)).size > 1)).toBe(true);
  });

  it.each(FIGURE_KINDS)('fills a default-size %s densely and keeps it solvable', figure => {
    for (let seed = 0; seed < 5; seed++) {
      const state = generatePuzzle(seed, { ...DEFAULT_OPTIONS, figure });
      const filled = state.arrows.reduce((sum, a) => sum + a.cells.length, 0);
      // Placing arrows at both ends of the clearing order is what gets this
      // above ~80%; front-only placement left large empty patches.
      expect(filled / (state.figure.faces.length * state.figure.size ** 2)).toBeGreaterThan(0.85);
      expect(checkWin(replayMoves(state, solution(state)))).toBe(true);
    }
  });

  it('builds the figure the options ask for', () => {
    expect(generatePuzzle(1, { ...DEFAULT_OPTIONS, figure: 'notch' }).figure.kind).toBe('notch');
  });

  it('is always solvable by clearing arrows in reverse placement order', () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = generatePuzzle(seed, options);
      const moves = solution(state);
      // Every step of the solution clears exactly one arrow.
      let current = state;
      for (const move of moves) {
        const next = applyMove(current, move);
        expect(next.arrows).toHaveLength(current.arrows.length - 1);
        current = next;
      }
      expect(checkWin(current)).toBe(true);
    }
  });
});

describe('applyMove', () => {
  it('clears an arrow with a free path', () => {
    const state = board(3, [{ id: 0, cells: [c(2, 0), c(1, 0)], dir: 0 }]);
    expect(applyMove(state, 0).arrows).toEqual([]);
  });

  it('slides an arrow up to the arrow blocking it', () => {
    const blocker: Arrow = { id: 1, cells: [c(2, 2)], dir: 2 };
    const state = board(3, [{ id: 0, cells: [c(2, 0)], dir: 1 }, blocker]);
    expect(applyMove(state, 0).arrows).toEqual([{ id: 0, cells: [c(2, 1)], dir: 1 }, blocker]);
  });

  it('drags a bent body along the path of its head', () => {
    const blocker: Arrow = { id: 1, cells: [c(1, 3)], dir: 2 };
    const state = board(4, [{ id: 0, cells: [c(0, 0), c(1, 0), c(1, 1)], dir: 1 }, blocker]);
    expect(applyMove(state, 0).arrows[0].cells).toEqual([c(1, 0), c(1, 1), c(1, 2)]);
  });

  it('counts a tap on a blocked arrow as a move, though the board is unchanged', () => {
    const state = board(3, [{ id: 0, cells: [c(0, 0)], dir: 1 }, { id: 1, cells: [c(0, 1)], dir: 2 }]);
    expect(applyMove(state, 0)).toBe(state);
    expect(isValidMove(state, 0)).toBe(true);
    expect(isValidMove(state, 1)).toBe(true);
  });

  it('drags a body that spans two faces over the edge between them', () => {
    // Front is face 0 and top is face 4; front row 0 borders top row 2. The
    // body starts on the top face and turns down onto the front.
    const blocker: Arrow = { id: 1, cells: [c(2, 1)], dir: 1 };
    const state = board(3, [{ id: 0, cells: [c(1, 1, 4), c(2, 1, 4), c(0, 1)], dir: 2 }, blocker]);
    expect(applyMove(state, 0).arrows[0].cells).toEqual([c(2, 1, 4), c(0, 1), c(1, 1)]);
    // Unblocked, the whole arrow leaves through the front's bottom edge.
    expect(applyMove({ ...state, arrows: [state.arrows[0]] }, 0).arrows).toEqual([]);
  });

  it('is blocked by its own body, but not by its own tail', () => {
    const curled = board(3, [{ id: 0, cells: [c(0, 2), c(0, 1), c(0, 0), c(1, 0), c(1, 1)], dir: 0 }]);
    expect(applyMove(curled, 0)).toBe(curled);
    // A closed ring chases its own tail out of the face.
    const ring = board(3, [{ id: 0, cells: [c(0, 1), c(0, 0), c(1, 0), c(1, 1)], dir: 0 }]);
    expect(applyMove(ring, 0).arrows).toEqual([]);
  });

  it('ignores unknown or already cleared arrows, which are not moves', () => {
    const state = board(3, [{ id: 0, cells: [c(0, 0)], dir: 0 }]);
    expect(applyMove(state, 7)).toBe(state);
    expect(isValidMove(state, 7)).toBe(false);
    const cleared = applyMove(state, 0);
    expect(applyMove(cleared, 0)).toBe(cleared);
    expect(isValidMove(cleared, 0)).toBe(false);
  });

  it('never mutates its input', () => {
    const state = generatePuzzle(9, { figure: 'cube', size: 3, maxLength: 3, blockedArrows: 'stay' });
    const before = JSON.parse(JSON.stringify(state));
    state.arrows.forEach(a => applyMove(state, a.id));
    expect(state).toEqual(before);
  });
});

describe('traceMove', () => {
  it('lists every cell the head slides through, and how the slide ends', () => {
    const blocker: Arrow = { id: 1, cells: [c(0, 3)], dir: 2 };
    const state = board(4, [{ id: 0, cells: [c(0, 0)], dir: 1 }, blocker]);
    expect(traceMove(state, 0)).toEqual({
      arrow: state.arrows[0],
      path: [{ cell: c(0, 1), dir: 1 }, { cell: c(0, 2), dir: 1 }],
      exited: false,
    });
    expect(traceMove({ ...state, arrows: [state.arrows[0]] }, 0)).toMatchObject({ exited: true });
    expect(traceMove(state, 9)).toBeNull();
  });

  it('clears an arrow heading into the notch at the inner corner', () => {
    // 4x4-cell faces.
    const state: GameState = { figure: buildFigure('notch', 8), arrows: [], blockedArrows: 'return' };
    const { faces } = state.figure;
    // A one-cell arrow two cells from a concave corner, heading into it.
    const f = faces.findIndex(face => face.sides.includes('concave'));
    const dir = faces[f].sides.indexOf('concave') as 0 | 1 | 2 | 3;
    const head: Cell = [{ face: f, row: 1, col: 1 }, { face: f, row: 1, col: 2 }, { face: f, row: 2, col: 1 }, { face: f, row: 1, col: 1 }][dir];
    const arrow: Arrow = { id: 0, cells: [head], dir };
    const trace = traceMove({ ...state, arrows: [arrow] }, 0)!;
    // One step to the corner, then it leaves its side into the wall.
    expect(trace.path).toHaveLength(1);
    expect(trace.path[0].cell.face).toBe(f);
    expect(trace.exited).toBe(true);
  });

  it('carries an arrow straight over a flat seam', () => {
    const figure = buildFigure('notch', 4);
    const f = figure.faces.findIndex(face => face.sides[1] === 'flat');
    const arrow: Arrow = { id: 0, cells: [{ face: f, row: 0, col: figure.size - 1 }], dir: 1 };
    const trace = traceMove({ figure, arrows: [arrow], blockedArrows: 'return' }, 0)!;
    expect(trace.path[0].cell.face).not.toBe(f);
    expect(figure.faces[trace.path[0].cell.face].normal).toEqual(figure.faces[f].normal);
  });
});

describe("blockedArrows: 'return'", () => {
  it('sends a blocked arrow back to where it started, which still counts as a move', () => {
    const state = board(3, [{ id: 0, cells: [c(2, 0)], dir: 1 }, { id: 1, cells: [c(2, 2)], dir: 2 }], 'return');
    expect(applyMove(state, 0)).toBe(state);
    expect(isValidMove(state, 0)).toBe(true);
  });

  it('still clears arrows with a free path', () => {
    const state = board(3, [{ id: 0, cells: [c(2, 0)], dir: 1 }], 'return');
    expect(applyMove(state, 0).arrows).toEqual([]);
  });

  it('can never deadlock: any sequence of taps leaves the board solvable', () => {
    const options = { figure: 'cube' as const, size: 4, maxLength: 4, blockedArrows: 'return' as const };
    for (let seed = 0; seed < 20; seed++) {
      const rand = mulberry32(seed);
      let state = generatePuzzle(seed, options);
      // Tap arrows at random for a while, blocked ones included.
      for (let i = 0; i < 40 && state.arrows.length > 0; i++) {
        state = applyMove(state, state.arrows[Math.floor(rand() * state.arrows.length)].id);
      }
      expect(checkWin(replayMoves(state, solution(state)))).toBe(true);
    }
  });
});

describe('win validation', () => {
  const options = { figure: 'cube' as const, size: 3, maxLength: 3, blockedArrows: 'stay' as const };

  it('proves a win from seed and moves alone', () => {
    const moves = solution(generatePuzzle(2024, options));
    expect(checkWin(replayMoves(generatePuzzle(2024, options), moves))).toBe(true);
  });

  it('rejects an empty, fabricated or incomplete move list', () => {
    const state = generatePuzzle(5, options);
    expect(checkWin(replayMoves(state, []))).toBe(false);
    expect(checkWin(replayMoves(state, [-1, 999, 0.5]))).toBe(false);
    expect(checkWin(replayMoves(state, solution(state).slice(0, -1)))).toBe(false);
  });
});
