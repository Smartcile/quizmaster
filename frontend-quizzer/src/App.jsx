import { useState, useEffect, useRef, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import JoinQuiz from './pages/JoinQuiz';
import QuizParticipant, { AnswerReviewView } from './pages/QuizParticipant';
import LiveScoreboard from './components/LiveScoreboard';
import { buildSlides } from './utils/buildSlides';
import { api } from './services/api';

// Read deep-link context from the URL once. Supports test-mode params:
//   ?session=<id>  → target a specific session (bypass active-session lookup)
//   ?team=<name>&size=<n>&autojoin=1 → auto-join as that team (bot mirror pane)
function getUrlContext() {
  const params = new URLSearchParams(window.location.search);
  const segs = window.location.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const code = params.get('code') || (last && /^[A-Za-z0-9]{4,8}$/.test(last) ? last : null);
  const sid = params.get('session');
  const size = params.get('size');
  return {
    code: code ? code.toUpperCase() : null,
    forcedSessionId: sid ? parseInt(sid) : null,
    autoTeam: params.get('team') || null,
    autoSize: size ? parseInt(size) : null,
  };
}

function App() {
  const [phase, setPhase] = useState('join'); // join | waiting | playing | finished
  const [quiz, setQuiz] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('lobby');
  const [team, setTeam] = useState(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [error, setError] = useState(null);
  const [scoreboardVisible, setScoreboardVisible] = useState(false);
  const [ctx] = useState(getUrlContext);
  const [reviewOpen, setReviewOpen] = useState(false);
  const autoJoinedRef = useRef(false);
  const socket = useWebSocket();

  // Does this quiz have an Answer Review widget configured to show on the scoreboard?
  const reviewOnScoreboard = useMemo(() => {
    const items = quiz?.items || [];
    return items.some(i => i.kind === 'widget' && i.type === 'review'
      && i.data && typeof i.data !== 'string' && i.data.showOnScoreboard);
  }, [quiz]);

  // ── Restore team identity from sessionStorage after page refresh ──────────
  useEffect(() => {
    if (ctx.autoTeam) return; // test mirror pane auto-joins below; don't restore
    const stored = sessionStorage.getItem('quizTeam');
    if (!stored) return;
    let parsed;
    try { parsed = JSON.parse(stored); } catch { sessionStorage.removeItem('quizTeam'); return; }
    // `code` is the session code (preferred) — falls back to the legacy quizCode key
    const { teamId, code, quizCode } = parsed || {};
    const joinCode = code || quizCode;
    if (!teamId || !joinCode) return;

    (async () => {
      try {
        const [teamData, resolved] = await Promise.all([
          api.get(`/teams/${teamId}`),
          api.get(`/quizzes/resolve/${joinCode}`)
        ]);
        const quizData = resolved.quiz;
        const session = resolved.session;
        if (!quizData || !session) throw new Error('stale');
        setTeam(teamData);
        setQuiz(quizData);
        setSessionId(session.id);
        setSessionStatus(session.status || 'lobby');
        setCurrentSlide(session.current_slide_index || 0);
        if (session.status === 'active')        setPhase('playing');
        else if (session.status === 'finished') setPhase('finished');
        else                                    setPhase('waiting');
      } catch {
        // Stored session is stale — clear it and stay on join screen
        sessionStorage.removeItem('quizTeam');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = async (code, teamName, teamSize) => {
    setError(null);
    try {
      // Resolve the code → quiz + session. A test iframe targets a specific
      // session id; otherwise the resolver matches a session code (any status,
      // so finished codes work for history lookup) or falls back to the quiz
      // code → its current live session.
      let quizData, session;
      if (ctx.forcedSessionId) {
        quizData = await api.get(`/quizzes/by-code/${code}`);
        try { session = await api.get(`/quizzes/sessions/${ctx.forcedSessionId}`); }
        catch { setError('Test session not found.'); return; }
      } else {
        const resolved = await api.get(`/quizzes/resolve/${code}`).catch(() => null);
        if (!resolved || !resolved.quiz) { setError(`Code "${code}" not found.`); return; }
        quizData = resolved.quiz;
        session  = resolved.session;
        if (!session) { setError('No active session for this quiz yet. Ask the quiz master to start it.'); return; }
      }

      // Register/rejoin the team for THIS session (find-or-create by name; a
      // finished session returns the existing team for read-only review or 404).
      const teamData = await api.post('/teams/join', {
        sessionId: session.id,
        name: teamName,
        size: teamSize
      });

      setQuiz(quizData);
      setSessionId(session.id);
      setSessionStatus(session.status || 'lobby');
      setCurrentSlide(session.current_slide_index || 0);
      setTeam(teamData);
      setPhase(session.status === 'active' ? 'playing' : session.status === 'finished' ? 'finished' : 'waiting');

      // Persist the SESSION code so a refresh rejoins this exact session
      sessionStorage.setItem('quizTeam', JSON.stringify({ teamId: teamData.id, code: session.code || code }));

      if (teamData.rejoined) {
        console.info(`Reconnected to existing team "${teamData.name}"`);
      }
    } catch (err) {
      setError(err.message || 'Failed to join quiz');
    }
  };

  // ── Auto-join as a bot team (test "mirror" pane) ──────────────────────────
  useEffect(() => {
    if (ctx.autoTeam && ctx.code && phase === 'join' && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      handleJoin(ctx.code, ctx.autoTeam, ctx.autoSize || 5);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket subscriptions + auto-rejoin ────────────────────────────────
  useEffect(() => {
    if (!socket || !sessionId || !team) return;

    // Unified join/rejoin — called on every (re)connect
    const rejoin = () => socket.emit('join_quiz', { sessionId, teamId: team.id, teamName: team.name, role: 'team' });

    // session_state: full authoritative state sent by server on every join_quiz
    const onSessionState = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
      if (data.scoreboardVisibility) setScoreboardVisible(!!data.scoreboardVisibility.quizzer);
      if (data.status) {
        setSessionStatus(data.status);
        if (data.status === 'active')        setPhase('playing');
        else if (data.status === 'lobby')    setPhase('waiting');
        else if (data.status === 'finished') setPhase('finished');
      }
    };
    const onScoreboardVis = (data) => {
      if (data?.visibility) setScoreboardVisible(!!data.visibility.quizzer);
    };
    const onSlide = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
    };
    const onStatus = (data) => {
      setSessionStatus(data.status);
      if (typeof data.currentSlideIndex === 'number') setCurrentSlide(data.currentSlideIndex);
      if (data.status === 'active')        setPhase('playing');
      else if (data.status === 'lobby')    setPhase('waiting');
      else if (data.status === 'finished') setPhase('finished');
    };

    socket.on('connect',                rejoin);
    socket.on('session_state',          onSessionState);
    socket.on('slide_changed',          onSlide);
    socket.on('session_status_changed', onStatus);
    socket.on('scoreboard_visibility_changed', onScoreboardVis);

    // If socket is already connected when the effect runs, join immediately
    if (socket.connected) rejoin();

    return () => {
      socket.off('connect',                rejoin);
      socket.off('session_state',          onSessionState);
      socket.off('slide_changed',          onSlide);
      socket.off('session_status_changed', onStatus);
      socket.off('scoreboard_visibility_changed', onScoreboardVis);
    };
  }, [socket, sessionId, team]);

  const renderView = () => {
    if (phase === 'join') {
      return <JoinQuiz onJoin={handleJoin} error={error} />;
    }

    if (phase === 'waiting') {
      return (
        <div className="waiting-screen">
          <div className="waiting-card">
            <h1>🎯 {quiz?.name}</h1>
            <p className="waiting-team">Team: <strong>{team?.name}</strong></p>
            <div className="waiting-spinner" />
            <p className="waiting-status">Waiting for the quiz master to begin...</p>
          </div>
        </div>
      );
    }

    if (phase === 'finished') {
      // Read-only history: the team's own answers + scores, grouped by round.
      return <ReviewScreen quiz={quiz} team={team} />;
    }

    return (
      <QuizParticipant
        quiz={quiz}
        sessionId={sessionId}
        sessionStatus={sessionStatus}
        team={team}
        currentSlide={currentSlide}
        socket={socket}
      />
    );
  };

  return (
    <>
      {renderView()}
      {scoreboardVisible && sessionId && (
        <div className="sb-overlay">
          <LiveScoreboard sessionId={sessionId} socket={socket} title="Scoreboard" />
          {reviewOnScoreboard && team && (
            <button className="sb-view-answers" onClick={() => setReviewOpen(true)}>
              📝 View my answers
            </button>
          )}
        </div>
      )}

      {reviewOpen && team && (
        <div className="modal-overlay" onClick={() => setReviewOpen(false)}>
          <div className="review-popup" onClick={(e) => e.stopPropagation()}>
            <button className="btn-close review-popup-close" onClick={() => setReviewOpen(false)}>×</button>
            <ReviewScreen quiz={quiz} team={team} />
          </div>
        </div>
      )}
    </>
  );
}

// Read-only end-of-quiz review shown when a session is finished (including when
// a team re-enters an old code later to look up their answers and scores).
function ReviewScreen({ quiz, team }) {
  const [answers, setAnswers] = useState({});
  const [scores, setScores]   = useState({});
  const slides = useMemo(() => buildSlides(quiz), [quiz]);

  useEffect(() => {
    if (!team?.id) return;
    api.get(`/teams/${team.id}/answers`).then(rows => {
      const n = {};
      (rows || []).forEach(r => { if (r.question_id != null) n[r.question_id] = r.answer_text; });
      setAnswers(n);
    }).catch(() => {});
    api.get(`/teams/${team.id}/scores`).then(res => {
      const n = {};
      (res?.scores || []).forEach(s => { if (s.question_id != null) n[s.question_id] = parseFloat(s.points); });
      setScores(n);
    }).catch(() => {});
  }, [team?.id]);

  return (
    <div className="quiz-participant">
      <div className="quiz-header">
        <h1>🏁 {quiz?.name}</h1>
        <p>Team <strong>{team?.name}</strong> · final review</p>
      </div>
      <div className="quiz-content">
        <AnswerReviewView title="Your Answers & Scores" slides={slides} answers={answers} scores={scores} />
      </div>
    </div>
  );
}

export default App;
