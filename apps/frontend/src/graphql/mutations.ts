import { gql } from '@apollo/client';
import type { BlockedArrows, Move } from '@arrow-puzzle/shared';

export interface SubmitAttemptData {
  submitAttempt: {
    success: boolean;
    score: number | null;
    message: string | null;
  };
}

// Keep in sync with the submitAttempt signature in apps/server/src/index.ts.
export interface SubmitAttemptVars {
  seed: number;
  moves: Move[];
  timeMs: number;
  size: number;
  maxLength: number;
  blockedArrows: BlockedArrows;
}

export const SUBMIT_ATTEMPT = gql`
  mutation SubmitAttempt($seed: Int!, $moves: [Int!]!, $timeMs: Int!, $size: Int!, $maxLength: Int!, $blockedArrows: BlockedArrows!) {
    submitAttempt(seed: $seed, moves: $moves, timeMs: $timeMs, size: $size, maxLength: $maxLength, blockedArrows: $blockedArrows) {
      success
      score
      message
    }
  }
`;
