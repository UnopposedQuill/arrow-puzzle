// Scoring a solved puzzle.
//
// Every arrow needs exactly one tap that clears it, so a board's minimum move
// count is its number of arrows, and every move beyond that was a blocked
// attempt. The score rewards clearing a big board accurately, at a fair pace:
//
//   accuracy = arrows / moves                 1 with no blocked attempts
//   pace     = clamp(target / time, 0.5, 1)   slow play at most halves it
//   score    = arrows x POINTS_PER_ARROW x accuracy x pace x bonuses
//
// Bigger boards hold more arrows, so harder settings are worth more. The
// notched cube multiplies the score: its inner walls change how the board
// reads. The blocked-arrows rule earns nothing: under 'stay' a near-miss can
// leave the board unfinishable, which is risk, not challenge (no board needs a
// deliberate push to solve).
import type { PuzzleOptions } from './game.js';

export const POINTS_PER_ARROW = 10;
// Target pace: a game at or under arrows x this keeps its full score.
export const TARGET_MS_PER_ARROW = 2500;
// Slowest play keeps at least this share of the score.
export const MIN_PACE = 0.5;
export const BONUSES = {
  notch: 1.25,
} as const;

export interface Score {
  score: number;
  accuracy: number;
  pace: number;
  bonus: number;
}

export function scoreAttempt(arrows: number, moves: number, timeMs: number, options: PuzzleOptions): Score {
  const accuracy = arrows / Math.max(moves, arrows);
  const target = arrows * TARGET_MS_PER_ARROW;
  const pace = timeMs <= target ? 1 : Math.max(MIN_PACE, target / timeMs);
  const bonus = options.figure === 'notch' ? BONUSES.notch : 1;
  return { score: Math.round(arrows * POINTS_PER_ARROW * accuracy * pace * bonus), accuracy, pace, bonus };
}
