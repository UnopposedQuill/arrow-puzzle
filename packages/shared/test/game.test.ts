import {
  generatePuzzle, applyMove, isValidMove, replayMoves, checkWin, isValidOptions, mulberry32,
  buildCube, cellKey, DIR_DELTAS, DEFAULT_OPTIONS, OPTION_LIMITS,
  type Arrow, type BlockedArrows, type Cell, type GameState,
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
    expect(isValidOptions({ size: OPTION_LIMITS.size.min, maxLength: OPTION_LIMITS.maxLength.min, blockedArrows: 'stay' })).toBe(true);
    expect(isValidOptions({ size: OPTION_LIMITS.size.max, maxLength: OPTION_LIMITS.maxLength.max, blockedArrows: 'return' })).toBe(true);
  });

  it('rejects out-of-range, fractional or unknown options', () => {
    expect(isValidOptions({ ...DEFAULT_OPTIONS, size: OPTION_LIMITS.size.min - 1 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, size: OPTION_LIMITS.size.max + 1 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, maxLength: OPTION_LIMITS.maxLength.max + 1 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, size: 2.5 })).toBe(false);
    expect(isValidOptions({ ...DEFAULT_OPTIONS, blockedArrows: 'bounce' as BlockedArrows })).toBe(false);
  });
});

describe('generatePuzzle', () => {
  const options = { size: 4, maxLength: 4, blockedArrows: 'stay' as const };

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
        // Consecutive cells are neighbours on one face, and the head points
        // straight on from the cell behind it.
        a.cells.slice(1).forEach((cell, i) => {
          const prev = a.cells[i];
          expect(cell.face).toBe(prev.face);
          expect(Math.abs(cell.row - prev.row) + Math.abs(cell.col - prev.col)).toBe(1);
        });
        if (a.cells.length > 1) {
          const [head, neck] = [a.cells[a.cells.length - 1], a.cells[a.cells.length - 2]];
          expect([head.row - neck.row, head.col - neck.col]).toEqual([...DIR_DELTAS[a.dir]]);
        }
      }
    }
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
    const state = generatePuzzle(9, { size: 3, maxLength: 3, blockedArrows: 'stay' });
    const before = JSON.parse(JSON.stringify(state));
    state.arrows.forEach(a => applyMove(state, a.id));
    expect(state).toEqual(before);
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
    const options = { size: 4, maxLength: 4, blockedArrows: 'return' as const };
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
  const options = { size: 3, maxLength: 3, blockedArrows: 'stay' as const };

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
