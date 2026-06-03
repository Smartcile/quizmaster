import { useState, useEffect } from 'react';
import { api } from '../services/api';

const STATUS_LABEL = { lobby: 'In Lobby', active: 'Live Now', finished: 'Finished' };

export default function Dashboard({ onResume, onQuizStart, activeQuizId }) {
  const [stats, setStats] = useState(null);
  const [quizzes, setQuizzes] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, qs] = await Promise.all([
        api.get('/questions/stats'),
        api.get('/quizzes')
      ]);
      setStats(s);
      setQuizzes(qs);

      // Find live sessions
      const liveResults = await Promise.all(
        qs.map(async (q) => {
          try {
            const session = await api.get(`/quizzes/${q.id}/active-session`);
            return { quiz: q, session };
          } catch {
            return null;
          }
        })
      );
      setActiveSessions(liveResults.filter(Boolean));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startQuiz = async (quizId, isTest = false) => {
    try {
      const [session, quiz] = await Promise.all([
        api.post(`/quizzes/${quizId}/start`, { isTest }),
        api.get(`/quizzes/${quizId}`)
      ]);
      onQuizStart(session.id, quiz, isTest);
    } catch (err) {
      setError(`Failed to ${isTest ? 'start test' : 'start'}: ` + err.message);
    }
  };

  const resumeSession = async (quiz) => {
    try {
      const fullQuiz = await api.get(`/quizzes/${quiz.id}`);
      const session = await api.get(`/quizzes/${quiz.id}/active-session`);
      onQuizStart(session.id, fullQuiz);
    } catch (err) {
      setError('Failed to resume: ' + err.message);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <button onClick={refresh} className="btn btn-secondary btn-sm" disabled={loading}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

      {/* Live Sessions - prominent at top */}
      {activeSessions.length > 0 ? (
        <div className="live-sessions">
          {activeSessions.map(({ quiz, session }) => (
            <div key={session.id} className={`live-session-card status-${session.status}`}>
              <div className="live-pulse" />
              <div className="live-content">
                <div className="live-label">
                  {session.status === 'active' ? '● LIVE NOW' : '● IN LOBBY'}
                </div>
                <h3>{quiz.name}</h3>
                <p>Code: <strong>{quiz.code}</strong> · Slide {(session.current_slide_index || 0) + 1}</p>
              </div>
              <button onClick={() => resumeSession(quiz)} className="btn btn-success">
                {activeQuizId === session.id ? '✓ Currently Controlling' : 'Resume Control →'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="neutral-state">
          <div className="neutral-icon">⚫</div>
          <h3>No Active Session</h3>
          <p>Start a quiz below to begin a new session.</p>
        </div>
      )}

      {/* Metrics */}
      {stats && (
        <div className="stats-grid">
          <StatCard label="Questions" value={stats.questions} color="cyan" icon="❓" />
          <StatCard label="Rounds" value={stats.rounds} color="purple" icon="🎯" />
          <StatCard label="Quizzes" value={stats.quizzes} color="magenta" icon="📚" />
          <StatCard label="Live Sessions" value={stats.activeSessions} color="green" icon="🟢" />
        </div>
      )}

      {stats && (stats.byDifficulty?.length > 0 || stats.byCategory?.length > 0) && (
        <div className="stats-row">
          {stats.byDifficulty?.length > 0 && (
            <div className="panel stats-panel">
              <h3>Questions by Difficulty</h3>
              <div className="stat-bars">
                {stats.byDifficulty.map(d => (
                  <div key={d.difficulty} className="stat-bar-row">
                    <span className={`qm-difficulty qm-difficulty-${d.difficulty}`}>{d.difficulty}</span>
                    <div className="stat-bar-track">
                      <div
                        className={`stat-bar-fill stat-bar-${d.difficulty}`}
                        style={{ width: `${(d.count / stats.questions) * 100}%` }}
                      />
                    </div>
                    <span className="stat-count">{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.byCategory?.length > 0 && (
            <div className="panel stats-panel">
              <h3>Top Categories</h3>
              <div className="stat-bars">
                {stats.byCategory.slice(0, 6).map(c => (
                  <div key={c.category} className="stat-bar-row">
                    <span className="stat-cat-name">{c.category}</span>
                    <div className="stat-bar-track">
                      <div
                        className="stat-bar-fill stat-bar-cat"
                        style={{ width: `${(c.count / stats.byCategory[0].count) * 100}%` }}
                      />
                    </div>
                    <span className="stat-count">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quizzes */}
      <div className="panel">
        <h3>All Quizzes ({quizzes.length})</h3>
        {quizzes.length === 0 ? (
          <p className="qm-empty">No quizzes yet. Build one in the Quizzes tab.</p>
        ) : (
          <div className="quiz-list">
            {quizzes.map(quiz => {
              const isLive = activeSessions.some(a => a.quiz.id === quiz.id);
              return (
                <div key={quiz.id} className={`quiz-card ${isLive ? 'is-live' : ''}`}>
                  <h4>{quiz.name}</h4>
                  <p>Code: <strong>{quiz.code}</strong></p>
                  <div className="quiz-card-start-actions">
                    {isLive ? (
                      <span className="live-indicator">● LIVE</span>
                    ) : (
                      <button onClick={() => startQuiz(quiz.id)} className="btn btn-success btn-sm">▶ Start Session</button>
                    )}
                    <button
                      onClick={() => startQuiz(quiz.id, true)}
                      className="btn btn-secondary btn-sm btn-test-quiz"
                      title="Run a test session with bot teams and embedded previews"
                    >
                      🧪 Test Quiz
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div className={`stat-card stat-${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-info">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}
