import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { generatePuzzle, replayMoves, checkWin, isValidOptions, scoreAttempt, type BlockedArrows, type EdgeLayout, type FigureKind, type Move } from '@arrow-puzzle/shared';

// The arguments mirror the shared contract: the seed and generation options
// (figure, size, maxLength, blockedArrows, edges) rebuild the board and its rules, the moves
// (tapped arrow ids) replay it.
const typeDefs = `#graphql
  type SubmitResponse {
    success: Boolean!
    score: Int
    message: String
  }

  # Mirrors BlockedArrows in packages/shared.
  enum BlockedArrows {
    return
    stay
  }

  # Mirrors FigureKind in packages/shared.
  enum FigureKind {
    cube
    notch
    step
    cross
    rhombic
  }

  # Mirrors EdgeLayout in packages/shared.
  enum EdgeLayout {
    plain
    few
    many
    crown
    girdle
    whirl
  }

  type Mutation {
    submitAttempt(seed: Int!, moves: [Int!]!, timeMs: Int!, figure: FigureKind!, size: Int!, maxLength: Int!, blockedArrows: BlockedArrows!, edges: EdgeLayout!): SubmitResponse!
  }

  type Query {
    _dummy: String
  }
`;

const resolvers = {
  Mutation: {
    submitAttempt: async (_: any, { seed, moves, timeMs, figure, size, maxLength, blockedArrows, edges }: { seed: number; moves: Move[]; timeMs: number; figure: FigureKind; size: number; maxLength: number; blockedArrows: BlockedArrows; edges: EdgeLayout }) => {
      try {
        // 0. Options come from the client; out-of-range ones could make
        //    generation arbitrarily expensive.
        const options = { figure, size, maxLength, blockedArrows, edges };
        if (!isValidOptions(options)) {
          return { success: false, score: 0, message: 'Invalid puzzle options.' };
        }

        // 1. Rehydrate the EXACT same puzzle using the seed
        const initialState = generatePuzzle(seed, options);

        // 2. Replay the exact moves from the client using the shared logic
        const finalState = replayMoves(initialState, moves);

        // 3. Verify if the final state is actually solved
        const isValid = checkWin(finalState);

        if (!isValid) {
          return {
            success: false,
            score: 0,
            message: 'Invalid move sequence detected. Cheating detected!'
          };
        }

        // 4. Score it: see packages/shared/src/score.ts for the criteria.
        const { score, accuracy, pace, bonus } = scoreAttempt(initialState.arrows.length, moves.length, timeMs, options);
        const percent = (x: number) => `${Math.round(x * 100)}%`;

        // 5. (Optional) Save to leaderboard here

        return {
          success: true,
          score,
          message: `Valid puzzle solved! Score: ${score} (accuracy ${percent(accuracy)}, pace ${percent(pace)}${bonus > 1 ? `, bonus ×${bonus}` : ''})`
        };
      } catch (error) {
        // Moves are untrusted input; anything the shared logic throws on must
        // become a failed attempt, never a crashed request.
        console.error('Server error:', error);
        return {
          success: false,
          score: 0,
          message: 'Server error processing attempt.'
        };
      }
    }
  }
};

// Apollo's own termination handling stops the server and then re-raises the
// signal, so the process always dies *by* SIGINT/SIGTERM and pnpm reports
// Ctrl+C as a failed command. Shutdown is handled below instead.
const server = new ApolloServer({ typeDefs, resolvers, stopOnTerminationSignals: false });

let stopping = false;
const shutdown = async (signal: NodeJS.Signals) => {
  // One Ctrl+C usually arrives more than once: the terminal signals the whole
  // process group, and wrappers such as `tsx watch` relay it to us as well.
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down...`);
  try {
    // Drains in-flight requests and closes the HTTP listener.
    await server.stop();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

const start = async () => {
  // 0.0.0.0 rather than the dual-stack default: see "Testing against a local
  // server on a real device" in the README (WSL2 + adb reverse).
  const { url } = await startStandaloneServer(server, { listen: { port: 4000, host: '0.0.0.0' } });
  console.log(`🚀 Apollo Server ready at ${url}`);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

start();
