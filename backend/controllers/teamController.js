const db = require('../config/database');
const { getIo } = require('../sockets');
const { loadDoubleChoicesForSession } = require('../utils/doubleUp');

// Fuzzy name key: lowercase and strip everything except a-z0-9, so
// "The-Quiz Kings!" and "thequizkings" resolve to the SAME team.
function normTeamKey(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Small Levenshtein distance for the "is this your team?" suggestion.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Close-but-not-exact (normalised keys): worth asking the guest about, never
// worth auto-joining.
function isCloseName(a, b) {
  if (!a || !b) return false;
  const dist = editDistance(a, b);
  return dist > 0 && dist <= (Math.min(a.length, b.length) >= 6 ? 2 : 1);
}

// Find-or-create with foolproof rejoin. Core rule: a guest who already has a
// team ALWAYS reconnects to that existing record — a duplicate is never created
// for them.
//  • exact fuzzy-normalised name match → rejoin that team, adopt this deviceId
//  • same device_id but a different name, OR a close-but-not-exact name →
//    respond { needsConfirm, suggestion } so the client can ask "Is this your
//    team?" (never auto-joins on a guess)
//  • confirmTeamId → guest said YES: attach this device to that EXISTING team
//    (never merges two established teams, never copies scores)
//  • forceNew → guest said NO: create a genuinely new team
// Team size never affects identity. Finished sessions stay read-only.
async function joinQuiz(req, res) {
  try {
    const { sessionId, name, size, deviceId, confirmTeamId, forceNew } = req.body;
    if (!sessionId || !name || !String(name).trim()) {
      return res.status(400).json({ error: 'sessionId and name are required' });
    }
    const cleanName = String(name).trim();
    const nameKey = normTeamKey(cleanName);

    const sess = await db.query('SELECT status FROM quiz_sessions WHERE id = $1', [sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });
    const finished = sess.rows[0].status === 'finished';

    const teamsRes = await db.query('SELECT * FROM teams WHERE quiz_session_id = $1', [sessionId]);
    const teams = teamsRes.rows;

    // Rejoin an existing team: adopt this device's id (so future loads pick it
    // up silently) and only overwrite size when explicitly re-supplied.
    const rejoinAs = async (team) => {
      const sets = [], params = [];
      if (deviceId && team.device_id !== deviceId) {
        params.push(deviceId);
        sets.push(`device_id = $${params.length}`);
      }
      if (!finished && size != null && Number(size) > 0 && Number(size) !== team.size) {
        params.push(Number(size));
        sets.push(`size = $${params.length}`);
      }
      if (!sets.length) return team;
      params.push(team.id);
      const upd = await db.query(
        `UPDATE teams SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      return upd.rows[0];
    };

    // Guest confirmed "yes, that's us" — attach this device to that EXISTING team.
    if (confirmTeamId) {
      const target = teams.find(t => t.id === Number(confirmTeamId));
      if (!target) return res.status(404).json({ error: 'Team to confirm not found in this session' });
      const team = await rejoinAs(target);
      return res.status(200).json({ ...team, rejoined: true, ...(finished ? { finished: true } : {}) });
    }

    const exact = teams.find(t => normTeamKey(t.name) === nameKey);

    // A finished session is read-only: return the existing team for history
    // lookup, but never create a new (ghost) team in it.
    if (finished) {
      if (exact) return res.status(200).json({ ...exact, rejoined: true, finished: true });
      return res.status(404).json({ error: 'No team by that name in this finished session.' });
    }

    if (exact) {
      const team = await rejoinAs(exact);
      return res.status(200).json({ ...team, rejoined: true });
    }

    if (!forceNew) {
      // This device already has a team here (guest typed a different name), or
      // the name is a near-miss for an existing team — ask before doing
      // anything. The confirm step only ever attaches this device to ONE
      // existing team.
      const deviceMatch = deviceId ? teams.find(t => t.device_id === deviceId) : null;
      const closeMatch  = teams.find(t => isCloseName(normTeamKey(t.name), nameKey));
      const suggestion  = deviceMatch || closeMatch;
      if (suggestion) {
        return res.status(200).json({
          needsConfirm: true,
          suggestion: { id: suggestion.id, name: suggestion.name }
        });
      }
    }

    const result = await db.query(
      'INSERT INTO teams (quiz_session_id, name, size, device_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [sessionId, cleanName, size, deviceId || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Silent device pickup: the quizzer sends its persistent device id on page
// load and reconnects straight to its existing team — no form, no duplicate.
async function getTeamByDevice(req, res) {
  try {
    const { sessionId, deviceId } = req.params;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    const r = await db.query(
      'SELECT * FROM teams WHERE quiz_session_id = $1 AND device_id = $2 ORDER BY created_at DESC LIMIT 1',
      [sessionId, deviceId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No team for this device' });
    res.json(r.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getTeamsBySession(req, res) {
  try {
    const { sessionId } = req.params;
    const result = await db.query(
      'SELECT * FROM teams WHERE quiz_session_id = $1 ORDER BY created_at',
      [sessionId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// All of a team's submitted answers, keyed for the quizzer to restore its inputs
// on rejoin (and to render the read-only history review of a finished session).
async function getTeamAnswers(req, res) {
  try {
    const { teamId } = req.params;
    const result = await db.query(
      'SELECT question_id, round_id, answer_text FROM answers WHERE team_id = $1',
      [teamId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getTeamScores(req, res) {
  try {
    const { teamId } = req.params;
    const result = await db.query(`
      SELECT t.id, t.name, t.size,
        COALESCE(SUM(s.points_awarded), 0) as total_score,
        json_agg(json_build_object('question_id', s.question_id, 'points', s.points_awarded)) as scores
      FROM teams t
      LEFT JOIN scores s ON t.id = s.team_id
      WHERE t.id = $1
      GROUP BY t.id, t.name, t.size
    `, [teamId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── getSessionScoreboard ──────────────────────────────────────────────────
// GET /api/teams/session/:sessionId/scoreboard
// Returns the full quiz structure broken down per round so every surface can
// render columns: Team | [Starting] | Round 1 | … | Round N | [Bonus] | Total.
//
//   {
//     teamSizeScoring: bool,
//     hasBrownie: bool,
//     rounds: [{ id, name, format }],          // in quiz order
//     teams:  [{
//       id, name, size, size_points, brownie_total,
//       round_scores: { [roundId]: number },   // points earned in each round
//       round_total, total
//     }]                                        // sorted by total desc
//   }
//
// `total` = size_points + brownie_total + Σ(round_scores). Computing the total
// from the round columns guarantees the displayed columns always add up.
async function getSessionScoreboard(req, res) {
  try {
    const { sessionId } = req.params;

    // 1) Resolve the session's quiz + whether handicap scoring is on
    const sessRes = await db.query(
      `SELECT qs.quiz_id, q.team_size_scoring
       FROM quiz_sessions qs JOIN quizzes q ON q.id = qs.quiz_id
       WHERE qs.id = $1`,
      [sessionId]
    );
    if (!sessRes.rows.length) return res.status(404).json({ error: 'Session not found' });
    const { quiz_id, team_size_scoring } = sessRes.rows[0];

    // 2) Rounds of the quiz, in their on-screen order (interleaved position first)
    const roundsRes = await db.query(
      `SELECT r.id, r.name, r.format
       FROM quiz_rounds qr JOIN rounds r ON r.id = qr.round_id
       WHERE qr.quiz_id = $1
       ORDER BY COALESCE(qr.position, qr."order"), r.name`,
      [quiz_id]
    );
    const rounds = roundsRes.rows;

    // 3) Base team rows: handicap (size_points) + brownie totals
    const teamsRes = await db.query(`
      SELECT
        t.id, t.name, t.size,
        CASE WHEN $2::boolean THEN GREATEST(-4, LEAST(5, 6 - COALESCE(t.size, 6))) ELSE 0 END::float AS size_points,
        COALESCE(b.brownie_total, 0)::float AS brownie_total
      FROM teams t
      LEFT JOIN (
        SELECT team_id, SUM(points) AS brownie_total FROM brownie_points GROUP BY team_id
      ) b ON b.team_id = t.id
      WHERE t.quiz_session_id = $1
    `, [sessionId, team_size_scoring]);

    // 4) Per team / per round score totals. A round's questions come from
    //    round_questions; scores are matched per question within that round.
    const breakdownRes = await db.query(`
      SELECT t.id AS team_id, qr.round_id, COALESCE(SUM(s.points_awarded), 0)::float AS pts
      FROM teams t
      JOIN quiz_sessions qs ON qs.id = t.quiz_session_id
      JOIN quiz_rounds qr ON qr.quiz_id = qs.quiz_id
      LEFT JOIN round_questions rq ON rq.round_id = qr.round_id
      LEFT JOIN scores s ON s.team_id = t.id AND s.question_id = rq.question_id
      WHERE t.quiz_session_id = $1
      GROUP BY t.id, qr.round_id
    `, [sessionId]);

    // Index the breakdown: { [teamId]: { [roundId]: pts } }
    const byTeam = new Map();
    for (const row of breakdownRes.rows) {
      if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, {});
      byTeam.get(row.team_id)[row.round_id] = Number(row.pts);
    }

    // 5) Who Am I? points (one row per team, if the quiz has a Who-Am-I)
    const whoamiRes = await db.query(`
      SELECT g.team_id, COALESCE(g.points_awarded, 0)::float AS pts
      FROM whoami_guesses g
      JOIN teams t ON t.id = g.team_id
      WHERE t.quiz_session_id = $1
    `, [sessionId]);
    const whoamiByTeam = new Map(whoamiRes.rows.map(r => [r.team_id, Number(r.pts)]));
    const hasWhoami = await db.query(
      `SELECT 1 FROM quiz_widgets WHERE quiz_id = $1 AND type = 'whoami' LIMIT 1`,
      [quiz_id]
    );

    // 6) Double Up: each team's own chosen round (the "joker") scores ×2. Applied
    //    here at aggregation time — raw `scores` rows are untouched. Per-team, not
    //    global: every team may double a different round.
    const doubleChoices = await loadDoubleChoicesForSession(db, sessionId);

    const teams = teamsRes.rows.map(t => {
      const round_scores = byTeam.get(t.id) || {};
      const doubled_round_id = doubleChoices.get(Number(t.id)) ?? null;
      if (doubled_round_id != null && round_scores[doubled_round_id]) {
        round_scores[doubled_round_id] = round_scores[doubled_round_id] * 2;
      }
      const round_total = rounds.reduce((sum, r) => sum + (round_scores[r.id] || 0), 0);
      const whoami_points = whoamiByTeam.get(t.id) || 0;
      const total = round_total + t.size_points + t.brownie_total + whoami_points;
      return { ...t, round_scores, round_total, whoami_points, total, doubled_round_id };
    });

    teams.sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));

    res.json({
      teamSizeScoring: !!team_size_scoring,
      hasBrownie: teams.some(t => t.brownie_total !== 0),
      hasWhoami: hasWhoami.rows.length > 0,
      rounds,
      teams
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Admin: create a team directly in a session (no quizzer device needed) ─────
// POST /api/teams  { sessionId, name, size }
// Find-or-create semantics match joinQuiz so an admin add never duplicates a
// team that already joined itself. Broadcasts team_joined so every surface
// (lobby counter, scoreboards, marking) updates live. Manually-added teams are
// ordinary teams rows — marking and scoring treat them exactly like joined ones.
async function createTeamAdmin(req, res) {
  try {
    const { sessionId, name, size } = req.body;
    if (!sessionId || !name || !String(name).trim()) {
      return res.status(400).json({ error: 'sessionId and name are required' });
    }
    const cleanName = String(name).trim();

    const sess = await db.query('SELECT id FROM quiz_sessions WHERE id = $1', [sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });

    const teamsRes = await db.query('SELECT * FROM teams WHERE quiz_session_id = $1', [sessionId]);
    const existing = teamsRes.rows.find(t => normTeamKey(t.name) === normTeamKey(cleanName));

    let team, created = false;
    if (existing) {
      team = existing;
    } else {
      const ins = await db.query(
        'INSERT INTO teams (quiz_session_id, name, size) VALUES ($1, $2, $3) RETURNING *',
        [sessionId, cleanName, size || null]
      );
      team = ins.rows[0];
      created = true;
    }

    const io = getIo();
    if (io) {
      io.to(`quiz-${sessionId}`).emit('team_joined', {
        teamId:    team.id,
        teamName:  team.name,
        teamSize:  team.size,
        timestamp: new Date().toISOString()
      });
    }

    res.status(created ? 201 : 200).json(team);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Admin: edit a team (size / name) from the Control page ────────────────────
// PUT /api/teams/:teamId   Body: { size?, name? }
// Size drives handicap scoring, which is computed at scoreboard-aggregation time
// (GREATEST(-4, LEAST(5, 6 - size))), so a correction here re-scores instantly —
// no stored points are touched. Broadcasts team_updated so every live scoreboard
// re-fetches.
async function updateTeam(req, res) {
  try {
    const { teamId } = req.params;
    const { size, name, is_paper } = req.body;

    const cur = await db.query('SELECT id, name, size, is_paper, quiz_session_id FROM teams WHERE id = $1', [teamId]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Team not found' });

    let nextSize = cur.rows[0].size;
    if (size !== undefined) {
      if (size === null || size === '') {
        nextSize = null;
      } else {
        const n = parseInt(size, 10);
        if (Number.isNaN(n) || n < 1) return res.status(400).json({ error: 'size must be a positive whole number' });
        nextSize = n;
      }
    }

    let nextName = cur.rows[0].name;
    if (name !== undefined && String(name).trim()) nextName = String(name).trim();

    const nextPaper = is_paper === undefined ? cur.rows[0].is_paper : !!is_paper;

    const upd = await db.query(
      'UPDATE teams SET name = $1, size = $2, is_paper = $3 WHERE id = $4 RETURNING *',
      [nextName, nextSize, nextPaper, teamId]
    );
    const team = upd.rows[0];

    const io = getIo();
    if (io) {
      io.to(`quiz-${team.quiz_session_id}`).emit('team_updated', {
        teamId:    team.id,
        teamName:  team.name,
        teamSize:  team.size,
        isPaper:   team.is_paper,
        timestamp: new Date().toISOString()
      });
    }

    res.json(team);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Admin: remove a team and all its data ─────────────────────────────────────
// DELETE /api/teams/:teamId
// answers / scores / brownie_points / whoami_guesses / double_up_choices all
// reference teams(id) ON DELETE CASCADE, so this single delete leaves no
// orphans. Broadcasts team_removed so every surface drops the team live.
async function deleteTeam(req, res) {
  try {
    const { teamId } = req.params;
    const teamRes = await db.query(
      'SELECT id, name, quiz_session_id FROM teams WHERE id = $1',
      [teamId]
    );
    if (!teamRes.rows.length) return res.status(404).json({ error: 'Team not found' });
    const team = teamRes.rows[0];

    await db.query('DELETE FROM teams WHERE id = $1', [teamId]);

    const io = getIo();
    if (io) {
      io.to(`quiz-${team.quiz_session_id}`).emit('team_removed', {
        teamId:    team.id,
        teamName:  team.name,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Look up a single team by ID — used by the quizzer to restore identity after a page refresh
async function getTeamById(req, res) {
  try {
    const result = await db.query('SELECT * FROM teams WHERE id = $1', [req.params.teamId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  joinQuiz,
  getTeamsBySession,
  getTeamScores,
  getTeamAnswers,
  getTeamById,
  getSessionScoreboard,
  getTeamByDevice,
  createTeamAdmin,
  updateTeam,
  deleteTeam
};
