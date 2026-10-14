import { scoreAttempt, BONUSES, DEFAULT_OPTIONS, MIN_PACE, POINTS_PER_ARROW, TARGET_MS_PER_ARROW } from '../src/index.js';

const fast = (arrows: number) => arrows * TARGET_MS_PER_ARROW;

describe('scoreAttempt', () => {
  it('gives a perfect game full points: one move per arrow, within the target pace', () => {
    expect(scoreAttempt(100, 100, fast(100), DEFAULT_OPTIONS)).toEqual({ score: 100 * POINTS_PER_ARROW, accuracy: 1, pace: 1, bonus: 1 });
  });

  it('scales accuracy with blocked attempts', () => {
    // 156 arrows cleared in 163 moves, the game that scored 0 under the old formula.
    const { score, accuracy } = scoreAttempt(156, 163, fast(156), DEFAULT_OPTIONS);
    expect(accuracy).toBeCloseTo(156 / 163);
    expect(score).toBe(Math.round(1560 * 156 / 163));
  });

  it('slows the score down with time, but never below MIN_PACE', () => {
    expect(scoreAttempt(100, 100, 2 * fast(100), DEFAULT_OPTIONS).pace).toBeCloseTo(0.5);
    expect(scoreAttempt(100, 100, 1.25 * fast(100), DEFAULT_OPTIONS).pace).toBeCloseTo(0.8);
    expect(scoreAttempt(100, 100, 100 * fast(100), DEFAULT_OPTIONS).pace).toBe(MIN_PACE);
  });

  it('rewards bigger boards', () => {
    expect(scoreAttempt(300, 300, fast(300), DEFAULT_OPTIONS).score).toBeGreaterThan(scoreAttempt(100, 100, fast(100), DEFAULT_OPTIONS).score);
  });

  it('applies the notched cube bonus', () => {
    const base = scoreAttempt(100, 100, fast(100), DEFAULT_OPTIONS).score;
    expect(scoreAttempt(100, 100, fast(100), { ...DEFAULT_OPTIONS, figure: 'notch' }).score).toBe(base * BONUSES.notch);
  });

  it('gives no bonus for the blocked-arrows rule', () => {
    const base = scoreAttempt(100, 100, fast(100), DEFAULT_OPTIONS);
    expect(scoreAttempt(100, 100, fast(100), { ...DEFAULT_OPTIONS, blockedArrows: 'stay' })).toEqual(base);
  });
});
