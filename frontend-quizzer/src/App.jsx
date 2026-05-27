import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import JoinQuiz from './pages/JoinQuiz';
import QuizParticipant from './pages/QuizParticipant';
import { api } from './services/api';

function App() {
  const [phase, setPhase] = useState('join'); // join | waiting | playing | finished
  const [quiz, setQuiz] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('lobby');
  const [team, setTeam] = useState(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [error, setError] = useState(null);
  const socket = useWebSocket();

  // ── Restore team identity from sessionStorage after page refresh ──────────
  useEffect(() => {
    const stored = sessionStorage.getItem('quizTeam');
    if (!stored) return;
    let parsed;
    try { parsed = JSON.parse(stored); } catch { sessionStorage.removeItem('quizTeam'); return; }
    const { teamId, quizCode } = parsed || {};
    if (!teamId || !quizCode) return;

    (async () => {
      try {
        const [teamData, quizData] = await Promise.all([
          api.get(`/teams/${teamId}`),
          api.get(`/quizzes/by-code/${quizCode}`)
        ]);
        const session = await api.get(`/quizzes/${quizData.id}/active-session`);
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
      // 1) Look up the quiz by code (full data with rounds + questions)
      const quizData = await api.get(`/quizzes/by-code/${code}`);

      // 2) Find the active session (lobby or active). If none, wait.
      let session;
      try {
        session = await api.get(`/quizzes/${quizData.id}/active-session`);
      } catch {
        setError('No active session for this quiz yet. Ask the quiz master to start it.');
        return;
      }

      // 3) Register the team for THIS session.
      // The server does find-or-create by name, so re-joining with the same
      // team name reattaches to the original team and all its answers.
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
      setPhase(session.status === 'active' ? 'playing' : 'waiting');

      // Persist identity so a page refresh rejoins automatically
      sessionStorage.setItem('quizTeam', JSON.stringify({ teamId: teamData.id, quizCode: code }));

      if (teamData.rejoined) {
        // Soft notice — keeps the user oriented if they thought they'd lost progress
        console.info(`Reconnected to existing team "${teamData.name}"`);
      }
    } catch (err) {
      setError(err.message || 'Failed to join quiz');
    }
  };

  // ── WebSocket subscriptions + auto-rejoin ────────────────────────────────
  useEffect(() => {
    if (!socket || !sessionId || !team) return;

    // Unified join/rejoin — called on every (re)connect
    const rejoin = () => socket.emit('join_quiz', { sessionId, teamId: team.id, teamName: team.name, role: 'team' });

    // session_state: full authoritative state sent by server on every join_quiz
    const onSessionState = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
      if (data.status) {
        setSessionStatus(data.status);
        if (data.status === 'active')        setPhase('playing');
        else if (data.status === 'lobby')    setPhase('waiting');
        else if (data.status === 'finished') setPhase('finished');
      }
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

    // If socket is already connected when the effect runs, join immediately
    if (socket.connected) rejoin();

    return () => {
      socket.off('connect',                rejoin);
      socket.off('session_state',          onSessionState);
      socket.off('slide_changed',          onSlide);
      socket.off('session_status_changed', onStatus);
    };
  }, [socket, sessionId, team]);

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
    return (
      <div className="waiting-screen">
        <div className="waiting-card">
          <h1>🏁 Quiz Complete</h1>
          <p className="waiting-team">Thanks for playing, <strong>{team?.name}</strong>!</p>
        </div>
      </div>
    );
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
}

export default App;
