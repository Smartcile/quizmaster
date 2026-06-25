// "Double Up Round" is a per-team joker: each team picks ONE round (on the
// quizzer's Double Points page) to score ×2. It is NOT global to the quiz.
// Doubling is applied at scoreboard-aggregation time, never stored into the
// `scores` table — raw marks stay 0 / 0.5 / 1 — so it's instantly reversible.
//
// Choices live in the double_up_choices table (one row per team). Used by BOTH
// getSessionScoreboard (teamController) and getSessionResults (quizController)
// so they stay in sync.
async function loadDoubleChoicesForSession(db, sessionId) {
  const res = await db.query(
    `SELECT team_id, round_id FROM double_up_choices WHERE session_id = $1`,
    [sessionId]
  );
  const map = new Map(); // teamId → roundId
  for (const r of res.rows) map.set(Number(r.team_id), Number(r.round_id));
  return map;
}

module.exports = { loadDoubleChoicesForSession };
