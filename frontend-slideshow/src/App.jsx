import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';

function App() {
  const [quizCode, setQuizCode] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideData, setSlideData] = useState(null);
  const [joined, setJoined] = useState(false);
  const socket = useWebSocket();

  useEffect(() => {
    const code = window.location.pathname.split('/')[2];
    if (code) {
      setQuizCode(code);
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('slide_changed', (data) => {
      setCurrentSlide(data.slideIndex);
      setSlideData(data.slideData);
    });

    socket.on('quiz_started', (data) => {
      setSessionId(data.sessionId);
      setCurrentSlide(0);
      setJoined(true);
    });

    return () => {
      socket.off('slide_changed');
      socket.off('quiz_started');
    };
  }, [socket]);

  const renderSlide = () => {
    if (!slideData) {
      return <div className="slide-empty">Waiting for quiz to start...</div>;
    }

    const { type, content } = slideData;

    switch (type) {
      case 'question':
        return (
          <div className="slide-question">
            <h2>{content.text}</h2>
            {content.media && <div className="slide-media">{content.media}</div>}
            {content.options && (
              <div className="slide-options">
                {content.options.map((opt, i) => (
                  <div key={i} className="option">{String.fromCharCode(65 + i)}. {opt}</div>
                ))}
              </div>
            )}
          </div>
        );
      case 'answer':
        return (
          <div className="slide-answer">
            <h3>Correct Answer</h3>
            <p>{content.answer}</p>
          </div>
        );
      case 'widget':
        return (
          <div className="slide-widget">
            <h2>{content.title}</h2>
            {content.widgetType === 'scoreboard' && <div className="scoreboard">Scoreboard Widget</div>}
            {content.widgetType === 'rules' && <div className="rules">{content.body}</div>}
            {content.widgetType === 'custom' && <div className="custom">{content.body}</div>}
          </div>
        );
      default:
        return <div className="slide-empty">Slide {currentSlide}</div>;
    }
  };

  return (
    <div className="slideshow-container">
      <div className="slide">
        {renderSlide()}
      </div>
      <div className="slide-counter">
        Slide {currentSlide + 1}
      </div>
    </div>
  );
}

export default App;
