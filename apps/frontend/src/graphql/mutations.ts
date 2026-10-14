import { gql } from '@apollo/client';
import type { Move } from '@arrow-puzzle/shared';

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
}

export const SUBMIT_ATTEMPT = gql`
  mutation SubmitAttempt($seed: Int!, $moves: [Int!]!, $timeMs: Int!, $size: Int!) {
    submitAttempt(seed: $seed, moves: $moves, timeMs: $timeMs, size: $size) {
      success
      score
      message
    }
  }
`;
