import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { buildSlides } from '../utils/buildSlides';

export default function QuizParticipant({ quiz, sessionId, team, currentSlide, socket }) {
  const [answers,          setAnswers]          = useState({});
  const [lockedRounds,     setLockedRounds]      = useState(new Set());
  const [scores,           setScores]            = useState({});
  const [viewingQuestionId, setViewingQuestionId] = useState(null); // null = follow admin

  const slides = useMemo(() => buildSlides(quiz), [quiz]);
  const slide = slides[currentSlide];

  // All question slides in the current round (for in-round navigation)
  const questionsInCurrentRound = useMemo(() => {
    if (!slide?.roundId) return [];
    return slides.filter(s => s.type === 'question' && s.roundId === slide.roundId);
  }, [slides, slide]);

  // Follow the quiz master: whenever the host advances the slide, snap the
  // quizzer back to the host's view. The team may still navigate to other
  // questions in the round afterward — but a host slide change always wins.
  useEffect(() => {
    setViewingQuestionId(null);
  }, [currentSlide]);

  // The question slide to display — guest may have navigated away from admin's question
  const activeSlide = useMemo(() => {
    if (!viewingQuestionId || slide?.type !== 'question') return slide;
    return questionsInCurrentRound.find(q => q.questionId === viewingQuestionId) || slide;
  }, [viewingQuestionId, slide, questionsInCurrentRound]);

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
    // session_state: restore locked rounds after reconnect
    const onSessionState = (data) => {
      if (Array.isArray(data.lockedRoundIds) && data.lockedRoundIds.length > 0) {
        setLockedRounds(prev => new Set([...prev, ...data.lockedRoundIds]));
      }
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
    const onMarked = (data) => {
      if (data.teamId === team?.id) {
        setScores(prev => ({ ...prev, [data.questionId]: parseFloat(data.points) }));
      }
    };
    socket.on('session_state',   onSessionState);
    socket.on('answer_locked',   onLocked);
    socket.on('answer_unlocked', onUnlocked);
    socket.on('answer_marked',   onMarked);
    return () => {
      socket.off('session_state',   onSessionState);
      socket.off('answer_locked',   onLocked);
      socket.off('answer_unlocked', onUnlocked);
      socket.off('answer_marked',   onMarked);
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
      // activeSlide may be a different question in the same round if the guest navigated
      return (
        <QuestionView
          slide={activeSlide}
          answer={answers[activeSlide.questionId] || ''}
          score={scores[activeSlide.questionId]}
          locked={isLockedFor(activeSlide.roundId)}
          onChange={(v) => submitAnswer(activeSlide.questionId, v)}
        />
      );
    }

    if (slide.type === 'mark_answers') {
      const roundQuestions = slides.filter(s => s.type === 'question' && s.roundId === slide.roundId);
      const locked = isLockedFor(slide.roundId);

      // Guest tapped a question to edit — show the QuestionView with a back button
      if (!locked && viewingQuestionId) {
        const editSlide = roundQuestions.find(q => q.questionId === viewingQuestionId);
        if (editSlide) {
          return (
            <div className="mark-edit-wrapper">
              <button
                className="back-to-review-btn"
                onClick={() => setViewingQuestionId(null)}
              >
                ← Back to Review
              </button>
              <QuestionView
                slide={editSlide}
                answer={answers[editSlide.questionId] || ''}
                score={scores[editSlide.questionId]}
                locked={false}
                onChange={(v) => submitAnswer(editSlide.questionId, v)}
              />
            </div>
          );
        }
      }

      return (
        <div className="mark-answers-review">
          <p className="mark-label">{slide.roundName}</p>
          <h2>{locked ? 'Round Locked' : 'Review Your Answers'}</h2>
          <p className="mark-hint">
            {locked
              ? 'Your answers are locked in. Answers will be revealed next.'
              : 'Tap any question to edit your answer before it locks.'}
          </p>
          <div className="mark-review-list">
            {roundQuestions.map((q) => {
              const ans = answers[q.questionId];
              return (
                <button
                  key={q.questionId}
                  className={`mark-review-item ${ans ? 'answered' : 'unanswered'}`}
                  onClick={() => !locked && setViewingQuestionId(q.questionId)}
                  disabled={locked}
                >
                  <span className="mark-review-q">Q{q.questionNumber}</span>
                  <span className="mark-review-text">{q.text}</span>
                  <span className="mark-review-ans">{ans || '(no answer)'}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
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

      {/* In-round navigation: tap any question to answer/edit it until the round is locked */}
      {slide?.type === 'question' && questionsInCurrentRound.length > 1 && !isLockedFor(slide.roundId) && (
        <div className="round-nav">
          <p className="round-nav-label">Questions in this round:</p>
          <div className="round-nav-buttons">
            {questionsInCurrentRound.map((q) => {
              const isViewing     = q.questionId === (viewingQuestionId || slide.questionId);
              const isAnswered    = !!answers[q.questionId];
              const isHostCurrent = q.questionId === slide.questionId && !isViewing;
              return (
                <button
                  key={q.questionId}
                  onClick={() => setViewingQuestionId(q.questionId)}
                  className={`round-nav-btn ${isViewing ? 'current' : ''} ${isAnswered ? 'answered' : ''} ${isHostCurrent ? 'host-current' : ''}`}
                  title={isHostCurrent ? `Host is on this question: ${q.text}` : q.text}
                >
                  Q{q.questionNumber}
                  {isAnswered && !isViewing && <span className="nav-answered-dot">·</span>}
                </button>
              );
            })}
          </div>
          <p className="round-nav-hint">Tap any question to view or edit your answer. Edits are saved until the round is locked.</p>
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
