// Tidy text for storage so special characters never sneak into the question
// bank no matter where the text came from (manual create/update, CSV import,
// GitHub repo sync, or the bulk reformat action). Smart quotes/dashes/ellipsis
// and non-breaking spaces collapse to plain ASCII; NFKC normalises compatibility
// forms; accents/letters are preserved. This is intentionally lossless for
// meaning — it only swaps "fancy" punctuation for the plain equivalent.
function cleanText(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")   // ‘ ’ ‚ ‛ ′ → '
    .replace(/[“”„″]/g, '"')         // “ ” „ ″ → "
    .replace(/[–—−]/g, '-')               // – — − → -
    .replace(/…/g, '...')                            // … → ...
    .replace(/ /g, ' ')                              // non-breaking space → space
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Clean an options array — plain string options OR Who/What Am I clue objects
// ({ text, points }). Structure is preserved; only the text is tidied.
function cleanOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map(o =>
    (o && typeof o === 'object') ? { ...o, text: cleanText(o.text) } : cleanText(o)
  );
}

module.exports = { cleanText, cleanOptions };
