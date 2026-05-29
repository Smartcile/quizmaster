import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function QuizHistory() {
  const [sessions,    setSessions]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [expandedId,  setExpandedId]  = useState(null);
  const [results,     setResults]     = useState({}); // sessionId → { teams }
  const [loadingId,   setLoadingId]   = useState(null);

  useEffect(() => {
    api.get('/quizzes/sessions/history')
      .then(rows => { setSessions(rows); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const toggleExpand = async (sessionId) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sessionId);
    if (results[sessionId]) return; // already loaded

    setLoadingId(sessionId);
    try {
      const data = await api.get(`/quizzes/sessions/${sessionId}/results`);
      setResults(prev => ({ ...prev, [sessionId]: data }));
    } catch (err) {
      setError('Failed to load results: ' + err.message);
    } finally {
      setLoadingId(null);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
           ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const totalScore = (t) =>
    (parseFloat(t.score_total) || 0) + (parseFloat(t.brownie_total) || 0) + (parseFloat(t.size_points) || 0);

  if (loading) {
    return (
      <div className="quiz-history-page">
        <h2>Quiz History</h2>
        <p className="history-empty">Loading…</p>
      </div>
    );
  }

  return (
    <div className="quiz-history-page">
      <h2>Quiz History</h2>
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>
      )}

      {sessions.length === 0 ? (
        <div className="history-empty-state">
          <p className="history-empty">No finished quiz sessions yet.</p>
          <p className="history-empty-sub">Sessions appear here once you end a quiz from the Control page.</p>
        </div>
      ) : (
        <div className="history-list">
          {sessions.map(s => {
            const isOpen     = expandedId === s.session_id;
            const teamData   = results[s.session_id];
            const isLoading  = loadingId === s.session_id;

            return (
              <div key={s.session_id} className={`history-card ${isOpen ? 'history-card-open' : ''}`}>
                <button
                  className="history-card-header"
                  onClick={() => toggleExpand(s.session_id)}
                >
                  <div className="history-card-left">
                    <span className="history-quiz-name">{s.quiz_name}</span>
                    <span className="history-quiz-code">#{s.quiz_code}</span>
                  </div>
                  <div className="history-card-mid">
                    <span className="history-meta-item">
                      📅 {formatDate(s.created_at)}
                    </span>
                    {s.started_at && (
                      <span className="history-meta-item">
                        ▶ Started {formatDate(s.started_at)}
                      </span>
                    )}
                    <span className="history-meta-item history-teams-pill">
                      {s.team_count} team{s.team_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="history-chevron">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div className="history-card-body">
                    {isLoading && <p className="history-loading">Loading results…</p>}

                    {!isLoading && teamData && teamData.teams.length === 0 && (
                      <p className="history-no-teams">No teams in this session.</p>
                    )}

                    {!isLoading && teamData && teamData.teams.length > 0 && (() => {
                      const hasSizePoints = teamData.teams.some(t => (parseFloat(t.size_points) || 0) !== 0);
                      return (
                        <table className="history-teams-table">
                          <thead>
                            <tr>
                              <th className="col-rank">#</th>
                              <th className="col-name">Team</th>
                              <th className="col-size">Size</th>
                              <th className="col-score">Quiz pts</th>
                              <th className="col-bonus">Bonus</th>
                              {hasSizePoints && <th className="col-score">Handicap</th>}
                              <th className="col-total">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teamData.teams.map((t, i) => (
                              <tr key={t.id} className={i === 0 ? 'history-row-winner' : ''}>
                                <td className="col-rank">
                                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                </td>
                                <td className="col-name">{t.name}</td>
                                <td className="col-size">{t.size ?? '—'}</td>
                                <td className="col-score">{parseFloat(t.score_total) || 0}</td>
                                <td className="col-bonus">
                                  {parseFloat(t.brownie_total) > 0
                                    ? `+${parseFloat(t.brownie_total)}`
                                    : '—'}
                                </td>
                                {hasSizePoints && (
                                  <td className="col-score">
                                    {parseFloat(t.size_points) > 0
                                      ? `+${parseFloat(t.size_points)}`
                                      : parseFloat(t.size_points) < 0
                                        ? parseFloat(t.size_points)
                                        : '—'}
                                  </td>
                                )}
                                <td className="col-total history-total-pts">{totalScore(t)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}

                    <div className="history-card-footer">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const p = new URLSearchParams({ sessionId: s.session_id });
                          window.open(`/api/answers/export?${p}`, '_blank');
                        }}
                      >
                        ↓ Download CSV
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
