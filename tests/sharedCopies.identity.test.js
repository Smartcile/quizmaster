import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

// A few modules are intentionally duplicated byte-for-byte across the quizzer
// and slideshow apps. Keep them in lockstep so both surfaces behave identically.
describe('duplicated modules stay identical', () => {
  it('frontend-quizzer and frontend-slideshow useWebSocket.js match', () => {
    expect(read('frontend-quizzer/src/hooks/useWebSocket.js'))
      .toBe(read('frontend-slideshow/src/hooks/useWebSocket.js'));
  });
});
