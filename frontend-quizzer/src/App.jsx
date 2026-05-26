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

      // 3) Register the team for THIS session (don't start a new one)
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
    } catch (err) {
      setError(err.message || 'Failed to join quiz');
    }
  };

  // Subscribe to WebSocket once we have a session
  useEffect(() => {
    if (!socket || !sessionId || !team) return;
    socket.emit('join_quiz', { sessionId, teamId: team.id, teamName: team.name, role: 'team' });

    const onSlide = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
    };
    const onStatus = (data) => {
      setSessionStatus(data.status);
      if (typeof data.currentSlideIndex === 'number') setCurrentSlide(data.currentSlideIndex);
      if (data.status === 'active') setPhase('playing');
      else if (data.status === 'lobby') setPhase('waiting');
      else if (data.status === 'finished') setPhase('finished');
    };

    socket.on('slide_changed', onSlide);
    socket.on('session_status_changed', onStatus);
    return () => {
      socket.off('slide_changed', onSlide);
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
