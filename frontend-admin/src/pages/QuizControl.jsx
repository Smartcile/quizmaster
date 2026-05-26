import { useState, useEffect, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { buildSlides, slideShortLabel } from '../utils/buildSlides';

export default function QuizControl({ sessionId, quiz }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const socket = useWebSocket();
  const slides = useMemo(() => buildSlides(quiz), [quiz]);

  useEffect(() => {
    if (!sessionId || !socket) return;
    socket.emit('join_quiz', { sessionId, role: 'admin' });

    const handler = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
    };
    socket.on('slide_changed', handler);
    return () => socket.off('slide_changed', handler);
  }, [sessionId, socket]);

  const goToSlide = (index) => {
    if (index < 0 || index >= slides.length) return;
    setCurrentSlide(index);
    if (socket) socket.emit('slide_changed', { sessionId, slideIndex: index });
  };

  const nextSlide = () => goToSlide(currentSlide + 1);
  const prevSlide = () => goToSlide(currentSlide - 1);

  const lockAnswers = () => {
    const slide = slides[currentSlide];
    const roundId = slide?.roundId;
    if (socket && roundId) socket.emit('answer_locked', { sessionId, roundId });
  };

  if (!sessionId || !quiz) {
    return (
      <div className="quiz-control">
        <h2>Quiz Control - Presenter View</h2>
        <p>Go to the Dashboard and click "Start Quiz" to begin.</p>
      </div>
    );
  }

  const current = slides[currentSlide];
  const next = slides[currentSlide + 1];

  return (
    <div className="quiz-control">
      <h2>Quiz Control — {quiz.name}</h2>
      <p className="control-meta">
        Code: <strong>{quiz.code}</strong> · Session: {sessionId} ·
        Slide {currentSlide + 1} / {slides.length}
      </p>

      <div className="slide-navigation">
        <button onClick={prevSlide} disabled={currentSlide === 0} className="btn btn-primary">← Previous</button>
        <button onClick={nextSlide} disabled={currentSlide >= slides.length - 1} className="btn btn-primary">Next →</button>
        <button onClick={lockAnswers} disabled={!current?.roundId} className="btn btn-warning">Lock Round Answers</button>
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
    </div>
  );
}

function SlidePreview({ slide }) {
  if (!slide) return <p>No slide</p>;
  switch (slide.type) {
    case 'intro':
      return <div><h4>{slide.title}</h4><p>{slide.subtitle}</p></div>;
    case 'round_intro':
      return <div><h4 style={{ color: '#9b59b6' }}>Round Start</h4><p style={{ fontSize: '1.3rem' }}>{slide.title}</p></div>;
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
