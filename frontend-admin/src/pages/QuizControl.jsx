import { useState, useEffect, useMemo, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { buildSlides, slideShortLabel } from '../utils/buildSlides';
import { api } from '../services/api';
import LiveScoreboard from '../components/LiveScoreboard';
import DownloadFilesModal from '../components/DownloadFilesModal';
import { getTestSettings } from '../utils/testSettings';

// Per-surface "reveal scores on the scoreboard slide" flags. Big screen +
// quizzer default ON (scores show when you reach a scoreboard slide); the admin
// inline panel ("This screen") defaults OFF.
const EMPTY_VIS = { slideshow: true, quizzer: true, admin: false };

export default function QuizControl({ sessionId, quiz, onSessionEnd, isTest = false }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [sessionStatus, setSessionStatus] = useState('lobby');
  const [teams, setTeams] = useState([]);
  const [lockedRounds, setLockedRounds] = useState(new Set());
  const [portalConfig, setPortalConfig] = useState(null);
  const [scoreboardVis, setScoreboardVis] = useState(EMPTY_VIS);
  const [filesOpen, setFilesOpen] = useState(false);
  const [showPreviews, setShowPreviews] = useState(false); // live-quiz embedded previews
  const [sessionCode, setSessionCode] = useState(null); // per-session join code
  const [playedSlides, setPlayedSlides] = useState(() => new Set()); // media slides already triggered
  const mediaNonceRef = useRef(0);
  const socket = useWebSocket();
  const slides = useMemo(() => buildSlides(quiz), [quiz]);
  const teamsCount = teams.length;

  // Canonical quizzer base URL: SLIDESHOW/QUIZZER_URL from /api/config, else
  // fall back to the current hostname on the quizzer port. Trailing slash stripped.
  const quizzerBase = (
    portalConfig?.quizzerUrl ||
    `${window.location.protocol}//${window.location.hostname}:3003`
  ).replace(/\/+$/, '');
  const slideshowBase = (
    portalConfig?.slideshowUrl ||
    `${window.location.protocol}//${window.location.hostname}:3002`
  ).replace(/\/+$/, '');
  // Deep links straight to this session with the per-session join code baked in
  // (falls back to the quiz code until the session's code has loaded):
  //   quizzer  → https://answer.website.com/GHQK7P
  //   slideshow → https://show.website.com/GHQK7P
  const joinCode = sessionCode || quiz.code;
  const quizzerJoinUrl   = `${quizzerBase}/${joinCode}`;
  const slideshowJoinUrl = `${slideshowBase}/${joinCode}`;

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
      setSessionCode(s.code || null);
      const locked = Array.isArray(s.locked_round_ids) ? s.locked_round_ids : [];
      setLockedRounds(new Set(locked));
      if (s.scoreboard_visibility) setScoreboardVis({ ...EMPTY_VIS, ...s.scoreboard_visibility });
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
      if (data.scoreboardVisibility) setScoreboardVis({ ...EMPTY_VIS, ...data.scoreboardVisibility });
    };

    const onScoreboardVis = (data) => {
      if (data?.visibility) setScoreboardVis({ ...EMPTY_VIS, ...data.visibility });
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
    socket.on('scoreboard_visibility_changed', onScoreboardVis);

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
      socket.off('scoreboard_visibility_changed', onScoreboardVis);
    };
  }, [sessionId, socket]);

  const reloadTeams = () => api.get(`/teams/session/${sessionId}`).then(setTeams).catch(() => {});

  // ── Toggle scoreboard visibility on a surface (persists + broadcasts) ──────
  const toggleScoreboard = async (surface) => {
    const next = { ...scoreboardVis, [surface]: !scoreboardVis[surface] };
    setScoreboardVis(next); // optimistic
    try {
      await api.put(`/quizzes/sessions/${sessionId}/scoreboard-visibility`, {
        surface, visible: next[surface]
      });
    } catch {
      setScoreboardVis(scoreboardVis); // revert on failure
    }
  };

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
    const autoClean = isTest && getTestSettings().autoCleanTest;
    const msg = isTest
      ? (autoClean
          ? 'Close this test? The test session and its bot teams/answers will be deleted.'
          : 'Close this test session?')
      : 'Close this session? Teams will be disconnected and the session will be ended.';
    if (!confirm(msg)) return;
    try {
      await api.put(`/quizzes/sessions/${sessionId}/status`, { status: 'finished' });
      if (autoClean) {
        // Test runs leave no trace: remove the session (cascades teams/answers/scores)
        await api.delete(`/quizzes/sessions/${sessionId}`);
      }
    } catch (err) {
      // Surface but still return to dashboard
      console.error('Failed to close session:', err);
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

  // ── Manual media playback (big screen only) ──────────────────────────────
  // The host plays a question's audio/video by sending media_play to the
  // slideshow; it never autoplays and never sounds on phones.
  const isMediaSlide = (s) => s?.type === 'question' && s.mediaUrl && (s.questionType === 'audio' || s.questionType === 'video');
  const currentPlayed = playedSlides.has(currentSlide);

  const playMedia = (index = currentSlide) => {
    if (!socket) return;
    mediaNonceRef.current += 1;
    socket.emit('media_play', { sessionId, slideIndex: index, nonce: mediaNonceRef.current });
    setPlayedSlides(prev => new Set(prev).add(index));
  };

  // Forward advance with PowerPoint-style "consume": the first forward press on
  // an unplayed media slide plays it; the next press moves to the next slide.
  const advance = () => {
    if (isMediaSlide(current) && !playedSlides.has(currentSlide)) { playMedia(currentSlide); return; }
    goToSlide(currentSlide + 1);
  };

  // Keyboard + USB presenter remote: arrows / PageUp-Down drive the show while a
  // session is active (ignored while typing in a field).
  useEffect(() => {
    if (sessionStatus !== 'active') return;
    const onKey = (e) => {
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); advance(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goToSlide(currentSlide - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionStatus, currentSlide, current, playedSlides, socket]);

  return (
    <div className={`quiz-control ${isTest ? 'quiz-control-test' : ''}`}>
      {isTest && (
        <div className="test-banner">
          🧪 <strong>Quiz Testing</strong> — bot teams auto-answer as you advance the slides.
          This run is hidden from History{getTestSettings().autoCleanTest ? ' and deleted when you close it' : ''}.
        </div>
      )}
      <div className={isTest ? 'test-layout' : undefined}>
        <div className={isTest ? 'test-controls-col' : undefined}>
      <div className="control-header">
        <div>
          <h2>{quiz.name}</h2>
          <p className="control-meta">
            Join code: <strong>{joinCode}</strong> · Slide {currentSlide + 1}/{slides.length} ·
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
        <button
          onClick={() => setFilesOpen(true)}
          className="btn btn-secondary"
          title="Download offline quiz files (PDFs + slideshow)"
        >
          ⬇ Download Quiz Files
        </button>
      </div>

      {(sessionStatus === 'lobby' || sessionStatus === 'active') && (
        <div className="portal-links">
          <span className="portal-links-label">Open portals:</span>
          <a
            href={quizzerJoinUrl}
            target="_blank"
            rel="noreferrer"
            className="portal-link-btn portal-link-quizzer"
          >
            📱 Quizzer Portal
          </a>
          <a
            href={slideshowJoinUrl}
            target="_blank"
            rel="noreferrer"
            className="portal-link-btn portal-link-slideshow"
          >
            🖥 Display / Slideshow
          </a>
          {!isTest && (
            <button type="button" className="portal-link-btn" onClick={() => setShowPreviews(v => !v)}>
              {showPreviews ? '🙈 Hide previews' : '👁 Show previews'}
            </button>
          )}
        </div>
      )}

      {!isTest && showPreviews && (sessionStatus === 'lobby' || sessionStatus === 'active') && (
        <div className="panel live-preview-panel">
          <PreviewPanes
            sessionId={sessionId}
            quizCode={quiz.code}
            quizzerBase={quizzerBase}
            slideshowBase={slideshowBase}
            teams={teams.map(t => ({ name: t.name, size: t.size }))}
            surfaces={{ slideshow: true, quizzer: true }}
            defaultMode={teams.length ? 'mirror' : 'interactive'}
          />
        </div>
      )}

      {(sessionStatus === 'active' || sessionStatus === 'finished') && (
        <div className="scoreboard-controls">
          <span className="scoreboard-controls-label" title="Only affects scoreboard slides — turn a surface off to keep scores hidden when you land on one">📊 On a scoreboard slide, reveal scores on:</span>
          <button
            type="button"
            className={`sb-toggle ${scoreboardVis.slideshow ? 'on' : ''}`}
            onClick={() => toggleScoreboard('slideshow')}
            title="Reveal/hide scores on the scoreboard slide for the big screen"
          >
            🖥 Display {scoreboardVis.slideshow ? '✓' : '✕'}
          </button>
          <button
            type="button"
            className={`sb-toggle ${scoreboardVis.quizzer ? 'on' : ''}`}
            onClick={() => toggleScoreboard('quizzer')}
            title="Reveal/hide scores on the scoreboard slide for the quizzers"
          >
            📱 Quizzers {scoreboardVis.quizzer ? '✓' : '✕'}
          </button>
          <button
            type="button"
            className={`sb-toggle ${scoreboardVis.admin ? 'on' : ''}`}
            onClick={() => toggleScoreboard('admin')}
            title="Show the live scoreboard on this control screen"
          >
            👁 This screen {scoreboardVis.admin ? '✓' : ''}
          </button>
        </div>
      )}

      {(sessionStatus === 'active' || sessionStatus === 'finished') && scoreboardVis.admin && (
        <div className="panel scoreboard-admin-panel">
          <LiveScoreboard sessionId={sessionId} socket={socket} title="Live Scoreboard" />
        </div>
      )}

      {sessionStatus === 'active' && (
        <>
          <div className="slide-navigation">
            <button onClick={() => goToSlide(currentSlide - 1)} disabled={currentSlide === 0}                    className="btn btn-primary">← Previous</button>
            <button onClick={advance} disabled={currentSlide >= slides.length - 1 && !(isMediaSlide(current) && !currentPlayed)} className="btn btn-primary">
              {isMediaSlide(current) && !currentPlayed ? '▶ Play media' : 'Next →'}
            </button>
            {isMediaSlide(current) && (
              <button onClick={() => playMedia()} className="btn btn-secondary" title="Play this on the big screen (phones stay silent)">
                {currentPlayed ? '⟳ Replay media' : '▶ Play media'}
              </button>
            )}
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
            <div className="slide-groups">
              {groupSlidesForControl(slides).map((group) => (
                <div key={group.key} className="slide-group">
                  <span className="slide-group-label">{group.label}</span>
                  <div className="slide-group-thumbs">
                    {group.slides.map(({ slide, index }) => (
                      <button
                        key={index}
                        onClick={() => goToSlide(index)}
                        className={`slide-thumb ${index === currentSlide ? 'active' : ''}`}
                        title={`#${index + 1} · ${slideShortLabel(slide)}`}
                      >
                        <MiniSlide slide={slide} />
                        <span className="slide-thumb-num">{index + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
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
            <code>{quizzerJoinUrl}</code>{' '}
            (code <strong>{joinCode}</strong> is pre-filled). Click <strong>Begin Quiz</strong> when ready.
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
        </div>{/* /test-controls-col */}

        {isTest && (
          <TestHarness
            sessionId={sessionId}
            quiz={quiz}
            slides={slides}
            currentSlide={currentSlide}
            sessionStatus={sessionStatus}
            socket={socket}
            quizzerBase={quizzerBase}
            slideshowBase={slideshowBase}
            onTeamsChanged={reloadTeams}
          />
        )}
      </div>{/* /test-layout */}

      {filesOpen && (
        <DownloadFilesModal quiz={quiz} onClose={() => setFilesOpen(false)} />
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
    case 'whoami_clue':
      return <div><h4 style={{ color: '#b829ff' }}>🕵 Who Am I? — Clue {slide.clueIndex + 1}</h4><p>{slide.text}</p><p className="preview-label">{slide.points} pt if locked now</p></div>;
    case 'widget':
      return <div><h4>Widget</h4><p>Type: {slide.widgetType}</p></div>;
    case 'end':
      return <div><h4>{slide.title}</h4><p>{slide.subtitle}</p></div>;
    default:
      return <p>{slide.type}</p>;
  }
}

// ── Group the flat slide list into per-module rows for the control thumbnails ──
// Groups follow quiz order: Intro · Who Am I? #n · each Round (its intro →
// questions → mark → answers) · each widget · End.
function groupSlidesForControl(slides) {
  const groups = [];
  let cur = null;
  const push = (key, label, slide, index) => {
    if (!cur || cur.key !== key) {
      cur = { key, label, slides: [] };
      groups.push(cur);
    }
    cur.slides.push({ slide, index });
  };

  slides.forEach((slide, i) => {
    switch (slide.type) {
      case 'intro':
        push('intro', 'Intro', slide, i);
        break;
      case 'whoami_clue':
        push(`whoami-${slide.clueIndex}`, `Who Am I? #${slide.clueIndex + 1}`, slide, i);
        break;
      case 'round_intro':
      case 'question':
      case 'mark_answers':
      case 'answer':
        push(`round-${slide.roundId}`, slide.roundName || slide.title || 'Round', slide, i);
        break;
      case 'widget':
        push(`widget-${i}`, slide.data?.title || labelForWidget(slide.widgetType), slide, i);
        break;
      case 'end':
        push('end', 'End', slide, i);
        break;
      default:
        push(`other-${i}`, slide.type, slide, i);
    }
  });
  return groups;
}

function labelForWidget(type) {
  switch (type) {
    case 'scoreboard': return 'Scoreboard';
    case 'rules':      return 'Rules';
    case 'review':     return 'Answer Review';
    case 'custom':     return 'Custom';
    default:           return type || 'Widget';
  }
}

// Compact in-box preview of a slide for the grouped thumbnails.
function MiniSlide({ slide }) {
  if (!slide) return <span className="mini-slide mini-empty">—</span>;
  switch (slide.type) {
    case 'intro':
      return <span className="mini-slide"><span className="mini-icon">🎬</span><span className="mini-text">Title</span></span>;
    case 'round_intro':
      return <span className="mini-slide"><span className="mini-icon">🎯</span><span className="mini-text">{slide.title}</span></span>;
    case 'question':
      return <span className="mini-slide"><span className="mini-kicker">Q{slide.questionNumber}</span><span className="mini-text">{slide.text}</span></span>;
    case 'mark_answers':
      return <span className="mini-slide mini-mark"><span className="mini-icon">✦</span><span className="mini-text">Mark Answers</span></span>;
    case 'answer':
      // Deliberately NOT showing the answer text here — the All-Slides strip can
      // be visible to others, so reveals stay hidden until the slide is live.
      return <span className="mini-slide mini-answer"><span className="mini-kicker">A{slide.questionNumber}</span><span className="mini-text">Answer reveal</span></span>;
    case 'whoami_clue':
      return <span className="mini-slide"><span className="mini-icon">🕵</span><span className="mini-text">Clue {slide.clueIndex + 1}</span></span>;
    case 'widget':
      return <span className="mini-slide"><span className="mini-icon">{slide.widgetType === 'scoreboard' ? '🏆' : slide.widgetType === 'review' ? '📝' : slide.widgetType === 'rules' ? '📋' : '🧩'}</span><span className="mini-text">{slide.data?.title || slide.widgetType}</span></span>;
    case 'end':
      return <span className="mini-slide"><span className="mini-icon">🏁</span><span className="mini-text">End</span></span>;
    default:
      return <span className="mini-slide mini-text">{slide.type}</span>;
  }
}

// ── Reusable embedded preview panes (slideshow + quizzer, stacked) ────────────
// Used by the live-quiz preview toggle and the Test harness. The quizzer pane
// can mirror a chosen team (dropdown) or be interactive (you join yourself).
function PreviewPanes({ sessionId, quizCode, quizzerBase, slideshowBase, teams = [], surfaces = { slideshow: true, quizzer: true }, defaultMode = 'mirror' }) {
  const [mode, setMode] = useState(defaultMode);
  const [teamName, setTeamName] = useState(teams[0]?.name || '');

  useEffect(() => {
    if (teams.length && !teams.some(t => t.name === teamName)) setTeamName(teams[0].name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.map(t => t.name).join('|')]);

  const slideshowUrl = `${slideshowBase}/${quizCode}?session=${sessionId}`;
  const sel = teams.find(t => t.name === teamName) || teams[0];
  const quizzerUrl = (mode === 'mirror' && sel)
    ? `${quizzerBase}/${quizCode}?session=${sessionId}&team=${encodeURIComponent(sel.name)}&size=${sel.size || 5}&autojoin=1`
    : `${quizzerBase}/${quizCode}?session=${sessionId}`;

  return (
    <div className="preview-panes">
      {surfaces.slideshow && (
        <div className="preview-pane">
          <div className="preview-pane-head">
            <span>🖥 Slideshow</span>
            <a href={slideshowUrl} target="_blank" rel="noreferrer" className="preview-pop" title="Open in new tab">↗</a>
          </div>
          <iframe title="Slideshow preview" src={slideshowUrl} className="preview-iframe" />
        </div>
      )}
      {surfaces.quizzer && (
        <div className="preview-pane">
          <div className="preview-pane-head">
            <span>📱 Quizzer</span>
            <div className="preview-qmode">
              <button type="button" className={mode === 'mirror' ? 'on' : ''} onClick={() => setMode('mirror')}>Mirror</button>
              <button type="button" className={mode === 'interactive' ? 'on' : ''} onClick={() => setMode('interactive')}>Interactive</button>
            </div>
            {mode === 'mirror' && teams.length > 0 && (
              <select className="preview-team-sel" value={teamName} onChange={(e) => setTeamName(e.target.value)} title="View this team's screen">
                {teams.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            )}
            <a href={quizzerUrl} target="_blank" rel="noreferrer" className="preview-pop" title="Open in new tab">↗</a>
          </div>
          <iframe key={`${mode}:${teamName}`} title="Quizzer preview" src={quizzerUrl} className="preview-iframe preview-iframe-phone" />
        </div>
      )}
    </div>
  );
}

// ── Test harness: bots + embedded preview panes (test mode only) ───────────────
function TestHarness({ sessionId, quiz, slides, currentSlide, sessionStatus, socket, quizzerBase, slideshowBase, onTeamsChanged }) {
  const [settings]            = useState(getTestSettings);
  const [bots, setBots]       = useState([]);
  const createdRef       = useRef(false);
  const answeredRef      = useRef(new Set());   // `${botId}:${questionId}`
  const whoamiLockedRef  = useRef(new Set());   // botId

  const { qmap, whoami } = useMemo(() => buildTestMaps(quiz), [quiz]);

  // Create the bot teams once the session exists
  useEffect(() => {
    if (!sessionId || createdRef.current) return;
    createdRef.current = true;
    (async () => {
      const created = [];
      for (const b of settings.bots) {
        try {
          const team = await api.post('/teams/join', { sessionId, name: b.name, size: b.size });
          created.push({ ...team, cfg: b, plan: makeWhoamiPlan(b, whoami) });
        } catch { /* ignore */ }
      }
      setBots(created);
      if (onTeamsChanged) onTeamsChanged();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Bots answer as the host advances — questions per accuracy mix, Who-Am-I per plan
  useEffect(() => {
    if (!socket || bots.length === 0) return;
    const slide = slides[currentSlide];
    if (!slide) return;

    if (slide.type === 'question' && slide.questionId) {
      const q = qmap.get(slide.questionId);
      for (const bot of bots) {
        const key = `${bot.id}:${slide.questionId}`;
        if (answeredRef.current.has(key)) continue;
        answeredRef.current.add(key);
        const roll = Math.random();
        let answer = null;
        if (roll < bot.cfg.correct)                      answer = String(q?.answer ?? '');
        else if (roll < bot.cfg.correct + bot.cfg.wrong) answer = wrongAnswerText(q);
        // else: skip (leave unanswered → auto-zero on lock)
        if (answer != null && answer !== '') {
          socket.emit('submit_answer', {
            sessionId, teamId: bot.id, questionId: slide.questionId, roundId: slide.roundId, answer
          });
        }
      }
    }

    if (slide.type === 'whoami_clue' && whoami) {
      for (const bot of bots) {
        if (whoamiLockedRef.current.has(bot.id)) continue;
        const plan = bot.plan;
        if (!plan || plan.clue !== slide.clueIndex) continue;
        whoamiLockedRef.current.add(bot.id);
        const guess = plan.correct ? whoami.answer : '(wrong guess)';
        api.post('/whoami/lock', { sessionId, teamId: bot.id, clueIndex: slide.clueIndex, guess }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide, bots, socket]);

  return (
    <aside className="test-harness">
      <div className="test-harness-head">
        <h3>Live Preview</h3>
        <span className="test-bot-status">{bots.length} bot{bots.length !== 1 ? 's' : ''} · {sessionStatus}</span>
      </div>

      <PreviewPanes
        sessionId={sessionId}
        quizCode={quiz.code}
        quizzerBase={quizzerBase}
        slideshowBase={slideshowBase}
        teams={settings.bots.map(b => ({ name: b.name, size: b.size }))}
        surfaces={settings.surfaces}
        defaultMode={settings.quizzerMode}
      />

      <div className="test-bots-list">
        {bots.length === 0
          ? <span className="test-bot-chip test-bot-chip-pending">Spawning bots…</span>
          : bots.map(b => (
              <span key={b.id} className="test-bot-chip" title={`${Math.round(b.cfg.correct*100)}% correct / ${Math.round(b.cfg.wrong*100)}% wrong`}>
                {b.name} · {b.size}p
              </span>
            ))}
      </div>
    </aside>
  );
}

// Build a questionId → { answer, options } map + the Who-Am-I config from a quiz.
function buildTestMaps(quiz) {
  const qmap = new Map();
  let whoami = null;
  const items = quiz?.items || [
    ...((quiz?.rounds)  || []).map(r => ({ kind: 'round',  ...r })),
    ...((quiz?.widgets) || []).map(w => ({ kind: 'widget', ...w }))
  ];
  for (const it of items) {
    if (it.kind === 'round') {
      for (const q of (it.questions || [])) {
        if (q?.id) qmap.set(q.id, { answer: q.answer, options: q.options || [] });
      }
    } else if (it.kind === 'widget' && it.type === 'whoami') {
      let d = it.data || {};
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
      whoami = { answer: d.answer || '', clues: Array.isArray(d.clues) ? d.clues : [] };
    }
  }
  return { qmap, whoami };
}

function wrongAnswerText(q) {
  const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/^the\s+/, '');
  const opts = Array.isArray(q?.options) ? q.options.filter(o => String(o).trim()) : [];
  const wrong = opts.filter(o => norm(o) !== norm(q?.answer));
  if (wrong.length) return wrong[Math.floor(Math.random() * wrong.length)];
  return 'Definitely not the answer';
}

function makeWhoamiPlan(cfg, whoami) {
  if (!whoami || whoami.clues.length === 0) return null;
  const n = whoami.clues.length;
  const r = Math.random();
  if (r < cfg.correct)              return { clue: Math.floor(Math.random() * n), correct: true };
  if (r < cfg.correct + cfg.wrong)  return { clue: Math.floor(Math.random() * n), correct: false };
  return null; // this bot never locks in
}
