import { useState, useEffect, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { buildSlides, slideShortLabel } from '../utils/buildSlides';
import { api } from '../services/api';

export default function QuizControl({ sessionId, quiz, onSessionEnd }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [sessionStatus, setSessionStatus] = useState('lobby');
  const [teams, setTeams] = useState([]);
  const [lockedRounds, setLockedRounds] = useState(new Set());
  const [portalConfig, setPortalConfig] = useState(null);
  const socket = useWebSocket();
  const slides = useMemo(() => buildSlides(quiz), [quiz]);
  const teamsCount = teams.length;

  // ── Load portal URL config once ──────────────────────────────────────────
  useEffect(() => {
    api.get('/config').then(c => setPortalConfig(c)).catch(() => {});
  }, []);

  // ── Initial state from REST ──────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    api.get(`/quizzes/sessions/${sessionId}`).then(s => {
      setSessionStatus(s.status);
      setCurrentSlide(s.current_slide_index || 0);
      const locked = Array.isArray(s.locked_round_ids) ? s.locked_round_ids : [];
      setLockedRounds(new Set(locked));
    }).catch(() => {});

    api.get(`/teams/session/${sessionId}`).then(setTeams).catch(() => {});
  }, [sessionId]);

  // ── WebSocket subscriptions + auto-rejoin ────────────────────────────────
  useEffect(() => {
    if (!sessionId || !socket) return;

    // Unified join/rejoin — called on every (re)connect
    const rejoin = () => socket.emit('join_quiz', { sessionId, role: 'admin' });

    // session_state: sent by server on every join_quiz — restores full state after reconnect
    const onSessionState = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
      if (data.status) setSessionStatus(data.status);
      if (Array.isArray(data.lockedRoundIds)) setLockedRounds(new Set(data.lockedRoundIds));
    };

    const onSlide = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
    };

    const onStatus = (data) => {
      setSessionStatus(data.status);
      if (typeof data.currentSlideIndex === 'number') setCurrentSlide(data.currentSlideIndex);
      // Reload team list whenever the session returns to lobby (e.g. after restart)
      if (data.status === 'lobby') {
        api.get(`/teams/session/${sessionId}`).then(setTeams).catch(() => {});
      }
    };

    const onTeamJoin = () => {
      api.get(`/teams/session/${sessionId}`).then(setTeams).catch(() => {});
    };

    const onLocked = (data) => {
      setLockedRounds(prev => new Set([...prev, data.roundId]));
    };
    const onUnlocked = (data) => {
      setLockedRounds(prev => {
        const next = new Set(prev);
        next.delete(data.roundId);
        return next;
      });
    };

    socket.on('connect',                rejoin);
    socket.on('session_state',          onSessionState);
    socket.on('slide_changed',          onSlide);
    socket.on('session_status_changed', onStatus);
    socket.on('team_joined',            onTeamJoin);
    socket.on('answer_locked',          onLocked);
    socket.on('answer_unlocked',        onUnlocked);

    // If socket is already connected when the effect runs, join immediately
    if (socket.connected) rejoin();

    return () => {
      socket.off('connect',                rejoin);
      socket.off('session_state',          onSessionState);
      socket.off('slide_changed',          onSlide);
      socket.off('session_status_changed', onStatus);
      socket.off('team_joined',            onTeamJoin);
      socket.off('answer_locked',          onLocked);
      socket.off('answer_unlocked',        onUnlocked);
    };
  }, [sessionId, socket]);

  // ── Slide advance via REST (guaranteed DB write + broadcast) ────────────
  // Falls back to WS emit if the REST call fails so the show can go on.
  // Auto-locks a round's answers when the host crosses into its first answer
  // slide, so quizzers can't keep tweaking submissions while reveals play.
  const goToSlide = async (index) => {
    if (index < 0 || index >= slides.length) return;
    const target = slides[index];

    setCurrentSlide(index); // optimistic
    try {
      await api.put(`/quizzes/sessions/${sessionId}/slide`, { slideIndex: index });
    } catch {
      // REST failed — fall back to WebSocket path
      if (socket) socket.emit('slide_changed', { sessionId, slideIndex: index });
    }

    // Auto-lock: entering an answer slide for a round that isn't already locked
    if (target?.type === 'answer' && target.roundId && socket && !lockedRounds.has(target.roundId)) {
      socket.emit('answer_locked', { sessionId, roundId: target.roundId });
    }
  };

  // ── Session lifecycle via REST — server now handles the WS broadcast ─────
  const changeStatus = async (status) => {
    try {
      await api.put(`/quizzes/sessions/${sessionId}/status`, { status });
      setSessionStatus(status); // optimistic — WS echo will confirm
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const restart = async () => {
    if (!confirm('Restart this session? Teams stay but slides go back to start.')) return;
    try {
      await api.post(`/quizzes/sessions/${sessionId}/restart`);
      setSessionStatus('lobby');
      setCurrentSlide(0);
      // Reload teams so the lobby list is current after restart
      api.get(`/teams/session/${sessionId}`).then(setTeams).catch(() => {});
      // server broadcasts session_status_changed to all clients
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const lockAnswers = () => {
    const slide = slides[currentSlide];
    if (socket && slide?.roundId) {
      socket.emit('answer_locked', { sessionId, roundId: slide.roundId });
    }
  };

  const unlockAnswers = () => {
    const slide = slides[currentSlide];
    if (socket && slide?.roundId) {
      socket.emit('answer_unlocked', { sessionId, roundId: slide.roundId });
    }
  };

  const closeSession = async () => {
    if (!confirm('Close this session? Teams will be disconnected and the session will be ended.')) return;
    try {
      await api.put(`/quizzes/sessions/${sessionId}/status`, { status: 'finished' });
    } catch (err) {
      // Surface but still return to dashboard
      console.error('Failed to set finished:', err);
    }
    if (onSessionEnd) onSessionEnd();
  };

  if (!sessionId || !quiz) {
    return (
      <div className="quiz-control">
        <h2>Quiz Control</h2>
        <p>Go to Dashboard and click "Start Quiz" to begin a session.</p>
      </div>
    );
  }

  const current = slides[currentSlide];
  const next    = slides[currentSlide + 1];

  return (
    <div className="quiz-control">
      <div className="control-header">
        <div>
          <h2>{quiz.name}</h2>
          <p className="control-meta">
            Code: <strong>{quiz.code}</strong> · Slide {currentSlide + 1}/{slides.length} ·
            Teams joined: <strong>{teamsCount}</strong>
          </p>
        </div>
        <div className={`session-status status-${sessionStatus}`}>
          {sessionStatus.toUpperCase()}
        </div>
      </div>

      <div className="lifecycle-buttons">
        {sessionStatus === 'lobby' && (
          <>
            <button onClick={() => changeStatus('active')} className="btn btn-success btn-lg">
              ▶ Begin Quiz
            </button>
            <button onClick={closeSession} className="btn btn-danger">
              ✕ Close Session
            </button>
          </>
        )}
        {sessionStatus === 'active' && (
          <>
            <button onClick={() => changeStatus('lobby')}    className="btn btn-warning">⏸ Back to Lobby</button>
            <button onClick={restart}                         className="btn btn-secondary">↺ Restart Session</button>
            <button
              onClick={() => {
                if (confirm('End the quiz? This will mark the session as finished and lock all answers.')) {
                  changeStatus('finished');
                }
              }}
              className="btn btn-danger"
            >
              ⏹ End Quiz
            </button>
          </>
        )}
        {sessionStatus === 'finished' && (
          <>
            <button onClick={restart}        className="btn btn-primary">↺ Restart from Beginning</button>
            <button onClick={onSessionEnd}   className="btn btn-secondary">✕ Close Session</button>
          </>
        )}
      </div>

      {sessionStatus === 'active' && portalConfig && (
        <div className="portal-links">
          <span className="portal-links-label">Open portals:</span>
          <a
            href={portalConfig.quizzerUrl ||
              `${window.location.protocol}//${window.location.hostname}:3003`}
            target="_blank"
            rel="noreferrer"
            className="portal-link-btn portal-link-quizzer"
          >
            📱 Quizzer Portal
          </a>
          <a
            href={portalConfig.slideshowUrl ||
              `${window.location.protocol}//${window.location.hostname}:3002`}
            target="_blank"
            rel="noreferrer"
            className="portal-link-btn portal-link-slideshow"
          >
            🖥 Display / Slideshow
          </a>
        </div>
      )}

      {sessionStatus === 'active' && (
        <>
          <div className="slide-navigation">
            <button onClick={() => goToSlide(currentSlide - 1)} disabled={currentSlide === 0}                    className="btn btn-primary">← Previous</button>
            <button onClick={() => goToSlide(currentSlide + 1)} disabled={currentSlide >= slides.length - 1}     className="btn btn-primary">Next →</button>
            {current?.roundId && lockedRounds.has(current.roundId) ? (
              <button onClick={unlockAnswers} className="btn btn-success">🔓 Unlock Round Answers</button>
            ) : (
              <button onClick={lockAnswers} disabled={!current?.roundId} className="btn btn-warning">🔒 Lock Round Answers</button>
            )}
          </div>

          <div className="presenter-view">
            <div className="current-slide">
              <h3>Now Showing</h3>
              <div className="slide-preview-card">
                <SlidePreview slide={current} />
              </div>
            </div>
            <div className="next-slide">
              <h3>Up Next</h3>
              <div className="slide-preview-card faded">
                {next ? <SlidePreview slide={next} /> : <p>End of quiz</p>}
              </div>
            </div>
          </div>

          <div className="slide-thumbnails">
            <h3>All Slides</h3>
            <div className="thumbnails">
              {slides.map((slide, i) => (
                <button
                  key={i}
                  onClick={() => goToSlide(i)}
                  className={`thumbnail ${i === currentSlide ? 'active' : ''}`}
                  title={slideShortLabel(slide)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {sessionStatus === 'lobby' && (
        <div className="lobby-help">
          <h3>Lobby</h3>
          <p className="lobby-join-instructions">
            Teams visit{' '}
            <code>
              {portalConfig?.quizzerUrl ||
                `${window.location.protocol}//${window.location.host.replace(/:\d+$/, ':3003')}`}
            </code>{' '}
            and enter code <strong>{quiz.code}</strong>. Click <strong>Begin Quiz</strong> when ready.
          </p>

          <div className="lobby-teams-panel">
            <div className="lobby-teams-header">
              <h4>Joined teams</h4>
              <span className="lobby-teams-count">
                {teamsCount} team{teamsCount !== 1 ? 's' : ''}
              </span>
            </div>

            {teamsCount === 0 ? (
              <p className="lobby-teams-empty">No teams have joined yet — waiting for first join…</p>
            ) : (
              <ul className="lobby-teams-list">
                {teams.map((t) => (
                  <li key={t.id} className="lobby-team-item">
                    <span className="lobby-team-name">{t.name}</span>
                    {t.size != null && (
                      <span className="lobby-team-size">
                        {t.size} player{t.size !== 1 ? 's' : ''}
                      </span>
                    )}
                    {t.created_at && (
                      <span className="lobby-team-joined">
                        joined {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SlidePreview({ slide }) {
  if (!slide) return <p>No slide</p>;
  switch (slide.type) {
    case 'intro':
      return <div><h4>{slide.title}</h4><p>{slide.subtitle}</p></div>;
    case 'round_intro':
      return <div><h4 style={{ color: '#b829ff' }}>Round Start</h4><p style={{ fontSize: '1.3rem' }}>{slide.title}</p></div>;
    case 'question':
      return (
        <div>
          <p className="preview-label">{slide.roundName} · Q{slide.questionNumber}/{slide.totalInRound} · {slide.points}pt</p>
          <h4>{slide.text}</h4>
          {slide.mediaUrl && <p className="preview-media">📎 {slide.questionType}: {slide.mediaUrl}</p>}
        </div>
      );
    case 'mark_answers':
      return (
        <div>
          <p className="preview-label" style={{ color: '#ffb347' }}>✦ Mark Your Answers ✦</p>
          <h4>{slide.roundName}</h4>
          <p>Final submission window. Advance to lock the round and start revealing answers.</p>
        </div>
      );
    case 'answer':
      return (
        <div>
          <p className="preview-label">{slide.roundName} · Answer to Q{slide.questionNumber}</p>
          <h4>{slide.text}</h4>
          <p className="preview-answer">✓ {slide.answer}</p>
        </div>
      );
    case 'widget':
      return <div><h4>Widget</h4><p>Type: {slide.widgetType}</p></div>;
    case 'end':
      return <div><h4>{slide.title}</h4><p>{slide.subtitle}</p></div>;
    default:
      return <p>{slide.type}</p>;
  }
}
