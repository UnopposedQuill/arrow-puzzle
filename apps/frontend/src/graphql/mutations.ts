import { gql } from '@apollo/client';
import type { BlockedArrows, EdgeLayout, FigureKind, Move } from '@arrow-puzzle/shared';

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
  figure: FigureKind;
  size: number;
  maxLength: number;
  blockedArrows: BlockedArrows;
  edges: EdgeLayout;
}

export const SUBMIT_ATTEMPT = gql`
  mutation SubmitAttempt($seed: Int!, $moves: [Int!]!, $timeMs: Int!, $figure: FigureKind!, $size: Int!, $maxLength: Int!, $blockedArrows: BlockedArrows!, $edges: EdgeLayout!) {
    submitAttempt(seed: $seed, moves: $moves, timeMs: $timeMs, figure: $figure, size: $size, maxLength: $maxLength, blockedArrows: $blockedArrows, edges: $edges) {
      success
      score
      message
    }
  }
`;
