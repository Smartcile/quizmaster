// Photo → text for hand-written answer sheets.
//
// Talks to any OpenAI-compatible chat-completions endpoint. DeepSeek's platform
// is OpenAI-compatible, but set DEEPSEEK_MODEL to a model that accepts image
// input (e.g. a DeepSeek-VL deployment) and DEEPSEEK_BASE_URL if you use a
// proxy / self-hosted gateway. The key never leaves the backend.
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = 'https://api.deepseek.com';

function isConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

function mimeFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'image/jpeg';
  }
}

function buildPrompt(count, options = {}) {
  const ntsRows = (Array.isArray(options.nameTheSong) ? options.nameTheSong : [])
    .filter(n => Number.isInteger(n) && n >= 1 && n <= count);
  const lines = [
    'You are transcribing a hand-written pub quiz answer sheet.',
    `The sheet has ${count} numbered answer rows, in order (1 to ${count}).`,
    'The photo may be rotated or taken at an angle — mentally orient it so the numbers read left-to-right, then top-to-bottom.',
    'Ignore screen/browser chrome, toolbars, printed question text and anything outside the numbered answer boxes.',
    'For each row return only the hand-written answer exactly as written.',
    'If a row has lettered tick boxes and one is ticked, return just that letter (A/B/C/...).',
    'If a row is blank or unreadable, return an empty string for it.',
    'Do not invent answers and do not add explanations.',
    'Reply with ONLY minified JSON in this exact shape:',
    '{"answers":["answer for 1","answer for 2", ...]}',
    `The array must contain exactly ${count} strings.`,
  ];
  if (ntsRows.length) {
    lines.push(
      `Rows ${ntsRows.join(', ')} are "Name the Song": they have two boxes side by side labelled ARTIST and SONG. ` +
      'Ignore those printed labels and return the pair as a single string "artist - song" ' +
      '(the hand-written artist, then a space, a hyphen, a space, then the hand-written song title).'
    );
  }
  return lines.join(' ');
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(raw); } catch { /* try a substring next */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* give up below */ }
  }
  throw new Error('The AI did not return valid JSON.');
}

async function transcribeAnswerSheet(imagePath, questionCount, options = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('AI marking is not configured (DEEPSEEK_API_KEY is unset).');

  const base = String(process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  const mime = mimeFor(imagePath);
  const b64 = fs.readFileSync(imagePath).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(questionCount, options) },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`AI request failed (${resp.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = extractJson(content);
  const answers = Array.isArray(parsed) ? parsed : parsed.answers;
  if (!Array.isArray(answers)) throw new Error('The AI response did not contain an answers array.');
  return answers.map(a => (a == null ? '' : String(a)));
}

module.exports = { isConfigured, transcribeAnswerSheet };
