// Remember the authoring settings of the last saved question (category, type,
// difficulty, points…) so the next NEW question starts pre-filled. Content —
// question text, answer, media, options and Who-Am-I clues — is never carried.
const KEY = 'qmQuestionDefaults';

export const CARRY_KEYS = [
  'type',
  'difficulty',
  'points',
  'category',
  'answer_mode',
  'question_format',
  'audio_form',
  'approved',
];

export function getQuestionDefaults() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveQuestionDefaults(form) {
  const out = {};
  for (const key of CARRY_KEYS) {
    if (form?.[key] !== undefined) out[key] = form[key];
  }
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* quota */ }
}

export function applyQuestionDefaults(base) {
  const saved = getQuestionDefaults();
  const next = { ...base };
  for (const key of CARRY_KEYS) {
    if (saved[key] !== undefined) next[key] = saved[key];
  }
  return next;
}
