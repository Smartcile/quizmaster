import { describe, it, expect, beforeEach } from 'vitest';
import { getTestSettings, saveTestSettings, DEFAULT_TEST_SETTINGS } from '../frontend-admin/src/utils/testSettings.js';

// Quiz Control & Testing preferences — admin localStorage store.
describe('testSettings', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing is stored', () => {
    expect(getTestSettings()).toEqual(DEFAULT_TEST_SETTINGS);
  });

  it('round-trips saved settings', () => {
    const s = { ...DEFAULT_TEST_SETTINGS, quizzerMode: 'interactive', autoCleanTest: false };
    saveTestSettings(s);
    expect(getTestSettings()).toEqual(s);
  });

  it('merges partial settings over the defaults (incl. nested surfaces)', () => {
    localStorage.setItem('qmTestSettings', JSON.stringify({ surfaces: { quizzer: false } }));
    const s = getTestSettings();
    expect(s.surfaces).toEqual({ slideshow: true, quizzer: false });
    expect(s.quizzerMode).toBe(DEFAULT_TEST_SETTINGS.quizzerMode);
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('qmTestSettings', '{not json');
    expect(getTestSettings()).toEqual(DEFAULT_TEST_SETTINGS);
  });

  it('normalises bots: clamps size and keeps correct+wrong <= 1', () => {
    localStorage.setItem('qmTestSettings', JSON.stringify({
      bots: [
        { name: 'A', size: 999, correct: 0.9, wrong: 0.8 },
        { name: '', size: 0, correct: 2, wrong: -1 },
      ],
    }));
    const s = getTestSettings();
    const [a, b] = s.bots;
    expect(a.size).toBe(20);                 // clamped high
    expect(a.correct).toBeCloseTo(0.9);
    expect(a.correct + a.wrong).toBeLessThanOrEqual(1);
    expect(b.size).toBe(4);                  // falsy size falls back to the 4 default
    expect(b.name).toBe('Bot Team');
    expect(b.correct).toBe(1);
    expect(b.wrong).toBe(0);                 // negatives clamp to 0
  });

  it('ignores an empty bots array and uses the defaults', () => {
    localStorage.setItem('qmTestSettings', JSON.stringify({ bots: [] }));
    expect(getTestSettings().bots).toEqual(DEFAULT_TEST_SETTINGS.bots);
  });
});
