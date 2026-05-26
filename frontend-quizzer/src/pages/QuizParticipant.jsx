import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { buildSlides } from '../utils/buildSlides';

export default function QuizParticipant({ quiz, sessionId, team, currentSlide, socket }) {
  const [answers, setAnswers] = useState({});      // questionId -> text
  const [lockedRounds, setLockedRounds] = useState(new Set());
  const [scores, setScores] = useState({});        // questionId -> points

  const slides = useMemo(() => buildSlides(quiz), [quiz]);
  const slide = slides[currentSlide];

  // List of question slides in this quiz (for "previous answers in round")
  const questionsInCurrentRound = useMemo(() => {
    if (!slide?.roundId) return [];
    return slides.filter(s => s.type === 'question' && s.roundId === slide.roundId);
  }, [slides, slide]);

  // Load existing team answers + scores when joining mid-quiz
  useEffect(() => {
    if (!team?.id) return;
    (async () => {
      try {
        const scoresRes = await api.get(`/teams/${team.id}/scores`);
        if (scoresRes?.scores) {
          const next = {};
          scoresRes.scores.forEach(s => {
            if (s.question_id != null) next[s.question_id] = parseFloat(s.points);
          });
          setScores(next);
        }
      } catch {}
    })();
  }, [team?.id]);

  // WebSocket events
  useEffect(() => {
    if (!socket) return;
    const onLocked = (data) => {
      setLockedRounds(prev => new Set([...prev, data.roundId]));
    };
    const onMarked = (data) => {
      if (data.teamId === team?.id) {
        setScores(prev => ({ ...prev, [data.questionId]: parseFloat(data.points) }));
      }
    };
    socket.on('answer_locked', onLocked);
    socket.on('answer_marked', onMarked);
    return () => {
      socket.off('answer_locked', onLocked);
      socket.off('answer_marked', onMarked);
    };
  }, [socket, team?.id]);

  const submitAnswer = async (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    if (!socket || !team) return;
    socket.emit('submit_answer', {
      sessionId,
      teamId: team.id,
      questionId,
      roundId: slide?.roundId,
      answer: value
    });
  };

  // Find a question by id from any round
  const getQuestionById = (qid) => {
    for (const s of slides) if (s.type === 'question' && s.questionId === qid) return s;
    return null;
  };

  const isLockedFor = (roundId) => lockedRounds.has(roundId);

  // Render based on slide type
  const renderSlide = () => {
    if (!slide) return <WaitingMessage text="Loading..." />;

    if (slide.type === 'intro' || slide.type === 'round_intro') {
      return <WaitingMessage text={slide.type === 'intro' ? `Welcome to ${slide.title}` : `Next round: ${slide.title}`} subtext="The quiz master will reveal the question shortly." />;
    }

    if (slide.type === 'question') {
      return <QuestionView slide={slide} answer={answers[slide.questionId] || ''} score={scores[slide.questionId]} locked={isLockedFor(slide.roundId)} onChange={(v) => submitAnswer(slide.questionId, v)} />;
    }

    if (slide.type === 'answer') {
      const q = getQuestionById(slide.questionId);
      const myScore = scores[slide.questionId];
      return (
        <div className="reveal-card">
          <p className="reveal-label">{slide.roundName} · Question {slide.questionNumber}</p>
          <h2 className="reveal-question">{slide.text}</h2>
          {q && answers[slide.questionId] && (
            <div className="reveal-your-answer">
              <span className="reveal-your-label">Your answer:</span>
              <span className="reveal-your-text">{answers[slide.questionId]}</span>
            </div>
          )}
          <div className="reveal-correct">
            <span className="reveal-correct-label">Correct:</span>
            <span className="reveal-correct-text">{slide.answer}</span>
          </div>
          {myScore !== undefined && (
            <div className={`reveal-score ${myScore === 1 ? 'full' : myScore === 0.5 ? 'half' : 'zero'}`}>
              {myScore} pt{myScore !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      );
    }

    if (slide.type === 'widget') {
      return <WaitingMessage text={`Coming up: ${slide.widgetType}`} />;
    }

    if (slide.type === 'end') {
      return <WaitingMessage text="Quiz Complete!" subtext="Thanks for playing." />;
    }

    return <WaitingMessage text="..." />;
  };

  return (
    <div className="quiz-participant">
      <div className="quiz-header">
        <h1>{quiz?.name}</h1>
        <p>Team <strong>{team?.name}</strong></p>
      </div>

      <div className="quiz-content">
        {renderSlide()}
      </div>

      {/* Allow flipping back through this round's questions when the round isn't yet locked */}
      {slide?.type === 'question' && questionsInCurrentRound.length > 1 && !isLockedFor(slide.roundId) && (
        <div className="round-nav">
          <p className="round-nav-label">Round questions:</p>
          <div className="round-nav-buttons">
            {questionsInCurrentRound.map((q) => {
              const isCurrent = q.questionId === slide.questionId;
              const isAnswered = !!answers[q.questionId];
              return (
                <div
                  key={q.questionId}
                  className={`round-nav-btn ${isCurrent ? 'current' : ''} ${isAnswered ? 'answered' : ''}`}
                  title={q.text}
                >
                  Q{q.questionNumber}
                </div>
              );
            })}
          </div>
          <p className="round-nav-hint">The quiz master controls which question is shown. You can answer as they progress.</p>
        </div>
      )}
    </div>
  );
}

function QuestionView({ slide, answer, score, locked, onChange }) {
  const mode = slide.answerMode || 'text';
  const showText = mode === 'text' || mode === 'both';
  const showMcq = (mode === 'mcq' || mode === 'both') && Array.isArray(slide.options) && slide.options.length > 0;

  return (
    <div className="question-card">
      <div className="question-meta">
        <span className="question-round">{slide.roundName}</span>
        <span className="question-num">Q{slide.questionNumber}/{slide.totalInRound}</span>
        <span className="question-points">{slide.points} pt</span>
      </div>

      <h2>{slide.text}</h2>

      {slide.mediaUrl && (
        <div className="media-container">
          {slide.questionType === 'image' && <img src={slide.mediaUrl} alt="Question" />}
          {slide.questionType === 'video' && <video controls src={slide.mediaUrl} />}
          {slide.questionType === 'audio' && <audio controls src={slide.mediaUrl} />}
        </div>
      )}

      {showMcq && (
        <div className="options">
          {slide.options.map((opt, i) => (
            <label key={i} className={`option-label ${answer === opt ? 'selected' : ''}`}>
              <input
                type="radio"
                name={`q-${slide.questionId}`}
                value={opt}
                checked={answer === opt}
                onChange={(e) => onChange(e.target.value)}
                disabled={locked}
              />
              <span className="option-letter">{String.fromCharCode(65 + i)}</span>
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}

      {showText && (
        <input
          type="text"
          className="answer-input"
          placeholder={showMcq ? 'Or type your answer...' : 'Type your answer...'}
          value={answer}
          onChange={(e) => onChange(e.target.value)}
          disabled={locked}
        />
      )}

      {locked && (
        <div className={`score-badge ${score === 1 ? 'score-full' : score === 0.5 ? 'score-half' : score === 0 ? 'score-zero' : 'score-pending'}`}>
          {score !== undefined ? `${score} pt awarded` : 'Locked — awaiting marking'}
        </div>
      )}
    </div>
  );
}

function WaitingMessage({ text, subtext }) {
  return (
    <div className="waiting-inline">
      <h2>{text}</h2>
      {subtext && <p>{subtext}</p>}
    </div>
  );
}
