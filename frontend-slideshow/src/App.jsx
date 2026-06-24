import { useState, useEffect, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './services/api';
import { buildSlides } from './utils/buildSlides';
import LiveScoreboard from './components/LiveScoreboard';

function getInitialCode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) return params.get('code').toUpperCase();
  const segments = window.location.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && last.length >= 4 && last.length <= 8 && /^[A-Z0-9]+$/i.test(last)) {
    return last.toUpperCase();
  }
  return null;
}

// Test iframe targets a specific session via ?session=<id>, bypassing the
// quiz's active-session lookup (test sessions are excluded from that).
function getForcedSessionId() {
  const sid = new URLSearchParams(window.location.search).get('session');
  return sid ? parseInt(sid) : null;
}

// Size the join QR relative to the surface so it isn't oversized in a small
// embedded preview while staying crisp on a full-screen display.
function qrSizeFor() {
  const m = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(54, Math.min(132, Math.round(m * 0.13)));
}

function App() {
  const [code, setCode] = useState(getInitialCode());
  const [quiz, setQuiz] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('lobby');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [teamsCount, setTeamsCount] = useState(0);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | waiting | ready
  const [sessionCode, setSessionCode] = useState(null); // per-session join code to display
  const [portalConfig, setPortalConfig] = useState(null);
  // Whether the scoreboard SLIDE reveals scores on this surface. Default true —
  // the host can toggle it off (from Control) to keep scores hidden for suspense
  // while sitting on a scoreboard slide. (No longer a full-screen overlay.)
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [qrSize, setQrSize] = useState(qrSizeFor);
  // Manual media playback: the host sends media_play (slideIndex + nonce). Media
  // never autoplays — it only plays when this matches the current slide.
  const [playToken, setPlayToken] = useState(null);
  const socket = useWebSocket();
  const slides = useMemo(() => buildSlides(quiz), [quiz]);

  // Keep the QR sized to the current surface (window or preview iframe)
  useEffect(() => {
    const onResize = () => setQrSize(qrSizeFor());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load portal URL config once so the lobby screen shows the correct quizzer URL
  useEffect(() => {
    api.get('/config').then(c => setPortalConfig(c)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      const forcedSessionId = getForcedSessionId();
      try {
        if (forcedSessionId) {
          // Test iframe → specific session by id
          const [quizData, session] = await Promise.all([
            api.get(`/quizzes/by-code/${code}`),
            api.get(`/quizzes/sessions/${forcedSessionId}`)
          ]);
          if (cancelled) return;
          setQuiz(quizData);
          setSessionId(session.id);
          setSessionStatus(session.status || 'lobby');
          setCurrentSlide(session.current_slide_index || 0);
          setSessionCode(session.code || null);
          setStatus('ready');
          return;
        }

        // Resolve the code → quiz (+ live session if any). Works for a session
        // code (exact) or the quiz code (→ its current live session).
        const resolved = await api.get(`/quizzes/resolve/${code}`);
        if (cancelled) return;
        if (!resolved.quiz) throw new Error('not found');
        setQuiz(resolved.quiz);
        if (resolved.session) {
          setSessionId(resolved.session.id);
          setSessionStatus(resolved.session.status || 'lobby');
          setCurrentSlide(resolved.session.current_slide_index || 0);
          setSessionCode(resolved.session.code || null);
          setStatus('ready');
        } else {
          setSessionCode(null);
          setStatus('waiting');
        }
      } catch (err) {
        if (cancelled) return;
        setError(`Code "${code}" not found.`);
        setStatus('idle');
        setCode(null);
      }
    })();

    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (status !== 'waiting' || !quiz) return;
    const interval = setInterval(async () => {
      try {
        const session = await api.get(`/quizzes/${quiz.id}/active-session`);
        setSessionId(session.id);
        setSessionStatus(session.status || 'lobby');
        setCurrentSlide(session.current_slide_index || 0);
        setSessionCode(session.code || null);
        setStatus('ready');
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [status, quiz]);

  useEffect(() => {
    if (!socket || !sessionId) return;

    // Unified join/rejoin — called on every (re)connect
    const rejoin = () => socket.emit('join_quiz', { sessionId, role: 'slideshow' });

    // session_state: full authoritative state sent by server on every join_quiz
    const onSessionState = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
      if (data.status) setSessionStatus(data.status);
      if (data.scoreboardVisibility) setScoreboardVisible(!!data.scoreboardVisibility.slideshow);
    };
    const onSlide = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
    };
    const onStatus = (data) => {
      setSessionStatus(data.status);
      if (typeof data.currentSlideIndex === 'number') setCurrentSlide(data.currentSlideIndex);
    };
    const onTeamJoin = () => {
      api.get(`/teams/session/${sessionId}`).then(t => setTeamsCount(t.length)).catch(() => {});
    };
    const onScoreboardVis = (data) => {
      if (data?.visibility) setScoreboardVisible(!!data.visibility.slideshow);
    };
    const onMediaPlay = (data) => {
      if (typeof data?.slideIndex === 'number') setPlayToken({ slideIndex: data.slideIndex, nonce: data.nonce });
    };

    socket.on('connect',                rejoin);
    socket.on('session_state',          onSessionState);
    socket.on('slide_changed',          onSlide);
    socket.on('session_status_changed', onStatus);
    socket.on('team_joined',            onTeamJoin);
    socket.on('scoreboard_visibility_changed', onScoreboardVis);
    socket.on('media_play',             onMediaPlay);

    // If socket is already connected when the effect runs, join immediately
    if (socket.connected) rejoin();

    // Initial team count
    api.get(`/teams/session/${sessionId}`).then(t => setTeamsCount(t.length)).catch(() => {});

    return () => {
      socket.off('connect',                rejoin);
      socket.off('session_state',          onSessionState);
      socket.off('slide_changed',          onSlide);
      socket.off('session_status_changed', onStatus);
      socket.off('team_joined',            onTeamJoin);
      socket.off('scoreboard_visibility_changed', onScoreboardVis);
      socket.off('media_play',             onMediaPlay);
    };
  }, [socket, sessionId]);

  const renderView = () => {
    if (!code) {
      return <CodeEntry onSubmit={setCode} initialError={error} />;
    }

    if (status === 'loading') {
      return <FullScreenMessage title="Loading quiz..." />;
    }

    if (status === 'waiting') {
      return (
        <FullScreenMessage
          title={quiz?.name}
          subtitle={`Code: ${quiz?.code}`}
          message="Waiting for the quiz master to start the session..."
        />
      );
    }

    // LOBBY screen - shown before quiz begins
    if (sessionStatus === 'lobby') {
      const quizzerBase = (
        portalConfig?.quizzerUrl ||
        `${window.location.protocol}//${window.location.host.replace(/:3002$/, ':3003')}`
      ).replace(/\/+$/, '');
      // Full deep link with the per-session join code baked into the path
      const displayCode = sessionCode || quiz?.code;
      const joinUrl = displayCode ? `${quizzerBase}/${displayCode}` : quizzerBase;
      return (
        <div className="slideshow-container">
          <div className="slide lobby-slide">
            <div className="lobby-content">
              <p className="lobby-label">Tonight's Quiz</p>
              <h1 className="lobby-title">{quiz?.name}</h1>
              <div className="lobby-code-box">
                <p className="lobby-code-label">Join Code</p>
                <p className="lobby-code">{displayCode}</p>
              </div>
              <p className="lobby-instructions">
                Teams join at <span className="lobby-url">{joinUrl}</span>
              </p>
              <div className="lobby-counter">
                <span className="counter-number">{teamsCount}</span>
                <span className="counter-label">team{teamsCount !== 1 ? 's' : ''} joined</span>
              </div>
              <p className="lobby-waiting">Waiting for quiz master to begin...</p>
            </div>
          </div>
        </div>
      );
    }

    if (sessionStatus === 'finished') {
      return (
        <FullScreenMessage
          title="Quiz Complete!"
          subtitle={quiz?.name}
          message={`${teamsCount} team${teamsCount !== 1 ? 's' : ''} participated. Thanks for playing!`}
        />
      );
    }

    const slide = slides[currentSlide];
    return (
      <div className="slideshow-container">
        <div className="slide" style={slide?.background ? { background: slide.background } : undefined}>
          <SlideRenderer slide={slide} slideIndex={currentSlide} playToken={playToken} sessionId={sessionId} socket={socket} scoresVisible={scoreboardVisible} />
        </div>
        <div className="slide-counter">
          {currentSlide + 1} / {slides.length}
        </div>
      </div>
    );
  };

  // Quizzer join deep link for the on-screen QR code (code baked into the path)
  const quizzerBase = (
    portalConfig?.quizzerUrl ||
    `${window.location.protocol}//${window.location.host.replace(/:3002$/, ':3003')}`
  ).replace(/\/+$/, '');
  const qrCode = sessionCode || quiz?.code;
  const quizzerJoinUrl = qrCode ? `${quizzerBase}/${qrCode}` : null;
  // Show the join QR only in the lobby and on the first (intro) slide — not
  // throughout the whole show.
  const showJoinQr = quizzerJoinUrl && (
    sessionStatus === 'lobby' || (sessionStatus === 'active' && currentSlide === 0)
  );

  return (
    <>
      {renderView()}
      {showJoinQr && (
        <div className="join-qr">
          <div className="join-qr-code">
            <QRCodeSVG value={quizzerJoinUrl} size={qrSize} bgColor="#ffffff" fgColor="#07091a" level="M" />
          </div>
          <p className="join-qr-label">Scan to join</p>
        </div>
      )}
    </>
  );
}

function CodeEntry({ onSubmit, initialError }) {
  const [input, setInput] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (input.trim()) onSubmit(input.trim().toUpperCase());
  };
  return (
    <div className="code-entry">
      <div className="code-entry-card">
        <h1>🎯 Quiz Master</h1>
        <p>Slideshow Viewer</p>
        {initialError && <div className="code-entry-error">{initialError}</div>}
        <form onSubmit={submit}>
          <input
            type="text"
            placeholder="ABC123"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            maxLength={8}
            autoFocus
          />
          <button type="submit">Load Quiz</button>
        </form>
      </div>
    </div>
  );
}

function FullScreenMessage({ title, subtitle, message }) {
  return (
    <div className="slideshow-container">
      <div className="slide">
        <div className="slide-empty">
          {title && <h2>{title}</h2>}
          {subtitle && <h3>{subtitle}</h3>}
          {message && <p>{message}</p>}
        </div>
      </div>
    </div>
  );
}

// Question audio/video on the big screen. No native controls and never
// autoplays — it only plays when the host's media_play (nonce) targets this
// slide. Keyed by slide index at the call site, so leaving the slide unmounts
// this and stops playback. Honours the finish_the_lyrics stop time.
function QuestionMedia({ slide, slideIndex, playToken }) {
  const ref = useRef(null);
  const [state, setState] = useState('idle'); // idle | playing | ended

  useEffect(() => {
    if (!playToken || playToken.slideIndex !== slideIndex) return;
    const el = ref.current;
    if (!el) return;
    try { el.currentTime = 0; } catch { /* not seekable yet */ }
    el.play().then(() => setState('playing')).catch(() => {});
  }, [playToken, slideIndex]);

  const onTimeUpdate = (e) => {
    if (slide.audioForm === 'finish_the_lyrics' && slide.audioStop && e.target.currentTime >= slide.audioStop) {
      e.target.pause();
    }
  };
  const common = {
    ref,
    src: slide.mediaUrl,
    onTimeUpdate,
    onEnded: () => setState('ended'),
    onPause: () => setState(s => (s === 'playing' ? 'idle' : s)),
    onPlaying: () => setState('playing'),
  };

  if (slide.questionType === 'video') {
    return <video {...common} className="slide-video" playsInline />;
  }
  // Audio: no visible player — a non-interactive status badge tells the room.
  return (
    <div className={`slide-audio-badge ${state}`}>
      <span className="slide-audio-icon">{state === 'playing' ? '🔊' : '🎵'}</span>
      <span className="slide-audio-text">
        {state === 'playing' ? 'Now playing…' : state === 'ended' ? 'Track finished' : 'Audio ready'}
      </span>
      <audio {...common} hidden />
    </div>
  );
}

function SlideRenderer({ slide, slideIndex, playToken, sessionId, socket, scoresVisible = true }) {
  if (!slide) return <div className="slide-empty"><h2>End of quiz</h2></div>;

  switch (slide.type) {
    case 'intro':
      return (
        <div className="slide-intro">
          <h1>{slide.title}</h1>
          <h3>{slide.subtitle}</h3>
        </div>
      );

    case 'round_intro':
      return (
        <div className="slide-round-intro">
          <p className="round-label">Next Round</p>
          <h1>{slide.title}</h1>
        </div>
      );

    case 'intermission':
      return (
        <div className="slide-intermission">
          <h1 className="intermission-title">{slide.title}</h1>
          <div
            className="intermission-grid"
            style={{ gridTemplateColumns: `repeat(${slide.gridColumns || 5}, 1fr)` }}
          >
            {(slide.questions || []).map((q, i) => (
              <div key={q.id ?? i} className="intermission-cell">
                <span className="intermission-num">{i + 1}</span>
                {q.media_url && q.type === 'image' && <img src={q.media_url} alt={`Picture ${i + 1}`} />}
                {q.media_url && q.type === 'video' && <video src={q.media_url} />}
                {!q.media_url && <div className="intermission-noimg">{q.text || `#${i + 1}`}</div>}
              </div>
            ))}
          </div>
        </div>
      );

    case 'question':
      return (
        <div className="slide-question">
          <div className="question-header">
            <span>{slide.roundName}</span>
            <span>Question {slide.questionNumber} / {slide.totalInRound}</span>
            <span>{slide.points} pt</span>
          </div>
          <h2>{slide.text}</h2>
          {slide.mediaUrl && (
            <div className="slide-media">
              {slide.questionType === 'image' && <img src={slide.mediaUrl} alt="Question media" />}
              {(slide.questionType === 'video' || slide.questionType === 'audio') && (
                <QuestionMedia key={slideIndex} slide={slide} slideIndex={slideIndex} playToken={playToken} />
              )}
            </div>
          )}
          {slide.questionType === 'mcq' && slide.options && slide.options.length > 0 && (
            <div className="slide-options">
              {slide.options.map((opt, i) => (
                <div key={i} className="option">
                  <span className="option-letter">{String.fromCharCode(65 + i)}</span>
                  <span className="option-text">{opt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'whoami_clue':
      return (
        <div className="slide-whoami">
          <p className="whoami-label">{slide.title}</p>
          <div className="whoami-points-badge">
            Lock in now for {slide.points} point{slide.points !== 1 ? 's' : ''}
          </div>
          <h2 className="whoami-current-clue">{slide.text}</h2>
          {slide.revealed && slide.revealed.length > 1 && (
            <div className="whoami-revealed">
              <p className="whoami-revealed-label">Clues so far</p>
              <ol>
                {slide.revealed.map((c, i) => (
                  <li key={i} className={i === slide.clueIndex ? 'current' : ''}>
                    <span className="whoami-clue-pts">{c.points}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="whoami-hint">
            Clue {slide.clueIndex + 1} of {slide.totalClues} · the longer you wait, the fewer points
          </p>
        </div>
      );

    case 'mark_answers':
      return (
        <div className="slide-mark-answers">
          <p className="mark-label">{slide.roundName}</p>
          <h1>Mark Your Answers</h1>
          <p className="mark-subtitle">
            Final chance to submit — {slide.totalInRound} question{slide.totalInRound !== 1 ? 's' : ''} in this round.
          </p>
          <p className="mark-hint">Answers will be revealed shortly.</p>
        </div>
      );

    case 'answer': {
      // Name the Song reveals the linked track's Artist — Song; everything else
      // shows the stored answer.
      const revealText = slide.audioForm === 'name_the_song'
        ? [slide.mediaArtist, slide.mediaTitle].filter(Boolean).join(' — ') || slide.answer
        : slide.answer;
      return (
        <div className="slide-answer">
          <p className="answer-label">{slide.roundName} · {slide.intermission ? `Picture ${slide.questionNumber}` : `Q${slide.questionNumber}`}</p>
          {slide.intermission && slide.mediaUrl && (
            <div className="answer-media">
              {slide.questionType === 'image' && <img src={slide.mediaUrl} alt="Answer" />}
              {slide.questionType === 'video' && <video controls src={slide.mediaUrl} />}
            </div>
          )}
          {slide.text && <h3 className="answer-question">{slide.text}</h3>}
          <p className="answer-text">{revealText}</p>
        </div>
      );
    }

    case 'widget':
      return <WidgetSlide slide={slide} sessionId={sessionId} socket={socket} scoresVisible={scoresVisible} />;

    case 'end':
      return (
        <div className="slide-intro">
          <h1>{slide.title}</h1>
          <h3>{slide.subtitle}</h3>
          {slide.whoami && slide.whoami.answer && (
            <div className="whoami-reveal">
              <p className="whoami-reveal-label">{slide.whoami.title} — the answer was</p>
              <p className="whoami-reveal-answer">{slide.whoami.answer}</p>
            </div>
          )}
        </div>
      );

    default:
      return <div className="slide-empty"><p>Unknown slide type: {slide.type}</p></div>;
  }
}

function WidgetSlide({ slide, sessionId, socket, scoresVisible = true }) {
  // The Answer Review page is per-device (teams review on their phones), so the
  // big screen shows the scoreboard (scores) for it, same as a scoreboard slide.
  if (slide.widgetType === 'scoreboard' || slide.widgetType === 'review') {
    return <ScoreboardWidget slide={slide} sessionId={sessionId} socket={socket} scoresVisible={scoresVisible} />;
  }

  const data = slide.data || {};
  const style = {
    background: data.bg_image ? `url(${data.bg_image}) center/cover` : (data.bg_color || undefined)
  };
  return (
    <div className="slide-widget" style={style}>
      {data.title && <h2>{data.title}</h2>}
      {data.image_url && (
        <div className="widget-image">
          <img src={data.image_url} alt="" />
        </div>
      )}
      {data.body && <p className="widget-body" style={{ whiteSpace: 'pre-line' }}>{data.body}</p>}
    </div>
  );
}

// Scoreboard widget slide — renders the full per-round breakdown table, kept
// live via LiveScoreboard's own socket subscriptions.
function ScoreboardWidget({ slide, sessionId, socket, scoresVisible = true }) {
  const data = slide.data || {};
  const style = {
    background: data.bg_image ? `url(${data.bg_image}) center/cover` : (data.bg_color || undefined)
  };
  return (
    <div className="slide-widget slide-scoreboard" style={style}>
      {scoresVisible ? (
        <LiveScoreboard sessionId={sessionId} socket={socket} title={data.title || 'Leaderboard'} />
      ) : (
        <div className="sb-hidden">
          <h2 className="sb-title">{data.title || 'Leaderboard'}</h2>
          <p className="sb-msg">Scores hidden — revealing shortly…</p>
        </div>
      )}
    </div>
  );
}

export default App;
