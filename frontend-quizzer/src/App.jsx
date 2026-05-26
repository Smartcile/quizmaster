import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import JoinQuiz from './pages/JoinQuiz';
import QuizParticipant from './pages/QuizParticipant';

function App() {
  const [page, setPage] = useState('join');
  const [sessionData, setSessionData] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const socket = useWebSocket();

  const handleJoin = async (code, teamName, teamSize) => {
    try {
      const quizResponse = await fetch(`/api/quizzes?code=${code}`);
      const quizzes = await quizResponse.json();

      if (quizzes.length === 0) {
        alert('Invalid quiz code');
        return;
      }

      const quiz = quizzes[0];

      const sessionResponse = await fetch(`/api/quizzes/${quiz.id}/start`, {
        method: 'POST'
      });
      const session = await sessionResponse.json();

      const teamResponse = await fetch('/api/teams/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          name: teamName,
          size: teamSize
        })
      });
      const team = await teamResponse.json();

      setSessionData({
        ...session,
        quiz,
        code
      });
      setTeamId(team.id);

      if (socket) {
        socket.emit('join_quiz', {
          sessionId: session.id,
          teamId: team.id,
          teamName
        });
      }

      setPage('quiz');
    } catch (error) {
      console.error('Error joining quiz:', error);
      alert('Failed to join quiz');
    }
  };

  return (
    <div className="quizzer-app">
      {page === 'join' ? (
        <JoinQuiz onJoin={handleJoin} />
      ) : (
        <QuizParticipant
          sessionData={sessionData}
          teamId={teamId}
          socket={socket}
        />
      )}
    </div>
  );
}

export default App;
