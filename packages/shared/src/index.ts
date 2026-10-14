// packages/shared/src/index.ts
//
// Pure, deterministic game logic shared verbatim by the frontend and the server.
//
// The server never receives the board, only a seed, the generation options and
// the move list. It regenerates the board from the seed, replays the moves and
// decides whether the result is a win:
//
//   generatePuzzle(seed, options) -> GameState   (must be deterministic)
//   isValidMove(state, move)      -> boolean
//   applyMove(state, move)        -> GameState   (pure, never mutates)
//   replayMoves(initial, moves)   -> GameState
//   checkWin(state)               -> boolean
export * from './rng.js';
export * from './figure.js';
export * from './game.js';
