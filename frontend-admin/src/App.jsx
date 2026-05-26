import { useState } from 'react';
import { api } from './services/api';
import QuestionManager from './pages/QuestionManager';
import RoundBuilder from './pages/RoundBuilder';
import QuizBuilder from './pages/QuizBuilder';
import AnswerMarking from './pages/AnswerMarking';
import QuizControl from './pages/QuizControl';

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [activeQuiz, setActiveQuiz] = useState(null); // { sessionId, quiz }

  const handleQuizStart = (sessionId, quiz) => {
    setActiveQuiz({ sessionId, quiz });
    setCurrentPage('control');
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'questions':
        return <QuestionManager />;
      case 'rounds':
        return <RoundBuilder />;
      case 'quizzes':
        return <QuizBuilder />;
      case 'marking':
        return <AnswerMarking sessionId={activeQuiz?.sessionId} />;
      case 'control':
        return <QuizControl sessionId={activeQuiz?.sessionId} quiz={activeQuiz?.quiz} />;
      default:
        return <Dashboard onQuizStart={handleQuizStart} />;
    }
  };

  return (
    <div className="admin-container">
      <nav className="admin-nav">
        <div className="nav-header">
          <h1>📊 Quiz Master Admin</h1>
        </div>
        <ul className="nav-menu">
          <li><button onClick={() => setCurrentPage('dashboard')} className={currentPage === 'dashboard' ? 'active' : ''}>Dashboard</button></li>
          <li><button onClick={() => setCurrentPage('questions')} className={currentPage === 'questions' ? 'active' : ''}>Questions</button></li>
          <li><button onClick={() => setCurrentPage('rounds')} className={currentPage === 'rounds' ? 'active' : ''}>Rounds</button></li>
          <li><button onClick={() => setCurrentPage('quizzes')} className={currentPage === 'quizzes' ? 'active' : ''}>Quizzes</button></li>
          {activeQuiz && (
            <>
              <li><button onClick={() => setCurrentPage('control')} className={currentPage === 'control' ? 'active' : ''}>Control</button></li>
              <li><button onClick={() => setCurrentPage('marking')} className={currentPage === 'marking' ? 'active' : ''}>Mark Answers</button></li>
            </>
          )}
        </ul>
        {activeQuiz && (
          <div className="active-quiz-banner">
            <p>Active: <strong>{activeQuiz.quiz.name}</strong></p>
            <p>Code: <strong>{activeQuiz.quiz.code}</strong></p>
          </div>
        )}
      </nav>
      <main className="admin-main">
        {renderPage()}
      </main>
    </div>
  );
}

function Dashboard({ onQuizStart }) {
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadQuizzes = async () => {
    try {
      setQuizzes(await api.get('/quizzes'));
      setError(null);
    } catch (err) {
      setError('Failed to load quizzes: ' + err.message);
    }
  };

  const startQuiz = async (quizId) => {
    setLoading(true);
    try {
      const [session, quiz] = await Promise.all([
        api.post(`/quizzes/${quizId}/start`),
        api.get(`/quizzes/${quizId}`)
      ]);
      onQuizStart(session.id, quiz);
    } catch (err) {
      setError('Failed to start quiz: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      {error && <div className="error-banner">{error}</div>}
      <button onClick={loadQuizzes} className="btn btn-primary">Load Quizzes</button>
      <div className="quiz-list">
        {quizzes.map(quiz => (
          <div key={quiz.id} className="quiz-card">
            <h3>{quiz.name}</h3>
            <p>Code: <strong>{quiz.code}</strong></p>
            <button onClick={() => startQuiz(quiz.id)} className="btn btn-success" disabled={loading}>
              {loading ? 'Starting...' : 'Start Quiz'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
