import { useState, useEffect, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './services/api';
import { buildSlides } from './utils/buildSlides';

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

function App() {
  const [code, setCode] = useState(getInitialCode());
  const [quiz, setQuiz] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('lobby');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [teamsCount, setTeamsCount] = useState(0);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | waiting | ready
  const socket = useWebSocket();
  const slides = useMemo(() => buildSlides(quiz), [quiz]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      try {
        const quizData = await api.get(`/quizzes/by-code/${code}`);
        if (cancelled) return;
        setQuiz(quizData);

        try {
          const session = await api.get(`/quizzes/${quizData.id}/active-session`);
          if (cancelled) return;
          setSessionId(session.id);
          setSessionStatus(session.status || 'lobby');
          setCurrentSlide(session.current_slide_index || 0);
          setStatus('ready');
        } catch {
          if (cancelled) return;
          setStatus('waiting');
        }
      } catch (err) {
        if (cancelled) return;
        setError(`Quiz code "${code}" not found.`);
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
        setStatus('ready');
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [status, quiz]);

  useEffect(() => {
    if (!socket || !sessionId) return;
    socket.emit('join_quiz', { sessionId, role: 'slideshow' });

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
    socket.on('slide_changed', onSlide);
    socket.on('session_status_changed', onStatus);
    socket.on('team_joined', onTeamJoin);

    // Initial team count
    api.get(`/teams/session/${sessionId}`).then(t => setTeamsCount(t.length)).catch(() => {});

    return () => {
      socket.off('slide_changed', onSlide);
      socket.off('session_status_changed', onStatus);
      socket.off('team_joined', onTeamJoin);
    };
  }, [socket, sessionId]);

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
    const joinUrl = `${window.location.protocol}//${window.location.host.replace(/:3002$/, ':3003')}`;
    return (
      <div className="slideshow-container">
        <div className="slide lobby-slide">
          <div className="lobby-content">
            <p className="lobby-label">Tonight's Quiz</p>
            <h1 className="lobby-title">{quiz?.name}</h1>
            <div className="lobby-code-box">
              <p className="lobby-code-label">Join Code</p>
              <p className="lobby-code">{quiz?.code}</p>
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
        <SlideRenderer slide={slide} />
      </div>
      <div className="slide-counter">
        {currentSlide + 1} / {slides.length}
      </div>
    </div>
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

function SlideRenderer({ slide }) {
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
              {slide.questionType === 'video' && <video controls src={slide.mediaUrl} />}
              {slide.questionType === 'audio' && <audio controls src={slide.mediaUrl} />}
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

    case 'answer':
      return (
        <div className="slide-answer">
          <p className="answer-label">{slide.roundName} · Q{slide.questionNumber}</p>
          <h3 className="answer-question">{slide.text}</h3>
          <p className="answer-text">{slide.answer}</p>
        </div>
      );

    case 'widget':
      return (
        <div className="slide-widget">
          <h2>{(slide.widgetType || '').toUpperCase()}</h2>
          {slide.widgetType === 'scoreboard' && <p>Scoreboard will appear here</p>}
          {slide.widgetType === 'rules' && <p>{slide.data?.body || 'Rules go here'}</p>}
          {slide.widgetType === 'custom' && <p>{slide.data?.body || ''}</p>}
        </div>
      );

    case 'end':
      return (
        <div className="slide-intro">
          <h1>{slide.title}</h1>
          <h3>{slide.subtitle}</h3>
        </div>
      );

    default:
      return <div className="slide-empty"><p>Unknown slide type: {slide.type}</p></div>;
  }
}

export default App;
