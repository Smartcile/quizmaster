// Quiz Control & Testing preferences — admin-only, stored in localStorage.
// Shared by the Settings page (editor) and QuizControl (test runner).

const KEY = 'qmTestSettings';

export const DEFAULT_TEST_SETTINGS = {
  // Bot teams that auto-join and auto-answer a test run. `correct`/`wrong` are
  // probabilities (0–1); the remainder (1 - correct - wrong) is "skipped".
  bots: [
    { name: 'The Quiz Lords', size: 2, correct: 0.75, wrong: 0.15 },
    { name: 'Trivia Newbies', size: 6, correct: 0.45, wrong: 0.30 },
  ],
  layout: 'side-by-side',                 // 'side-by-side' | 'stacked'
  surfaces: { slideshow: true, quizzer: true },
  quizzerMode: 'mirror',                  // 'mirror' | 'interactive'
  autoCleanTest: true,                    // delete the test session on close
};

export function getTestSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredCloneSafe(DEFAULT_TEST_SETTINGS);
    const p = JSON.parse(raw);
    return {
      ...DEFAULT_TEST_SETTINGS,
      ...p,
      surfaces: { ...DEFAULT_TEST_SETTINGS.surfaces, ...(p.surfaces || {}) },
      bots: Array.isArray(p.bots) && p.bots.length
        ? p.bots.map(normalizeBot)
        : structuredCloneSafe(DEFAULT_TEST_SETTINGS.bots),
    };
  } catch {
    return structuredCloneSafe(DEFAULT_TEST_SETTINGS);
  }
}

export function saveTestSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore quota */ }
}

function normalizeBot(b) {
  const correct = clamp01(Number(b?.correct ?? 0.6));
  let wrong = clamp01(Number(b?.wrong ?? 0.2));
  if (correct + wrong > 1) wrong = Math.max(0, 1 - correct);
  return {
    name: String(b?.name || 'Bot Team').slice(0, 60),
    size: Math.max(1, Math.min(20, parseInt(b?.size) || 4)),
    correct,
    wrong,
  };
}

function clamp01(n) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }

// Avoid relying on structuredClone in older browsers
function structuredCloneSafe(obj) { return JSON.parse(JSON.stringify(obj)); }
