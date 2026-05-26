import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function QuizParticipant({ sessionData, teamId, socket }) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState({});
  const [locked, setLocked] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [scores, setScores] = useState({});

  useEffect(() => {
    if (!socket || !sessionData) return;

    const handleSlideChange = (data) => {
      setCurrentQuestion(data.slideIndex);
    };

    const handleAnswerLocked = () => {
      setLocked(true);
    };

    const handleAnswerMarked = (data) => {
      if (data.teamId === teamId) {
        setScores(prev => ({
          ...prev,
          [data.questionId]: data.points
        }));
      }
    };

    socket.on('slide_changed', handleSlideChange);
    socket.on('answer_locked', handleAnswerLocked);
    socket.on('answer_marked', handleAnswerMarked);

    return () => {
      socket.off('slide_changed');
      socket.off('answer_locked');
      socket.off('answer_marked');
    };
  }, [socket, sessionData, teamId]);

  const handleAnswerChange = async (questionId, answer) => {
    const newAnswers = {
      ...answers,
      [questionId]: answer
    };
    setAnswers(newAnswers);

    try {
      await api.post('/answers/submit', { teamId, questionId, roundId: 1, answer });
    } catch (error) {
      console.error('Error submitting answer:', error);
    }
  };

  const goToQuestion = (index) => {
    if (index >= 0 && index < questions.length && !locked) {
      setCurrentQuestion(index);
    }
  };

  const question = questions[currentQuestion];
  const score = scores[question?.id];

  return (
    <div className="quiz-participant">
      <div className="quiz-header">
        <h1>Quiz in Progress</h1>
        <div className="progress-bar">
          <div className="progress" style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }}></div>
        </div>
        <p>Question {currentQuestion + 1} of {questions.length}</p>
      </div>

      <div className="quiz-content">
        {question ? (
          <div className="question-card">
            <h2>{question.text}</h2>

            {question.media_url && (
              <div className="media-container">
                {question.type === 'image' && <img src={question.media_url} alt="Question media" />}
                {question.type === 'video' && <video controls src={question.media_url}></video>}
                {question.type === 'audio' && <audio controls src={question.media_url}></audio>}
              </div>
            )}

            {question.type === 'mcq' && (
              <div className="options">
                {['A', 'B', 'C', 'D'].map(option => (
                  <label key={option} className="option-label">
                    <input
                      type="radio"
                      name={`question-${question.id}`}
                      value={option}
                      checked={answers[question.id] === option}
                      onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                      disabled={locked}
                    />
                    <span>{option}. Option</span>
                  </label>
                ))}
              </div>
            )}

            {question.type === 'text' && (
              <input
                type="text"
                placeholder="Type your answer..."
                value={answers[question.id] || ''}
                onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                disabled={locked}
                className="answer-input"
              />
            )}

            {locked && score !== undefined && (
              <div className={`score-badge score-${score === 1 ? 'full' : score === 0.5 ? 'half' : 'zero'}`}>
                <p>Points: {score}</p>
              </div>
            )}

            {locked && score === undefined && (
              <div className="score-badge score-pending">
                <p>Awaiting marking...</p>
              </div>
            )}
          </div>
        ) : (
          <p>Loading question...</p>
        )}
      </div>

      <div className="quiz-navigation">
        <button
          onClick={() => goToQuestion(currentQuestion - 1)}
          disabled={currentQuestion === 0 || locked}
          className="nav-btn"
        >
          ← Previous
        </button>

        <div className="question-list">
          {questions.map((q, i) => (
            <button
              key={i}
              onClick={() => goToQuestion(i)}
              className={`question-btn ${i === currentQuestion ? 'active' : ''} ${scores[q.id] !== undefined ? 'answered' : ''}`}
              disabled={locked}
              title={`Question ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <button
          onClick={() => goToQuestion(currentQuestion + 1)}
          disabled={currentQuestion === questions.length - 1 || locked}
          className="nav-btn"
        >
          Next →
        </button>
      </div>

      {locked && (
        <div className="locked-overlay">
          <div className="locked-message">
            <p>This round has been locked. Waiting for final results...</p>
          </div>
        </div>
      )}
    </div>
  );
}
