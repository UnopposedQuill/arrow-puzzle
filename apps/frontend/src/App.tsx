// apps/frontend/src/App.tsx
//
// Generic game loop: generate from a random seed, apply moves locally with the
// shared logic, and on a win submit seed + options + moves for the server to
// replay. Only the board rendering and the click-to-move mapping are specific
// to the placeholder game in packages/shared -- replace those with the real game.
import { useState, useEffect } from 'react';
import { useMutation } from '@apollo/client/react';
import {
  generatePuzzle, applyMove, checkWin, isValidMove,
  type GameState,
  type Move,
} from '@arrow-puzzle/shared';
import { SUBMIT_ATTEMPT, type SubmitAttemptData, type SubmitAttemptVars } from './graphql/mutations';
import { CountStepper } from './components/CountStepper';
import './App.css';

const TITLE = 'Arrow Puzzle';
const MIN_SIZE = 1;
const MAX_SIZE = 24;

// Placeholder board: one tappable cell per entry in the state.
function Cell({ lit, onClick }: { lit: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: '50px', height: '50px', flex: '0 0 auto',
        boxSizing: 'border-box', border: '3px solid #333', borderRadius: '8px',
        background: lit ? '#f1c40f' : '#ecf0f1',
        cursor: lit ? 'pointer' : 'default', transition: 'background 0.2s',
      }}
    />
  );
}

function App() {
  const [state, setState] = useState<GameState>([]);
  const [startTime, setStartTime] = useState(Date.now());
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const [seed, setSeed] = useState(0);
  const [win, setWin] = useState(false);
  const [size, setSize] = useState(6);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [submitResult, setSubmitResult] = useState<{ score?: number | null; message?: string | null } | null>(null);

  const [submitAttempt] = useMutation<SubmitAttemptData, SubmitAttemptVars>(SUBMIT_ATTEMPT);

  const initGame = (nextSize: number) => {
    const newSeed = Math.floor(Math.random() * 1000000);
    setSeed(newSeed);
    setState(generatePuzzle(newSeed, { size: nextSize }));
    setStartTime(Date.now());
    setMoveHistory([]);
    setWin(false);
    setSubmitStatus('idle');
    setSubmitResult(null);
  };

  // Generate the first puzzle once. Regeneration is deliberate from here on
  // (New Game, or committing a settings change), so a half-typed number never
  // destroys the game in progress.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { initGame(size); }, []);

  const handleSizeCommit = (next: number) => {
    setSize(next);
    initGame(next);
  };

  const handleMove = (move: Move) => {
    if (win || !isValidMove(state, move)) return;

    const newState = applyMove(state, move);
    const newHistory = [...moveHistory, move];
    setState(newState);
    setMoveHistory(newHistory);

    if (checkWin(newState)) {
      setWin(true);
      setSubmitStatus('pending');
      const timeMs = Date.now() - startTime;
      submitAttempt({
        variables: { seed, moves: newHistory, timeMs, size }
      }).then(res => {
        setSubmitStatus('success');
        setSubmitResult(res.data?.submitAttempt ?? null);
      }).catch(err => {
        console.error('Server error:', err);
        setSubmitStatus('failed');
      });
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '16px 10px 8px', background: '#2c3e50',
      // dvh follows the visible viewport when the keyboard opens; border-box
      // keeps the padding inside it rather than past the screen.
      height: '100dvh', boxSizing: 'border-box',
      // The document must never scroll: with touch scrolling disabled for the
      // game, a focus-driven scrollIntoView would move content off-screen with
      // no way to bring it back. Only the board below scrolls.
      overflow: 'hidden',
    }}>
      <h1 style={{ color: 'white', margin: '0 0 8px', flex: '0 0 auto' }}>{TITLE}</h1>
      {win && <h2 style={{ color: 'gold' }}>✨ You Win! ✨</h2>}
      {submitStatus === 'pending' && <div style={{ color: '#aaa', fontSize: '14px' }}>Submitting score...</div>}
      {submitStatus === 'success' && (
        <div style={{ color: '#2ecc71', fontSize: '14px' }}>
          {submitResult?.message ?? `Score: ${submitResult?.score}`}
        </div>
      )}
      {submitStatus === 'failed' && (
        <div style={{ color: '#e67e22', fontSize: '14px' }}>
          ⚠️ Offline — score not submitted
        </div>
      )}
      <div style={{
        display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center',
        alignContent: 'flex-start', marginTop: '20px', width: '100%',
        // Takes the space the header and controls don't. min-height:0 lets a
        // flex child actually shrink below its content size, which is what
        // makes overflow-y work here at all.
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
        // Re-enable vertical panning; the global rule sets touch-action:none
        // to stop the page bouncing during play.
        touchAction: 'pan-y',
      }}>
        {state.map((lit, idx) => (
          <Cell key={idx} lit={lit} onClick={() => handleMove(idx)} />
        ))}
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '12px', marginTop: '18px', marginBottom: '4px', flex: '0 0 auto',
      }}>
        <button onClick={() => initGame(size)} style={{ padding: '11px 30px', fontSize: '16px', cursor: 'pointer' }}>
          New Game
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <CountStepper label="Size" value={size} min={MIN_SIZE} max={MAX_SIZE} onCommit={handleSizeCommit} />
        </div>
      </div>
      <div style={{ color: '#aaa', marginTop: '10px', fontSize: '14px', flex: '0 0 auto' }}>Moves: {moveHistory.length}</div>
    </div>
  );
}

export default App;
