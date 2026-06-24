import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { buildSlides } from '../utils/buildSlides';
import LiveScoreboard from '../components/LiveScoreboard';

export default function QuizParticipant({ quiz, sessionId, team, currentSlide, socket, scoresVisible = true, showViewAnswers = false, onViewAnswers }) {
  const [answers,          setAnswers]          = useState({});
  const [lockedRounds,     setLockedRounds]      = useState(new Set());
  const [scores,           setScores]            = useState({});
  const [viewingQuestionId, setViewingQuestionId] = useState(null); // null = follow admin
  const [whoamiGuess,      setWhoamiGuess]       = useState('');
  const [whoamiLock,       setWhoamiLock]        = useState(null);   // null = not locked yet

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

  // Questions the host has already revealed in this round. Guests may only
  // navigate to questions up to (and including) the one the host is showing —
  // never jump ahead to a question that hasn't been displayed yet.
  const displayedQuestions = useMemo(() => {
    if (slide?.type !== 'question') return [];
    return questionsInCurrentRound.filter(q => q.questionNumber <= slide.questionNumber);
  }, [questionsInCurrentRound, slide]);

  // The question slide to display — guest may have navigated to an earlier
  // (already-displayed) question. Future questions are never shown.
  const activeSlide = useMemo(() => {
    if (!viewingQuestionId || slide?.type !== 'question') return slide;
    const target = questionsInCurrentRound.find(q => q.questionId === viewingQuestionId);
    if (target && target.questionNumber <= slide.questionNumber) return target;
    return slide;
  }, [viewingQuestionId, slide, questionsInCurrentRound]);

  // Load existing team answers + scores when joining mid-quiz so a reconnecting
  // team resumes exactly where they left off (inputs refilled, scores restored).
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
      try {
        const rows = await api.get(`/teams/${team.id}/answers`);
        const next = {};
        (rows || []).forEach(r => { if (r.question_id != null && r.answer_text != null) next[r.question_id] = r.answer_text; });
        if (Object.keys(next).length) setAnswers(prev => ({ ...next, ...prev }));
      } catch {}
    })();
  }, [team?.id]);

  // Restore this team's Who-Am-I lock state on (re)join
  useEffect(() => {
    if (!team?.id || !sessionId) return;
    (async () => {
      try {
        const res = await api.get(`/whoami/session/${sessionId}`);
        const g = (res?.guesses || []).find(x => x.team_id === team.id);
        if (g && g.locked) {
          setWhoamiLock({
            guess: g.guess_text,
            lockedClueIndex: g.locked_clue_index,
            pointsPossible: g.points_possible,
            pointsAwarded: g.points_awarded
          });
          setWhoamiGuess(g.guess_text || '');
        }
      } catch {}
    })();
  }, [team?.id, sessionId]);

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
    const onWhoamiLocked = (data) => {
      if (data.teamId === team?.id) {
        setWhoamiLock(prev => prev || { lockedClueIndex: data.lockedClueIndex });
      }
    };
    const onWhoamiMarked = (data) => {
      if (data.teamId === team?.id) {
        setWhoamiLock(prev => ({
          ...(prev || {}),
          pointsAwarded: data.points == null ? null : parseFloat(data.points)
        }));
      }
    };
    socket.on('session_state',   onSessionState);
    socket.on('answer_locked',   onLocked);
    socket.on('answer_unlocked', onUnlocked);
    socket.on('answer_marked',   onMarked);
    socket.on('whoami_locked',   onWhoamiLocked);
    socket.on('whoami_marked',   onWhoamiMarked);
    return () => {
      socket.off('session_state',   onSessionState);
      socket.off('answer_locked',   onLocked);
      socket.off('answer_unlocked', onUnlocked);
      socket.off('answer_marked',   onMarked);
      socket.off('whoami_locked',   onWhoamiLocked);
      socket.off('whoami_marked',   onWhoamiMarked);
    };
  }, [socket, team?.id]);

  // Lock in the team's Who-Am-I guess. Points come from the server (the clue
  // currently shown). Immutable once locked.
  const lockWhoami = async (clueIndex) => {
    if (!team || whoamiLock) return;
    try {
      const res = await api.post('/whoami/lock', {
        sessionId, teamId: team.id, clueIndex, guess: whoamiGuess
      });
      setWhoamiLock({
        guess: res.guess_text,
        lockedClueIndex: res.locked_clue_index,
        pointsPossible: res.points_possible,
        pointsAwarded: res.points_awarded
      });
    } catch {}
  };

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

    if (slide.type === 'intermission') {
      const locked = isLockedFor(slide.roundId);
      return (
        <div className="intermission-answers">
          <p className="mark-label">{slide.title}</p>
          <h2>{locked ? 'Round Locked' : 'Picture Round'}</h2>
          <p className="mark-hint">
            {locked ? 'Your answers are locked in.' : 'Match each numbered picture on the big screen and type your answers.'}
          </p>
          <div className="intermission-input-list">
            {(slide.questions || []).map((q) => (
              <div key={q.questionId} className="intermission-input-row">
                <span className="intermission-input-num">{q.questionNumber}</span>
                {q.mediaUrl && q.questionType === 'image' && (
                  <img className="intermission-thumb" src={q.mediaUrl} alt={`Picture ${q.questionNumber}`} />
                )}
                {q.mediaUrl && q.questionType === 'video' && (
                  <video className="intermission-thumb" src={q.mediaUrl} muted />
                )}
                <input
                  type="text"
                  className="answer-input"
                  placeholder={`Answer ${q.questionNumber}`}
                  value={answers[q.questionId] || ''}
                  onChange={(e) => submitAnswer(q.questionId, e.target.value)}
                  disabled={locked}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (slide.type === 'whoami_clue') {
      return (
        <WhoamiView
          slide={slide}
          guess={whoamiGuess}
          lock={whoamiLock}
          onGuessChange={setWhoamiGuess}
          onLock={() => lockWhoami(slide.clueIndex)}
        />
      );
    }

    if (slide.type === 'mark_answers') {
      const roundQuestions = roundQuestionsFromSlides(slides, slide.roundId);
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
      const myScore = scores[slide.questionId];
      const myAns = answers[slide.questionId];
      // 0 → red, 0.5 → yellow, 1 (full) → green
      const hueClass = myScore === 0 ? 'answer-wrong'
        : myScore === 0.5 ? 'answer-half'
        : myScore === 1 ? 'answer-correct' : '';
      // Show the box whenever the team answered OR a score exists (auto-zero for
      // unanswered questions then glows red as "(no answer)").
      const showYour = (myAns !== undefined && myAns !== '') || myScore !== undefined;
      return (
        <div className="reveal-card">
          <p className="reveal-label">{slide.roundName} · {slide.intermission ? `Picture ${slide.questionNumber}` : `Question ${slide.questionNumber}`}</p>
          {slide.intermission && slide.mediaUrl && slide.questionType === 'image' && (
            <img className="reveal-media" src={slide.mediaUrl} alt={`Picture ${slide.questionNumber}`} />
          )}
          {slide.text && <h2 className="reveal-question">{slide.text}</h2>}
          {showYour && (
            <div className={`reveal-your-answer ${hueClass}`}>
              <span className="reveal-your-label">Your answer:</span>
              <span className="reveal-your-text">{myAns || '(no answer)'}</span>
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
      if (slide.widgetType === 'review') {
        return (
          <AnswerReviewView
            title={slide.data?.title || 'Your Answers'}
            slides={slides}
            answers={answers}
            scores={scores}
          />
        );
      }
      // On a scoreboard slide, reveal the live scoreboard — unless the host has
      // toggled scores off for the quizzer (then keep it hidden for suspense).
      if (slide.widgetType === 'scoreboard') {
        if (!scoresVisible) return <WaitingMessage text="Scores hidden — revealing shortly…" />;
        return (
          <div className="quizzer-scoreboard">
            <LiveScoreboard sessionId={sessionId} socket={socket} title={slide.data?.title || 'Leaderboard'} />
            {showViewAnswers && (
              <button className="sb-view-answers" onClick={onViewAnswers}>📝 View my answers</button>
            )}
          </div>
        );
      }
      return <WaitingMessage text={`Coming up: ${slide.widgetType}`} />;
    }

    if (slide.type === 'end') {
      return (
        <div className="waiting-inline">
          <h2>Quiz Complete!</h2>
          <p>Thanks for playing.</p>
          {slide.whoami && slide.whoami.answer && (
            <div className="whoami-reveal-card">
              <p className="whoami-reveal-label">{slide.whoami.title} — the answer was</p>
              <p className="whoami-reveal-answer">{slide.whoami.answer}</p>
              {whoamiLock && (
                <div className={`whoami-result ${whoamiLock.pointsAwarded > 0 ? 'win' : 'miss'}`}>
                  You guessed “{whoamiLock.guess || '—'}” ·{' '}
                  {whoamiLock.pointsAwarded != null
                    ? `${whoamiLock.pointsAwarded} pt${whoamiLock.pointsAwarded !== 1 ? 's' : ''}`
                    : 'awaiting marking'}
                </div>
              )}
            </div>
          )}
        </div>
      );
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

      {/* In-round navigation: tap any already-revealed question to answer/edit it
          until the round is locked. Questions the host hasn't shown yet are hidden. */}
      {slide?.type === 'question' && displayedQuestions.length > 1 && !isLockedFor(slide.roundId) && (
        <div className="round-nav">
          <p className="round-nav-label">Questions in this round:</p>
          <div className="round-nav-buttons">
            {displayedQuestions.map((q) => {
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

// "Name the Song" stores the answer as "Artist — Song" so it reads nicely and
// the backend can score each half.
const NTS_SEP = ' — ';
const splitNTS = (v) => { const i = (v || '').indexOf(NTS_SEP); return i === -1 ? [v || '', ''] : [v.slice(0, i), v.slice(i + NTS_SEP.length)]; };
const combineNTS = (a, s) => (a || s) ? `${a}${NTS_SEP}${s}` : '';

// Normalise a round's questions into QuestionView-compatible slides, working for
// both standard rounds (per-question slides) and intermission picture rounds
// (all questions carried on the single intermission slide).
function roundQuestionsFromSlides(slides, roundId) {
  const inter = slides.find(s => s.type === 'intermission' && s.roundId === roundId);
  if (inter) {
    const qs = inter.questions || [];
    return qs.map(q => ({
      type: 'question',
      roundId,
      questionId: q.questionId,
      questionNumber: q.questionNumber,
      totalInRound: qs.length,
      roundName: inter.title,
      text: q.text,
      questionType: q.questionType,
      mediaUrl: q.mediaUrl,
      options: q.options || [],
      answerMode: 'text',
      points: q.points
    }));
  }
  return slides.filter(s => s.type === 'question' && s.roundId === roundId);
}

function QuestionView({ slide, answer, score, locked, onChange }) {
  const mode = slide.answerMode || 'text';
  const isNameTheSong = slide.audioForm === 'name_the_song';
  const showText = (mode === 'text' || mode === 'both') && !isNameTheSong;
  const showMcq = (mode === 'mcq' || mode === 'both') && Array.isArray(slide.options) && slide.options.length > 0;
  const [ntsArtist, ntsSong] = splitNTS(answer);

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
          {/* Sound plays on the big screen only — phones are silent. Video shows
              muted (no controls) so teams can still see it; audio shows a note. */}
          {slide.questionType === 'video' && <video src={slide.mediaUrl} muted playsInline />}
          {slide.questionType === 'audio' && (
            <div className="media-on-screen-note">🔊 Listen on the main screen</div>
          )}
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

      {isNameTheSong ? (
        <div className="nts-inputs">
          <input
            type="text" className="answer-input" placeholder="Artist"
            value={ntsArtist}
            onChange={(e) => onChange(combineNTS(e.target.value, ntsSong))}
            disabled={locked}
          />
          <input
            type="text" className="answer-input" placeholder="Song title"
            value={ntsSong}
            onChange={(e) => onChange(combineNTS(ntsArtist, e.target.value))}
            disabled={locked}
          />
        </div>
      ) : showText && (
        <input
          type="text"
          className="answer-input"
          placeholder={showMcq ? 'Or type your answer...' : 'Type your answer...'}
          value={answer}
          onChange={(e) => onChange(e.target.value)}
          disabled={locked}
        />
      )}

      {/* When locked we only show that it's locked — never the score or whether
          it was correct. Scores are revealed on the answer slides and on the
          end-of-quiz Answer Review page only. */}
      {locked && (
        <div className="score-badge score-pending">🔒 Answer locked</div>
      )}
    </div>
  );
}

// ── End-of-quiz Answer Review (plugin page) ───────────────────────────────────
// Lists every answer the team gave across the whole quiz, grouped by round, and
// — uniquely among the quizzer pages — shows the score awarded for each one.
export function AnswerReviewView({ title, slides, answers, scores }) {
  // Group all question slides by round, preserving quiz order.
  const groups = [];
  let cur = null;
  for (const s of slides) {
    if (s.type === 'intermission') {
      // Intermission rounds carry all their questions on one slide.
      groups.push({
        roundId: s.roundId,
        roundName: s.title,
        questions: (s.questions || []).map(q => ({
          questionId: q.questionId,
          questionNumber: q.questionNumber,
          text: q.text
        }))
      });
      cur = null;
      continue;
    }
    if (s.type !== 'question') continue;
    if (!cur || cur.roundId !== s.roundId) {
      cur = { roundId: s.roundId, roundName: s.roundName, questions: [] };
      groups.push(cur);
    }
    cur.questions.push(s);
  }

  const scoreClass = (sc) =>
    sc === 0 ? 'answer-wrong' : sc === 0.5 ? 'answer-half' : sc === 1 ? 'answer-correct' : '';
  const scorePill = (sc) =>
    sc === undefined ? null : `${sc} pt${sc !== 1 ? 's' : ''}`;

  let total = 0;
  for (const k in scores) total += Number(scores[k]) || 0;

  return (
    <div className="answer-review">
      <h2 className="answer-review-title">{title}</h2>
      <p className="answer-review-sub">Your answers and scores from tonight's quiz.</p>

      {groups.map(g => (
        <div key={g.roundId} className="answer-review-round">
          <p className="mark-label">{g.roundName}</p>
          <div className="mark-review-list">
            {g.questions.map(q => {
              const ans = answers[q.questionId];
              const sc  = scores[q.questionId];
              return (
                <div key={q.questionId} className={`review-result-item ${scoreClass(sc)}`}>
                  <span className="mark-review-q">Q{q.questionNumber}</span>
                  <span className="mark-review-text">{q.text}</span>
                  <span className="mark-review-ans">{ans || '(no answer)'}</span>
                  <span className={`review-result-pts ${sc === 1 ? 'full' : sc === 0.5 ? 'half' : sc === 0 ? 'zero' : 'pending'}`}>
                    {scorePill(sc) ?? '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="answer-review-total">Round total: <strong>{total}</strong> pt{total !== 1 ? 's' : ''}</div>
    </div>
  );
}

// ── Who Am I? clue + lock-in ───────────────────────────────────────────────────
function WhoamiView({ slide, guess, lock, onGuessChange, onLock }) {
  const locked = !!lock;
  const awarded = lock?.pointsAwarded;

  return (
    <div className="whoami-card">
      <p className="whoami-card-label">{slide.title}</p>
      <div className="whoami-card-points">
        {locked
          ? `Locked in on clue ${(lock.lockedClueIndex ?? slide.clueIndex) + 1}`
          : `Lock in now for ${slide.points} point${slide.points !== 1 ? 's' : ''}`}
      </div>

      <h2 className="whoami-card-clue">{slide.text}</h2>

      {slide.revealed && slide.revealed.length > 1 && (
        <ol className="whoami-card-revealed">
          {slide.revealed.map((c, i) => (
            <li key={i} className={i === slide.clueIndex ? 'current' : ''}>
              <span className="whoami-card-pts">{c.points}</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ol>
      )}

      {locked ? (
        <div className={`whoami-locked-box ${awarded > 0 ? 'win' : awarded === 0 ? 'miss' : ''}`}>
          <span className="whoami-locked-label">Your locked guess</span>
          <span className="whoami-locked-guess">{lock.guess || '—'}</span>
          {awarded != null && (
            <span className="whoami-locked-pts">
              {awarded} pt{awarded !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      ) : (
        <div className="whoami-lockin">
          <input
            type="text"
            className="answer-input"
            placeholder="Your guess…"
            value={guess}
            onChange={(e) => onGuessChange(e.target.value)}
          />
          <button
            className="whoami-lock-btn"
            onClick={onLock}
            disabled={!guess.trim()}
          >
            🔒 Lock in for {slide.points} pt{slide.points !== 1 ? 's' : ''}
          </button>
          <p className="whoami-lock-warn">
            Once you lock in you can't change it — but you keep these points if you're right.
            Wait for a later clue and it's worth less.
          </p>
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
