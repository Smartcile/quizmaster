import { describe, it, expect } from 'vitest';
import codeGenerator from '../backend/utils/codeGenerator.js';

const { generateQuizCode, generateTeamId } = codeGenerator;

describe('generateQuizCode', () => {
  it('returns a 6-char uppercase alphanumeric code', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateQuizCode()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('is overwhelmingly unlikely to collide across many draws', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(generateQuizCode());
    expect(seen.size).toBeGreaterThan(490);
  });
});

describe('generateTeamId', () => {
  it('returns a v4-shaped UUID and never the same one twice', () => {
    const a = generateTeamId();
    const b = generateTeamId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });
});
