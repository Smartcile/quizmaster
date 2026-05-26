import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import JoinQuiz from './pages/JoinQuiz';
import QuizParticipant from './pages/QuizParticipant';
import { api } from './services/api';

function App() {
  const [page, setPage] = useState('join');
  const [sessionData, setSessionData] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const socket = useWebSocket();

  const handleJoin = async (code, teamName, teamSize) => {
    try {
      const quizzes = await api.get(`/quizzes?code=${code}`);

      if (!quizzes.length) {
        alert('Invalid quiz code');
        return;
      }

      const quiz = quizzes[0];
      const session = await api.post(`/quizzes/${quiz.id}/start`);
      const team = await api.post('/teams/join', { sessionId: session.id, name: teamName, size: teamSize });

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
