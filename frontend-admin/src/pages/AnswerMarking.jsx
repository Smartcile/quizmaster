import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';

export default function AnswerMarking({ sessionId }) {
  const [data,       setData]      = useState(null);
  const [loading,    setLoading]   = useState(false);
  const [csvRoundId, setCsvRound]  = useState('all');
  const socket = useWebSocket();

  const loadData = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const result = await api.get(`/answers/session/${sessionId}`);
      setData(result);
    } catch (err) {
      console.error('Failed to load marking data:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadData(); }, [loadData]);

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

  // Apply broadcasted marks immediately too (avoids full network reload).
  useEffect(() => {
    if (!socket) return;
    const onMarked = (m) => {
      if (m && m.teamId != null && m.questionId != null) {
        const pts = m.points === null || m.points === undefined ? null : parseFloat(m.points);
        applyMarkLocal(parseInt(m.teamId), parseInt(m.questionId), pts);
      }
    };
    const onSubmitted = () => loadData();  // refresh answer text when a team submits
    socket.on('answer_marked',     onMarked);
    socket.on('answer_submitted',  onSubmitted);
    return () => {
      socket.off('answer_marked',    onMarked);
      socket.off('answer_submitted', onSubmitted);
    };
  }, [socket, applyMarkLocal, loadData]);

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

  const { rounds = [], questions = [], teams = [], answers = [], scores = [] } = data || {};

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

      {rounds.map((round, idx) => {
        const rqs = questions.filter(q => q.round_id === round.id);
        return (
          <div key={round.id} className="marking-round">

            {/* "Marking Your Answers" divider between rounds */}
            {idx > 0 && (
              <div className="marking-divider">
                <span>✦ Marking Your Answers ✦</span>
              </div>
            )}

            <h3 className="marking-round-title">
              <span className="round-badge">{idx + 1}</span>
              {round.name}
              <span className="round-q-count">{rqs.length} question{rqs.length !== 1 ? 's' : ''}</span>
            </h3>

            {rqs.map(q => (
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

      {rounds.length === 0 && data && (
        <p className="marking-empty">No rounds found for this session.</p>
      )}
    </div>
  );
}
