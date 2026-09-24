import { describe, it, expect } from 'vitest';
import cleanTextModule from '../backend/utils/cleanText.js';

const { cleanText, cleanOptions } = cleanTextModule;

// cleanText/cleanOptions run on EVERY write path (manual, CSV, repo sync) so
// special characters can't enter the question bank regardless of source.
describe('cleanText', () => {
  it('converts smart quotes to straight quotes', () => {
    expect(cleanText('It\u2019s')).toBe("It's");
    expect(cleanText('\u201Cquoted\u201D')).toBe('"quoted"');
  });

  it('converts en/em dashes to a plain hyphen', () => {
    expect(cleanText('a \u2013 b')).toBe('a - b');
    expect(cleanText('a\u2014b')).toBe('a-b');
  });

  it('converts ellipsis and non-breaking spaces', () => {
    expect(cleanText('wait\u2026')).toBe('wait...');
    expect(cleanText('a\u00A0b')).toBe('a b');
  });

  it('NFKC-normalises compatibility forms but preserves accents', () => {
    expect(cleanText('\uFB01ne')).toBe('fine');
    expect(cleanText('Caf\u00E9')).toBe('Caf\u00E9');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(cleanText('  lots   of   space  ')).toBe('lots of space');
  });

  it('treats null/undefined as an empty string', () => {
    expect(cleanText(null)).toBe('');
    expect(cleanText(undefined)).toBe('');
  });
});

describe('cleanOptions', () => {
  it('cleans plain string options', () => {
    expect(cleanOptions([' a\u2019b '])).toEqual(["a'b"]);
  });

  it('preserves clue object structure ({ text, points }) while cleaning text', () => {
    expect(cleanOptions([{ text: 'x\u2013y', points: 2 }])).toEqual([{ text: 'x-y', points: 2 }]);
  });

  it('returns [] for non-arrays', () => {
    expect(cleanOptions(null)).toEqual([]);
    expect(cleanOptions('nope')).toEqual([]);
  });
});
