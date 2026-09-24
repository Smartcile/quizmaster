import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Like buildSlides, LiveScoreboard.jsx is duplicated across all three frontends
// so each surface renders an identical live board. Keep the copies in lockstep.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copies = ['frontend-admin', 'frontend-slideshow', 'frontend-quizzer']
  .map(p => path.join(repoRoot, p, 'src', 'components', 'LiveScoreboard.jsx'));

const readNormalized = (file) =>
  fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

describe('LiveScoreboard — three identical copies', () => {
  it('all three source files are byte-identical (line endings normalised)', () => {
    const [a, b, c] = copies.map(readNormalized);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
