// Placeholder suite for the placeholder game in src/index.ts. Replace it along
// with the game, but keep the two properties it checks: generation is
// deterministic per seed, and a win can be proven from seed + moves alone.
import {
  mulberry32, generatePuzzle, isValidMove, applyMove, replayMoves, checkWin,
  DEFAULT_OPTIONS, type Move,
} from '../src/index.js';

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('stays within [0, 1)', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const n = rand();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('generatePuzzle', () => {
  it('is deterministic per seed', () => {
    expect(generatePuzzle(123, { size: 10 })).toEqual(generatePuzzle(123, { size: 10 }));
  });

  it('uses the default options when none are given', () => {
    expect(generatePuzzle(1)).toHaveLength(DEFAULT_OPTIONS.size);
  });

  it('never generates an already-solved board', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(checkWin(generatePuzzle(seed, { size: 1 }))).toBe(false);
    }
  });
});

describe('moves', () => {
  const state = [true, false, true];

  it('accepts only in-range moves on lit cells', () => {
    expect(isValidMove(state, 0)).toBe(true);
    expect(isValidMove(state, 1)).toBe(false);
    expect(isValidMove(state, -1)).toBe(false);
    expect(isValidMove(state, 3)).toBe(false);
    expect(isValidMove(state, 0.5)).toBe(false);
  });

  it('applies a valid move without mutating the input', () => {
    expect(applyMove(state, 2)).toEqual([true, false, false]);
    expect(state).toEqual([true, false, true]);
  });

  it('ignores an invalid move', () => {
    expect(applyMove(state, 99)).toBe(state);
  });
});

describe('win validation', () => {
  it('proves a win from seed and moves alone', () => {
    const seed = 2024;
    const board = generatePuzzle(seed, { size: 8 });
    const moves: Move[] = board.flatMap((lit, i) => (lit ? [i] : []));
    expect(checkWin(replayMoves(generatePuzzle(seed, { size: 8 }), moves))).toBe(true);
  });

  it('rejects an empty or fabricated move list', () => {
    const board = generatePuzzle(5, { size: 8 });
    expect(checkWin(replayMoves(board, []))).toBe(false);
    expect(checkWin(replayMoves(board, [100, -3]))).toBe(false);
  });
});
