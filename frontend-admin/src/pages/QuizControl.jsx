import { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

export default function QuizControl({ sessionId }) {
  const [quizData, setQuizData] = useState(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slides, setSlides] = useState([]);
  const socket = useWebSocket();

  useEffect(() => {
    if (!sessionId || !socket) return;

    const handleSlideChange = (data) => {
      setCurrentSlide(data.slideIndex);
    };

    socket.on('slide_changed', handleSlideChange);
    return () => socket.off('slide_changed', handleSlideChange);
  }, [sessionId, socket]);

  const goToSlide = (index) => {
    if (slides[index]) {
      setCurrentSlide(index);
      if (socket) {
        socket.emit('slide_changed', {
          sessionId,
          slideIndex: index,
          slideData: slides[index]
        });
      }
    }
  };

  const nextSlide = () => goToSlide(currentSlide + 1);
  const prevSlide = () => goToSlide(currentSlide - 1);

  const lockAnswers = () => {
    if (socket) {
      socket.emit('answer_locked', { sessionId, roundId: currentSlide });
    }
  };

  const currentSlideData = slides[currentSlide];
  const nextSlideData = slides[currentSlide + 1];

  return (
    <div className="quiz-control">
      <h2>Quiz Control - Presenter View</h2>

      {!sessionId ? (
        <p>Start a quiz to control it</p>
      ) : (
        <div className="control-layout">
          <div className="slides-nav">
            <h3>Slides ({currentSlide + 1} / {slides.length})</h3>
            <div className="slide-navigation">
              <button onClick={prevSlide} disabled={currentSlide === 0} className="btn btn-primary">← Previous</button>
              <button onClick={nextSlide} disabled={currentSlide >= slides.length - 1} className="btn btn-primary">Next →</button>
              <button onClick={lockAnswers} className="btn btn-warning">Lock Answers</button>
            </div>
          </div>

          <div className="presenter-view">
            <div className="current-slide">
              <h3>Current Slide</h3>
              <div className="slide-preview">
                {currentSlideData ? (
                  <div>
                    <h4>{currentSlideData.title || 'Untitled Slide'}</h4>
                    <p>{currentSlideData.content || 'No content'}</p>
                  </div>
                ) : (
                  <p>No slides</p>
                )}
              </div>
            </div>

            <div className="next-slide">
              <h3>Next Slide</h3>
              <div className="slide-preview">
                {nextSlideData ? (
                  <div>
                    <h4>{nextSlideData.title || 'Untitled Slide'}</h4>
                    <p>{nextSlideData.content || 'No content'}</p>
                  </div>
                ) : (
                  <p>No more slides</p>
                )}
              </div>
            </div>
          </div>

          <div className="slide-thumbnails">
            <h3>Slide Overview</h3>
            <div className="thumbnails">
              {slides.map((slide, i) => (
                <button
                  key={i}
                  onClick={() => goToSlide(i)}
                  className={`thumbnail ${i === currentSlide ? 'active' : ''}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
