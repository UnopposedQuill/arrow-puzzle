import { useState } from 'react';

const stepButtonStyle = (disabled: boolean) => ({
  width: '36px',
  height: '36px',
  fontSize: '19px',
  lineHeight: 1,
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.35 : 1,
});

// A count control offering both editing gestures a game settings row needs:
//   - the -/+ buttons nudge by one. Android's numeric IME has no arrow keys
//     and a WebView renders no spinner for type="number", so without these
//     there is no way to adjust a value by hand at all.
//   - the text field takes a value directly, for jumping between very
//     different difficulties in one go. It focuses select-all so typing
//     replaces rather than appends.
//
// The draft is kept as a string so the field can be transiently empty or
// partial while typing, and is parsed/clamped/committed only on blur or
// Enter. Clamping on every keystroke makes the field uneditable: deleting the
// last digit refills it with the minimum instantly, so the value can never be
// cleared and retyped.
export function CountStepper({ label, value, min, max, onCommit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);

  // Track committed changes made elsewhere: the -/+ buttons, or a clamp
  // forced by a sibling control.
  // Adjusted during render rather than in an effect -- React re-runs this
  // component immediately without committing the stale draft to the DOM.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const commitDraft = () => {
    const parsed = Number.parseInt(draft, 10);
    // An empty or unparseable field reverts to the last committed value
    // rather than silently becoming the minimum.
    const next = Number.isNaN(parsed) ? value : clamp(parsed);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const step = (delta: number) => {
    const next = clamp(value + delta);
    if (next !== value) onCommit(next);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ color: 'white', fontSize: '13px' }}>{label}:</span>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => step(-1)}
        style={stepButtonStyle(value <= min)}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={label}
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        // Digits only, capped at two so a stray keypress can't build a huge
        // number; the real bound is applied by clamp() on commit.
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
        onBlur={commitDraft}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        // 16px keeps mobile browsers from zooming in on focus.
        style={{ width: '42px', padding: '6px', fontSize: '16px', textAlign: 'center', boxSizing: 'border-box' }}
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => step(1)}
        style={stepButtonStyle(value >= max)}
      >
        +
      </button>
    </div>
  );
}
