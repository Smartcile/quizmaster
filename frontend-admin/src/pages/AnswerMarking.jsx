import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { buildSlides } from '../utils/buildSlides';
import { AddTeamForm } from './QuizControl';

export default function AnswerMarking({ sessionId, quiz }) {
  const [data,       setData]      = useState(null);
  const [whoami,     setWhoami]    = useState(null);   // { whoami:{title,answer,clues}, guesses:[] }
  const [loading,    setLoading]   = useState(false);
  const [csvRoundId, setCsvRound]  = useState('all');
  // Live show position + lock state, used to auto-collapse finished rounds.
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [lockedRounds,    setLockedRounds]    = useState(new Set());
  // Manual expand/collapse overrides — a user click always wins over auto state.
  const [collapseOverride, setCollapseOverride] = useState({});
  const socket = useWebSocket();

  const slides = useMemo(() => buildSlides(quiz), [quiz]);

  // Index of each round's LAST answer-reveal slide. Once the host has advanced
  // beyond it (and the round is locked), the round's marking section folds away.
  const lastAnswerIndexByRound = useMemo(() => {
    const m = new Map();
    slides.forEach((s, i) => {
      if (s.type === 'answer' && s.roundId != null) m.set(s.roundId, i);
    });
    return m;
  }, [slides]);

  const loadData = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const [result, wa] = await Promise.all([
        api.get(`/answers/session/${sessionId}`),
        api.get(`/whoami/session/${sessionId}`).catch(() => ({ whoami: null, guesses: [] }))
      ]);
      setData(result);
      setWhoami(wa);
    } catch (err) {
      console.error('Failed to load marking data:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Live show position + lock state ────────────────────────────────────────
  // Join the session room from this page too (the shared socket may not have
  // joined yet if Control wasn't opened) — the server replies with
  // session_state, which carries slideIndex + lockedRoundIds.
  useEffect(() => {
    if (!socket || !sessionId) return;
    const rejoin = () => socket.emit('join_quiz', { sessionId, role: 'admin' });
    const onSessionState = (d) => {
      if (typeof d.slideIndex === 'number') setCurrentSlideIdx(d.slideIndex);
      if (Array.isArray(d.lockedRoundIds)) setLockedRounds(new Set(d.lockedRoundIds));
    };
    const onSlide = (d) => {
      if (typeof d.slideIndex === 'number') setCurrentSlideIdx(d.slideIndex);
    };
    const onLocked   = (d) => setLockedRounds(prev => new Set([...prev, d.roundId]));
    const onUnlocked = (d) => setLockedRounds(prev => {
      const next = new Set(prev);
      next.delete(d.roundId);
      return next;
    });

    socket.on('connect',         rejoin);
    socket.on('session_state',   onSessionState);
    socket.on('slide_changed',   onSlide);
    socket.on('answer_locked',   onLocked);
    socket.on('answer_unlocked', onUnlocked);
    if (socket.connected) rejoin();

    return () => {
      socket.off('connect',         rejoin);
      socket.off('session_state',   onSessionState);
      socket.off('slide_changed',   onSlide);
      socket.off('answer_locked',   onLocked);
      socket.off('answer_unlocked', onUnlocked);
    };
  }, [socket, sessionId]);

  // A round auto-collapses once it's locked AND the show has moved past its
  // last answer-reveal slide. A manual click on the header always overrides.
  const isAutoCollapsed = useCallback((roundId) => {
    const last = lastAnswerIndexByRound.get(roundId);
    return lockedRounds.has(roundId) && last != null && currentSlideIdx > last;
  }, [lastAnswerIndexByRound, lockedRounds, currentSlideIdx]);

  const isCollapsed = (roundId) =>
    collapseOverride[roundId] !== undefined ? collapseOverride[roundId] : isAutoCollapsed(roundId);

  const toggleRound = (roundId) =>
    setCollapseOverride(prev => ({ ...prev, [roundId]: !isCollapsed(roundId) }));

  // Apply a single mark to local state immediately — no full reload required.
  // points === null means the score was removed (deselected).
  const applyMarkLocal = useCallback((teamId, questionId, points) => {
    setData(prev => {
      if (!prev) return prev;
      let scores = Array.isArray(prev.scores) ? [...prev.scores] : [];
      const idx = scores.findIndex(s => s.team_id === teamId && s.question_id === questionId);
      if (points === null) {
        // Remove the score row entirely
        if (idx >= 0) scores.splice(idx, 1);
      } else {
        const row = { team_id: teamId, question_id: questionId, points_awarded: points };
        if (idx >= 0) scores[idx] = row;
        else          scores.push(row);
      }
      return { ...prev, scores };
    });
  }, []);

  // Update a team's manual/bonus (brownie) total in local state.
  const applyBrownieLocal = useCallback((teamId, total) => {
    setData(prev => {
      if (!prev) return prev;
      const brownie = Array.isArray(prev.brownie) ? [...prev.brownie] : [];
      const idx = brownie.findIndex(b => b.team_id === teamId);
      if (idx >= 0) brownie[idx] = { ...brownie[idx], total };
      else          brownie.push({ team_id: teamId, total });
      return { ...prev, brownie };
    });
  }, []);

  // Apply broadcasted marks immediately too (avoids full network reload).
  useEffect(() => {
    if (!socket) return;
    const onMarked = (m) => {
      if (!m || m.teamId == null) return;
      // questionId null = a manual/bonus points broadcast, not a question mark
      if (m.questionId == null) {
        if (m.brownieTotal !== undefined) applyBrownieLocal(parseInt(m.teamId), parseFloat(m.brownieTotal));
        return;
      }
      const pts = m.points === null || m.points === undefined ? null : parseFloat(m.points);
      applyMarkLocal(parseInt(m.teamId), parseInt(m.questionId), pts);
    };
    const onSubmitted = () => loadData();  // refresh answer text when a team submits
    const onTeamsChanged = () => loadData(); // team added/removed → refresh rows
    const onWhoamiMarked = (m) => {
      if (m && m.teamId != null) {
        const pts = m.points === null || m.points === undefined ? null : parseFloat(m.points);
        setWhoami(prev => {
          if (!prev) return prev;
          const guesses = [...(prev.guesses || [])];
          const idx = guesses.findIndex(g => g.team_id === parseInt(m.teamId));
          if (idx >= 0) guesses[idx] = { ...guesses[idx], points_awarded: pts };
          else          guesses.push({ team_id: parseInt(m.teamId), points_awarded: pts });
          return { ...prev, guesses };
        });
      }
    };
    socket.on('answer_marked',     onMarked);
    socket.on('answer_submitted',  onSubmitted);
    socket.on('whoami_locked',     onSubmitted);  // refresh guess text on lock-in
    socket.on('whoami_marked',     onWhoamiMarked);
    socket.on('team_joined',       onTeamsChanged);
    socket.on('team_removed',      onTeamsChanged);
    return () => {
      socket.off('answer_marked',    onMarked);
      socket.off('answer_submitted', onSubmitted);
      socket.off('whoami_locked',    onSubmitted);
      socket.off('whoami_marked',    onWhoamiMarked);
      socket.off('team_joined',      onTeamsChanged);
      socket.off('team_removed',     onTeamsChanged);
    };
  }, [socket, applyMarkLocal, applyBrownieLocal, loadData]);

  const mark = async (teamId, questionId, points) => {
    // Optimistic update — admin sees the score change the instant they click.
    applyMarkLocal(teamId, questionId, points);
    try {
      await api.post('/answers/mark', { teamId, questionId, points, sessionId });
    } catch (err) {
      console.error('Marking failed:', err);
      // Re-sync from server on failure so we don't leave stale optimistic state.
      loadData();
    }
  };

  // Manual override for a team's Who-Am-I score (null clears it).
  const markWhoami = async (teamId, points) => {
    setWhoami(prev => {
      if (!prev) return prev;
      const guesses = [...(prev.guesses || [])];
      const idx = guesses.findIndex(g => g.team_id === teamId);
      if (idx >= 0) guesses[idx] = { ...guesses[idx], points_awarded: points };
      else          guesses.push({ team_id: teamId, points_awarded: points });
      return { ...prev, guesses };
    });
    try {
      await api.post('/whoami/mark', { teamId, points, sessionId });
    } catch (err) {
      console.error('Who Am I marking failed:', err);
      loadData();
    }
  };

  // ── Admin team management (mirrors the Control lobby controls) ────────────
  const addTeam = async (name, size) => {
    await api.post('/teams', { sessionId, name, size });
    loadData();
  };

  const removeTeam = async (team) => {
    if (!confirm(`Remove team "${team.name}"? Their answers, scores and bonus points will be deleted.`)) return;
    try {
      await api.delete(`/teams/${team.id}`);
      loadData();
    } catch (err) {
      console.error('Failed to remove team:', err);
    }
  };

  // Add or subtract manual points for a team (whole numbers; negatives allowed).
  const awardManual = async (teamId, points) => {
    try {
      const resp = await api.post('/answers/brownie-points', {
        teamId, points, label: 'Manual points', sessionId
      });
      if (resp && resp.team_total !== undefined) applyBrownieLocal(teamId, parseFloat(resp.team_total));
    } catch (err) {
      console.error('Manual points failed:', err);
      loadData();
    }
  };

  const downloadCSV = () => {
    const p = new URLSearchParams({ sessionId });
    if (csvRoundId !== 'all') p.set('roundId', csvRoundId);
    window.open(`/api/answers/export?${p}`, '_blank');
  };

  // ── Idle / loading states ─────────────────────────────────────────────────
  if (!sessionId) {
    return (
      <div className="answer-marking">
        <h2>Answer Marking</h2>
        <p>Start a quiz session first to mark answers.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="answer-marking">
        <h2>Answer Marking</h2>
        <p>Loading…</p>
      </div>
    );
  }

  const { rounds = [], questions = [], teams = [], answers = [], scores = [], brownie = [] } = data || {};

  const brownieTotal = (teamId) => {
    const b = brownie.find(x => x.team_id === teamId);
    return b != null ? Number(b.total) : 0;
  };

  const getAnswer = (teamId, qId) =>
    answers.find(a => a.team_id === teamId && a.question_id === qId)?.answer_text ?? '';

  const getScore = (teamId, qId) => {
    const s = scores.find(s => s.team_id === teamId && s.question_id === qId);
    return s != null ? parseFloat(s.points_awarded) : null;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="answer-marking">

      {/* Header bar */}
      <div className="marking-header">
        <h2>Answer Marking {loading && <span className="marking-refreshing">↻</span>}</h2>
        <div className="marking-csv-bar">
          <select
            value={csvRoundId}
            onChange={e => setCsvRound(e.target.value)}
            className="csv-round-select"
          >
            <option value="all">All Rounds</option>
            {rounds.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button onClick={downloadCSV} className="btn btn-primary btn-sm">↓ Download CSV</button>
          <button onClick={loadData}   className="btn btn-secondary btn-sm" disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      {teams.length === 0 && (
        <p className="marking-empty">No teams have joined this session yet.</p>
      )}

      {/* ── Teams + manual/bonus points — add/remove teams and adjust points at
             any time; points count in the scoreboard's Bonus column ── */}
      {data && (
        <div className="marking-round marking-manual">
          <h3 className="marking-round-title">
            <span className="round-badge">±</span>
            Teams &amp; Manual Points
            <span className="round-q-count">add or subtract per team — shows in the Bonus column</span>
          </h3>
          <div className="marking-team-rows">
            {teams.map(t => (
              <ManualPointsRow
                key={t.id}
                team={t}
                total={brownieTotal(t.id)}
                onAward={(pts) => awardManual(t.id, pts)}
                onRemove={() => removeTeam(t)}
              />
            ))}
            <AddTeamForm onAdd={addTeam} />
          </div>
        </div>
      )}

      {rounds.map((round, idx) => {
        const rqs = questions.filter(q => q.round_id === round.id);
        const collapsed = isCollapsed(round.id);
        const locked    = lockedRounds.has(round.id);
        return (
          <div key={round.id} className={`marking-round ${collapsed ? 'marking-round-collapsed' : ''}`}>

            {/* "Marking Your Answers" divider between rounds */}
            {idx > 0 && !collapsed && (
              <div className="marking-divider">
                <span>✦ Marking Your Answers ✦</span>
              </div>
            )}

            <h3
              className="marking-round-title marking-round-toggle"
              onClick={() => toggleRound(round.id)}
              title={collapsed ? 'Expand this round' : 'Collapse this round'}
            >
              <span className="marking-chevron">{collapsed ? '▸' : '▾'}</span>
              <span className="round-badge">{idx + 1}</span>
              {round.name}
              {round.style === 'intermission' && <span className="qm-tag qm-tag-cat">🖼 Picture</span>}
              <span className="round-q-count">{rqs.length} question{rqs.length !== 1 ? 's' : ''}</span>
              {locked && <span className="marking-locked-badge">🔒 locked</span>}
            </h3>

            {!collapsed && rqs.map(q => (
              <div key={q.id} className="marking-question">
                <div className="marking-q-header">
                  <span className="marking-q-num">Q{q.order}</span>
                  <span className="marking-q-text">{q.text}</span>
                  <span className="marking-q-answer">✓ {q.answer}</span>
                  <span className="marking-q-pts">{q.points}pt</span>
                </div>

                <div className="marking-team-rows">
                  {teams.length === 0 ? (
                    <p className="marking-empty">No teams yet</p>
                  ) : teams.map(t => {
                    const ansText = getAnswer(t.id, q.id);
                    const score   = getScore(t.id, q.id);
                    return (
                      <div key={t.id} className="marking-team-row">
                        <span className="marking-team-name">{t.name}</span>
                        <span className={`marking-answer-text ${!ansText ? 'no-answer' : ''}`}>
                          {ansText || '(no answer)'}
                        </span>
                        <div className="marking-score-btns">
                          {[0, 0.5, 1].map(pts => (
                            <button
                              key={pts}
                              onClick={() => mark(t.id, q.id, score === pts ? null : pts)}
                              className={`score-btn ${score === pts ? 'score-btn-active' : ''}`}
                              title={score === pts ? 'Click to remove mark' : `Award ${pts} point${pts !== 1 ? 's' : ''}`}
                            >
                              {pts}
                            </button>
                          ))}
                          {score !== null && (
                            <span className={`score-pill ${score === 1 ? 'pill-full' : score === 0.5 ? 'pill-half' : 'pill-zero'}`}>
                              {score}pt
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* ── Who Am I? marking ── */}
      {whoami?.whoami && (
        <div className="marking-round marking-whoami">
          <div className="marking-divider"><span>🕵 Who Am I?</span></div>
          <h3 className="marking-round-title">
            <span className="round-badge">🕵</span>
            {whoami.whoami.title}
            <span className="marking-q-answer">✓ {whoami.whoami.answer || '(no answer set)'}</span>
          </h3>
          <div className="marking-team-rows">
            {teams.length === 0 ? (
              <p className="marking-empty">No teams yet</p>
            ) : teams.map(t => {
              const g = (whoami.guesses || []).find(x => x.team_id === t.id);
              const possible = g?.points_possible != null ? parseFloat(g.points_possible) : null;
              const awarded  = g?.points_awarded  != null ? parseFloat(g.points_awarded)  : null;
              return (
                <div key={t.id} className="marking-team-row">
                  <span className="marking-team-name">{t.name}</span>
                  <span className={`marking-answer-text ${!g?.guess_text ? 'no-answer' : ''}`}>
                    {g?.guess_text || '(no guess)'}
                    {g?.locked_clue_index != null && (
                      <em className="whoami-mark-clue"> · locked on clue {g.locked_clue_index + 1}</em>
                    )}
                  </span>
                  <div className="marking-score-btns">
                    <button
                      onClick={() => markWhoami(t.id, awarded === 0 ? null : 0)}
                      className={`score-btn ${awarded === 0 ? 'score-btn-active' : ''}`}
                      title="Award 0"
                    >0</button>
                    {possible != null && possible > 0 && (
                      <button
                        onClick={() => markWhoami(t.id, awarded === possible ? null : possible)}
                        className={`score-btn ${awarded === possible ? 'score-btn-active' : ''}`}
                        title={`Award the full ${possible} points for the clue they locked on`}
                      >{possible}</button>
                    )}
                    {awarded != null && (
                      <span className={`score-pill ${awarded > 0 ? 'pill-full' : 'pill-zero'}`}>{awarded}pt</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rounds.length === 0 && data && (
        <p className="marking-empty">No rounds found for this session.</p>
      )}
    </div>
  );
}

// One team's manual-points row: current bonus total plus an amount input with
// add / subtract buttons. Whole points only (the brownie_points column is INT).
function ManualPointsRow({ team, total, onAward, onRemove }) {
  const [amount, setAmount] = useState('1');
  const apply = (sign) => {
    const v = Math.abs(parseInt(amount, 10));
    if (!v || Number.isNaN(v)) return;
    onAward(sign * v);
  };
  return (
    <div className="marking-team-row">
      <span className="marking-team-name">{team.name}</span>
      <span className={`manual-total ${total > 0 ? 'manual-pos' : total < 0 ? 'manual-neg' : ''}`}>
        {total > 0 ? `+${total}` : total} pt
      </span>
      <div className="marking-score-btns manual-controls">
        <input
          type="number"
          className="manual-input"
          min="1"
          step="1"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          title="Points to add or subtract"
        />
        <button className="score-btn" onClick={() => apply(1)}  title="Add points">＋</button>
        <button className="score-btn" onClick={() => apply(-1)} title="Subtract points">−</button>
        {onRemove && (
          <button
            className="btn btn-sm btn-danger"
            onClick={onRemove}
            title="Remove this team (deletes their answers and scores)"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
