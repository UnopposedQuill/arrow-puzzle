// packages/shared/src/index.ts
//
// Pure, deterministic game logic shared verbatim by the frontend and the server.
//
// The architecture rests on one contract: the server never receives the board,
// only a seed, the generation options and the move list. It regenerates the
// board from the seed, replays the moves and decides whether the result is a
// win. Every game built on this scaffold implements the same five pieces:
//
//   generatePuzzle(seed, options) -> GameState   (must be deterministic)
//   isValidMove(state, move)      -> boolean
//   applyMove(state, move)        -> GameState   (pure, never mutates)
//   replayMoves(initial, moves)   -> GameState
//   checkWin(state)               -> boolean
//
// The implementation below is a PLACEHOLDER game so the whole pipeline runs end
// to end: a row of lit cells, each move switches one off, and the board is won
// when every cell is off. Replace GameState, Move, PuzzleOptions and the bodies
// of the functions with the real game.

export type GameState = boolean[];
export type Move = number;

export interface PuzzleOptions {
  size: number;
}

export const DEFAULT_OPTIONS: PuzzleOptions = { size: 6 };

// --- Seeded PRNG (mulberry32) ---
// Use this, never Math.random(), anywhere generation needs randomness: the
// server has to reproduce the exact same board from the seed alone.
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Generation ---
export function generatePuzzle(seed: number, options: PuzzleOptions = DEFAULT_OPTIONS): GameState {
  const rand = mulberry32(seed);
  const state = Array.from({ length: options.size }, () => rand() < 0.5);
  // Guarantee there is something to solve.
  if (!state.some(Boolean)) state[Math.floor(rand() * options.size)] = true;
  return state;
}

// --- Validation & Logic ---
// Moves arrive from the client and are untrusted: reject anything out of range
// instead of throwing.
export function isValidMove(state: GameState, move: Move): boolean {
  return Number.isInteger(move) && move >= 0 && move < state.length && state[move];
}

export function applyMove(state: GameState, move: Move): GameState {
  if (!isValidMove(state, move)) return state;
  const next = [...state];
  next[move] = false;
  return next;
}

export function replayMoves(initialState: GameState, moves: Move[]): GameState {
  return moves.reduce(applyMove, initialState);
}

export function checkWin(state: GameState): boolean {
  return state.every(cell => !cell);
}
