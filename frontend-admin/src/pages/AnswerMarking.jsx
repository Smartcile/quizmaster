import { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

export default function AnswerMarking({ sessionId }) {
  const [answers, setAnswers] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [teams, setTeams] = useState([]);
  const socket = useWebSocket();

  useEffect(() => {
    if (!sessionId) return;
    loadTeams();
  }, [sessionId]);

  const loadTeams = async () => {
    try {
      const response = await fetch(`/api/teams/session/${sessionId}`);
      const data = await response.json();
      setTeams(data);
    } catch (error) {
      console.error('Error loading teams:', error);
    }
  };

  const loadAnswersForQuestion = async (questionId) => {
    try {
      const response = await fetch(`/api/answers/question?questionId=${questionId}&sessionId=${sessionId}`);
      const data = await response.json();
      setAnswers(data);
      setCurrentQuestion(questionId);
    } catch (error) {
      console.error('Error loading answers:', error);
    }
  };

  const markAnswer = async (teamId, points) => {
    try {
      await fetch('/api/answers/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, questionId: currentQuestion, points })
      });

      if (socket) {
        socket.emit('mark_answer', {
          sessionId,
          teamId,
          questionId: currentQuestion,
          points
        });
      }

      loadAnswersForQuestion(currentQuestion);
    } catch (error) {
      console.error('Error marking answer:', error);
    }
  };

  return (
    <div className="answer-marking">
      <h2>Answer Marking</h2>

      {!sessionId ? (
        <p>Start a quiz to mark answers</p>
      ) : (
        <div className="marking-layout">
          <div className="teams-panel">
            <h3>Teams ({teams.length})</h3>
            <div className="team-list">
              {teams.map(t => (
                <div key={t.id} className="team-card">
                  <h4>{t.name}</h4>
                  <p>Size: {t.size}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="marking-panel">
            <h3>Answers</h3>
            {answers.length === 0 ? (
              <p>Select a question to mark answers</p>
            ) : (
              <div className="answers-list">
                {answers.map(a => (
                  <div key={a.id} className="answer-item">
                    <div className="answer-content">
                      <h4>{a.team_name}</h4>
                      <p>Answer: {a.answer_text || '(no answer)'}</p>
                      <p className="correct">Correct: {a.correct_answer}</p>
                    </div>
                    <div className="score-buttons">
                      <button onClick={() => markAnswer(a.team_id, 0)} className="btn btn-danger btn-sm">0</button>
                      <button onClick={() => markAnswer(a.team_id, 0.5)} className="btn btn-warning btn-sm">0.5</button>
                      <button onClick={() => markAnswer(a.team_id, 1)} className="btn btn-success btn-sm">1</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
