import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { generatePuzzle, replayMoves, checkWin, type Move } from '@arrow-puzzle/shared';

// The arguments mirror the shared contract: the seed and generation options
// rebuild the board, the moves replay it. Adjust `moves` and the option
// arguments when the shared Move / PuzzleOptions types change.
const typeDefs = `#graphql
  type SubmitResponse {
    success: Boolean!
    score: Int
    message: String
  }

  type Mutation {
    submitAttempt(seed: Int!, moves: [Int!]!, timeMs: Int!, size: Int!): SubmitResponse!
  }

  type Query {
    _dummy: String
  }
`;

const resolvers = {
  Mutation: {
    submitAttempt: async (_: any, { seed, moves, timeMs, size }: { seed: number; moves: Move[]; timeMs: number; size: number }) => {
      try {
        // 1. Rehydrate the EXACT same puzzle using the seed
        const initialState = generatePuzzle(seed, { size });

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

        // 4. Calculate score: fewer moves + faster time = higher score
        const score = Math.max(0, 1000 - moves.length * 5 - Math.floor(timeMs / 1000));

        // 5. (Optional) Save to leaderboard here

        return {
          success: true,
          score,
          message: `Valid puzzle solved! Score: ${score}`
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

const server = new ApolloServer({ typeDefs, resolvers });

const start = async () => {
  // 0.0.0.0 rather than the dual-stack default: see "Testing against a local
  // server on a real device" in the README (WSL2 + adb reverse).
  const { url } = await startStandaloneServer(server, { listen: { port: 4000, host: '0.0.0.0' } });
  console.log(`🚀 Apollo Server ready at ${url}`);
};

start();
