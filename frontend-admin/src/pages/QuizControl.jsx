import { useState, useEffect, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { buildSlides, slideShortLabel } from '../utils/buildSlides';
import { api } from '../services/api';

export default function QuizControl({ sessionId, quiz }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [sessionStatus, setSessionStatus] = useState('lobby'); // lobby | active | finished
  const [teamsCount, setTeamsCount] = useState(0);
  const socket = useWebSocket();
  const slides = useMemo(() => buildSlides(quiz), [quiz]);

  useEffect(() => {
    if (!sessionId) return;
    api.get(`/quizzes/sessions/${sessionId}`).then(s => {
      setSessionStatus(s.status);
      setCurrentSlide(s.current_slide_index || 0);
    }).catch(() => {});

    api.get(`/teams/session/${sessionId}`).then(t => setTeamsCount(t.length)).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !socket) return;
    socket.emit('join_quiz', { sessionId, role: 'admin' });

    const onSlide = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
    };
    const onTeamJoin = () => {
      api.get(`/teams/session/${sessionId}`).then(t => setTeamsCount(t.length)).catch(() => {});
    };
    const onStatus = (data) => {
      setSessionStatus(data.status);
      if (typeof data.currentSlideIndex === 'number') setCurrentSlide(data.currentSlideIndex);
    };
    socket.on('slide_changed', onSlide);
    socket.on('team_joined', onTeamJoin);
    socket.on('session_status_changed', onStatus);
    return () => {
      socket.off('slide_changed', onSlide);
      socket.off('team_joined', onTeamJoin);
      socket.off('session_status_changed', onStatus);
    };
  }, [sessionId, socket]);

  const goToSlide = (index) => {
    if (index < 0 || index >= slides.length) return;
    setCurrentSlide(index);
    if (socket) socket.emit('slide_changed', { sessionId, slideIndex: index });
  };

  const changeStatus = async (status) => {
    try {
      await api.put(`/quizzes/sessions/${sessionId}/status`, { status });
      setSessionStatus(status);
      if (socket) socket.emit('session_status_changed', { sessionId, status, currentSlideIndex: currentSlide });
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
      if (socket) socket.emit('session_status_changed', { sessionId, status: 'lobby', currentSlideIndex: 0 });
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const lockAnswers = () => {
    const slide = slides[currentSlide];
    if (socket && slide?.roundId) socket.emit('answer_locked', { sessionId, roundId: slide.roundId });
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
  const next = slides[currentSlide + 1];

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
          <button onClick={() => changeStatus('active')} className="btn btn-success btn-lg">
            ▶ Begin Quiz
          </button>
        )}
        {sessionStatus === 'active' && (
          <>
            <button onClick={() => changeStatus('lobby')} className="btn btn-warning">⏸ Back to Lobby</button>
            <button onClick={restart} className="btn btn-secondary">↺ Restart Session</button>
            <button onClick={() => changeStatus('finished')} className="btn btn-danger">⏹ End Quiz</button>
          </>
        )}
        {sessionStatus === 'finished' && (
          <>
            <button onClick={restart} className="btn btn-primary">↺ Restart from Beginning</button>
          </>
        )}
      </div>

      {sessionStatus === 'active' && (
        <>
          <div className="slide-navigation">
            <button onClick={() => goToSlide(currentSlide - 1)} disabled={currentSlide === 0} className="btn btn-primary">← Previous</button>
            <button onClick={() => goToSlide(currentSlide + 1)} disabled={currentSlide >= slides.length - 1} className="btn btn-primary">Next →</button>
            <button onClick={lockAnswers} disabled={!current?.roundId} className="btn btn-warning">🔒 Lock Round Answers</button>
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
          <p>The slideshow is showing the join screen. Teams can join at <code>/answer/{quiz.code}</code>.</p>
          <p>When ready, click <strong>Begin Quiz</strong> to start the presentation.</p>
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
