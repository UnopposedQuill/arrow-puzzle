// apps/frontend/src/App.tsx
//
// Game loop: generate from a random seed, apply moves locally with the shared
// logic, and on a win submit seed + options + moves for the server to replay.
import { useState, useEffect } from 'react';
import { useMutation } from '@apollo/client/react';
import {
  generatePuzzle, applyMove, checkWin, isValidMove,
  DEFAULT_OPTIONS, OPTION_LIMITS,
  type GameState,
  type Move,
  type PuzzleOptions,
} from '@arrow-puzzle/shared';
import { SUBMIT_ATTEMPT, type SubmitAttemptData, type SubmitAttemptVars } from './graphql/mutations';
import { CountStepper } from './components/CountStepper';
import { Figure3D } from './components/Figure3D';
import './App.css';

const TITLE = 'Arrow Puzzle';

// The figure's bounding box is roughly 1.75 face widths once rotated, and the
// stage is two; keep it clear of the header and controls on a phone.
const faceSize = () => Math.floor(Math.min(window.innerWidth * 0.48, window.innerHeight * 0.26, 220));

function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [startTime, setStartTime] = useState(Date.now());
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const [seed, setSeed] = useState(0);
  const [win, setWin] = useState(false);
  const [options, setOptions] = useState<PuzzleOptions>(DEFAULT_OPTIONS);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [submitResult, setSubmitResult] = useState<{ score?: number | null; message?: string | null } | null>(null);
  const [size, setSize] = useState(faceSize);
  // The arrow that last failed to move; `n` restarts the bump on repeat taps.
  const [bump, setBump] = useState<{ id: number; n: number } | null>(null);

  const [submitAttempt] = useMutation<SubmitAttemptData, SubmitAttemptVars>(SUBMIT_ATTEMPT);

  useEffect(() => {
    const onResize = () => setSize(faceSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const initGame = (nextOptions: PuzzleOptions) => {
    const newSeed = Math.floor(Math.random() * 1000000);
    setSeed(newSeed);
    setState(generatePuzzle(newSeed, nextOptions));
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
  useEffect(() => { initGame(options); }, []);

  // Every option, the blocked-arrows rule included, starts a new game: replay
  // on the server assumes one set of rules for the whole move list.
  const handleOptionCommit = <K extends keyof PuzzleOptions>(key: K) => (value: PuzzleOptions[K]) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    initGame(next);
  };

  const handleMove = (move: Move) => {
    if (!state || win) return;

    if (!isValidMove(state, move)) return;

    // Every attempt is a move, including one on a blocked arrow; the server
    // replays (and scores) the full list.
    const newHistory = [...moveHistory, move];
    setMoveHistory(newHistory);
    const newState = applyMove(state, move);
    if (newState === state) {
      setBump(b => ({ id: move, n: (b?.n ?? 0) + 1 }));
      return;
    }
    setState(newState);

    if (checkWin(newState)) {
      setWin(true);
      setSubmitStatus('pending');
      const timeMs = Date.now() - startTime;
      submitAttempt({
        variables: { seed, moves: newHistory, timeMs, ...options }
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
      // no way to bring it back.
      overflow: 'hidden',
    }}>
      <h1 style={{ color: 'white', margin: '0 0 8px', flex: '0 0 auto' }}>{TITLE}</h1>
      {win && <h2 style={{ color: 'gold', margin: '4px 0' }}>✨ You Win! ✨</h2>}
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
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', flex: '1 1 auto', minHeight: 0,
      }}>
        {state && <Figure3D figure={state.figure} arrows={state.arrows} faceSize={size} bump={bump} onArrowTap={handleMove} />}
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '12px', marginTop: '12px', marginBottom: '4px', flex: '0 0 auto',
      }}>
        <button onClick={() => initGame(options)} style={{ padding: '11px 30px', fontSize: '16px', cursor: 'pointer' }}>
          New Game
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <CountStepper
            label="Grid"
            value={options.size}
            min={OPTION_LIMITS.size.min}
            max={OPTION_LIMITS.size.max}
            onCommit={handleOptionCommit('size')}
          />
          <CountStepper
            label="Length"
            value={options.maxLength}
            min={OPTION_LIMITS.maxLength.min}
            max={OPTION_LIMITS.maxLength.max}
            onCommit={handleOptionCommit('maxLength')}
          />
        </div>
        <label style={{ color: 'white', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={options.blockedArrows === 'stay'}
            onChange={(e) => handleOptionCommit('blockedArrows')(e.target.checked ? 'stay' : 'return')}
            style={{ width: '18px', height: '18px' }}
          />
          Hard: blocked arrows stay where they stop
        </label>
      </div>
      <div style={{ color: '#aaa', marginTop: '10px', fontSize: '14px', flex: '0 0 auto' }}>
        Moves: {moveHistory.length} · Arrows left: {state?.arrows.length ?? 0}
      </div>
    </div>
  );
}

export default App;
