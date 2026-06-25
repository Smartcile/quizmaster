// "Double Up Round" doubling is applied at scoreboard-aggregation time, never
// stored into the `scores` table — raw marks stay 0 / 0.5 / 1, the ×2 is applied
// when totals are computed. This keeps marking clean and doubling instantly
// reversible (untick → back to normal).
//
// The chosen round IDs live in a quiz_widgets row of type 'doubleup', in its
// `data` JSONB as { doubled_round_ids: [12, 15] }. A quiz may hold several such
// widgets; we take the union. Used by BOTH getSessionScoreboard (teamController)
// and getSessionResults (quizController) so they stay in sync.
async function loadDoubledRoundIds(db, quizId) {
  const res = await db.query(
    `SELECT data FROM quiz_widgets WHERE quiz_id = $1 AND type = 'doubleup'`,
    [quizId]
  );
  const ids = new Set();
  for (const row of res.rows) {
    let d = row.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
    const arr = Array.isArray(d?.doubled_round_ids) ? d.doubled_round_ids : [];
    for (const id of arr) {
      const n = Number(id);
      if (Number.isInteger(n)) ids.add(n);
    }
  }
  return ids;
}

module.exports = { loadDoubledRoundIds };
