// apps/frontend/src/App.tsx
//
// Game loop: generate from a random seed, apply moves locally with the shared
// logic, and on a win submit seed + options + moves for the server to replay.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMutation } from '@apollo/client/react';
import {
  generatePuzzle, applyMove, traceMove, checkWin, anyArrowCanLeave,
  DEFAULT_OPTIONS, OPTION_LIMITS, FIGURE_KINDS, edgeLayoutsFor,
  type EdgeLayout,
  type EdgeType,
  type FigureKind,
  type GameState,
  type Move,
  type PuzzleOptions,
} from '@arrow-puzzle/shared';
import { SUBMIT_ATTEMPT, type SubmitAttemptData, type SubmitAttemptVars } from './graphql/mutations';
import { CountStepper } from './components/CountStepper';
import { Figure3D, type SlideAnimation } from './components/Figure3D';
import { EDGE_STYLES } from './components/edgeStyles';
import './App.css';

const TITLE = 'Arrow Puzzle';

const FIGURE_NAMES: Record<FigureKind, string> = {
  cube: 'Cube',
  notch: 'Notched cube',
  step: 'Step',
  cross: '3D cross',
  rhombic: 'Rhombic dodecahedron',
};

const EDGE_NAMES: Record<EdgeLayout, string> = {
  plain: 'Plain',
  few: 'Random (few)',
  many: 'Random (many)',
  crown: 'Sticky crown',
  girdle: 'Mirror girdle',
  whirl: 'Turning whirl',
};

const selectStyle = { fontSize: '16px', padding: '4px' }; // 16px: no zoom on focus on phones
const labelStyle = { color: 'white', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' } as const;

function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [startTime, setStartTime] = useState(Date.now());
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const [seed, setSeed] = useState(0);
  const [win, setWin] = useState(false);
  const [options, setOptions] = useState<PuzzleOptions>(DEFAULT_OPTIONS);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [submitResult, setSubmitResult] = useState<{ score?: number | null; message?: string | null } | null>(null);
  // The arrow that last failed to move; `n` restarts the bump on repeat taps.
  const [bump, setBump] = useState<{ id: number; n: number } | null>(null);
  // Moves being animated. The board itself is updated at once; these only
  // show how it got there.
  const [animations, setAnimations] = useState<SlideAnimation[]>([]);
  const nextAnimation = useRef(0);

  const [submitAttempt] = useMutation<SubmitAttemptData, SubmitAttemptVars>(SUBMIT_ATTEMPT);

  const initGame = (nextOptions: PuzzleOptions) => {
    const newSeed = Math.floor(Math.random() * 1000000);
    setSeed(newSeed);
    setState(generatePuzzle(newSeed, nextOptions));
    setStartTime(Date.now());
    setMoveHistory([]);
    setWin(false);
    setSubmitStatus('idle');
    setSubmitResult(null);
    setAnimations([]);
  };

  // Under 'stay', pushed arrows can end up blocking each other so that none
  // can leave; say so instead of letting the player hunt for a move.
  const stuck = useMemo(() => !!state && state.arrows.length > 0 && !anyArrowCanLeave(state), [state]);

  // Edge types on this board, for the legend.
  const edgeTypes = useMemo(() => [...new Set<EdgeType>(state?.figure.edges.flatMap(e => e.segments.map(seg => seg.type)) ?? [])].sort(), [state]);

  const flashBlocked = (id: number) => setBump(b => ({ id, n: (b?.n ?? 0) + 1 }));

  const handleAnimationDone = useCallback((key: number) => {
    setAnimations(list => {
      const done = list.find(a => a.key === key);
      // Under 'stay', an arrow that slid into its blocker flashes red where it stopped.
      if (done && !done.trace.exited && done.rule === 'stay') flashBlocked(done.trace.arrow.id);
      return list.filter(a => a.key !== key);
    });
  }, []);

  // Generate the first puzzle once. Regeneration is deliberate from here on
  // (New Game, or committing a settings change), so a half-typed number never
  // destroys the game in progress.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { initGame(options); }, []);

  // Every option, the blocked-arrows rule included, starts a new game: replay
  // on the server assumes one set of rules for the whole move list.
  const handleOptionCommit = <K extends keyof PuzzleOptions>(key: K) => (value: PuzzleOptions[K]) => {
    const next = { ...options, [key]: value };
    // A preset that changes nothing on the new figure falls back to plain.
    if (!edgeLayoutsFor(next.figure).includes(next.edges)) next.edges = 'plain';
    setOptions(next);
    initGame(next);
  };

  const handleMove = (move: Move) => {
    if (!state || win) return;

    const trace = traceMove(state, move);
    if (!trace) return;

    // Every attempt is a move, including one on a blocked arrow; the server
    // replays (and scores) the full list.
    const newHistory = [...moveHistory, move];
    setMoveHistory(newHistory);
    if (trace.path.length === 0 && !trace.exited) {
      // Nowhere to go at all: just the nudge.
      flashBlocked(move);
    } else {
      const animation = { key: nextAnimation.current++, trace, rule: state.blockedArrows, start: performance.now() };
      // A new tap on an arrow that is still sliding replaces its slide.
      setAnimations(list => [...list.filter(a => a.trace.arrow.id !== move), animation]);
    }
    const newState = applyMove(state, move);
    if (newState === state) return;
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
      {stuck && (
        <div style={{ color: '#e67e22', fontSize: '14px', textAlign: 'center', maxWidth: '340px' }}>
          No arrow can leave right now. Shift arrows to open a path, or start a new game.
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
        {state && (
          <Figure3D
            figure={state.figure} arrows={state.arrows} bump={bump}
            animations={animations} onAnimationDone={handleAnimationDone} onArrowTap={handleMove}
          />
        )}
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '12px', marginTop: '12px', marginBottom: '4px', flex: '0 0 auto',
      }}>
        <button onClick={() => initGame(options)} style={{ padding: '11px 30px', fontSize: '16px', cursor: 'pointer' }}>
          New Game
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <label style={labelStyle}>
            Figure:
            <select value={options.figure} onChange={(e) => handleOptionCommit('figure')(e.target.value as FigureKind)} style={selectStyle}>
              {FIGURE_KINDS.map(kind => <option key={kind} value={kind}>{FIGURE_NAMES[kind]}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Edges:
            <select value={options.edges} onChange={(e) => handleOptionCommit('edges')(e.target.value as EdgeLayout)} style={selectStyle}>
              {edgeLayoutsFor(options.figure).map(layout => <option key={layout} value={layout}>{EDGE_NAMES[layout]}</option>)}
            </select>
          </label>
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
          Blocked arrows stay where they stop (instead of going back)
        </label>
      </div>
      {edgeTypes.length > 1 && (
        // What the coloured edges on this board do.
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 12px', marginTop: '8px', fontSize: '12px', color: '#ddd' }}>
          {edgeTypes.map(type => (
            <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '16px', height: `${EDGE_STYLES[type].width}px`, background: EDGE_STYLES[type].color }} />
              {EDGE_STYLES[type].label}
            </span>
          ))}
        </div>
      )}
      <div style={{ color: '#aaa', marginTop: '10px', fontSize: '14px', flex: '0 0 auto' }}>
        Moves: {moveHistory.length} · Arrows left: {state?.arrows.length ?? 0}
      </div>
    </div>
  );
}

export default App;
