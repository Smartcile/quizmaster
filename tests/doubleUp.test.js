import { describe, it, expect, vi } from 'vitest';
import doubleUpModule from '../backend/utils/doubleUp.js';

const { loadDoubleChoicesForSession } = doubleUpModule;

// Double Up is a per-team x2 joker stored one row per team. Both the scoreboard
// and the results query load it through this one helper so they stay in sync.
describe('loadDoubleChoicesForSession', () => {
  it('maps team_id -> round_id as numbers', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { team_id: '1', round_id: '12' },
          { team_id: 2, round_id: 12 },
        ],
      }),
    };
    const map = await loadDoubleChoicesForSession(db, 99);
    expect(db.query).toHaveBeenCalledWith(
      'SELECT team_id, round_id FROM double_up_choices WHERE session_id = $1',
      [99]
    );
    expect(map.get(1)).toBe(12);
    expect(map.get(2)).toBe(12);
    expect(map.size).toBe(2);
  });

  it('returns an empty map when a team has no choice', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const map = await loadDoubleChoicesForSession(db, 1);
    expect(map.size).toBe(0);
  });
});
