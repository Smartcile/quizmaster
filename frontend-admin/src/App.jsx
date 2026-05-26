import { useState } from 'react';
import QuestionManager from './pages/QuestionManager';
import RoundBuilder from './pages/RoundBuilder';
import QuizBuilder from './pages/QuizBuilder';
import AnswerMarking from './pages/AnswerMarking';
import QuizControl from './pages/QuizControl';

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [activeQuizSession, setActiveQuizSession] = useState(null);

  const renderPage = () => {
    switch (currentPage) {
      case 'questions':
        return <QuestionManager />;
      case 'rounds':
        return <RoundBuilder />;
      case 'quizzes':
        return <QuizBuilder />;
      case 'marking':
        return <AnswerMarking sessionId={activeQuizSession} />;
      case 'control':
        return <QuizControl sessionId={activeQuizSession} />;
      default:
        return <Dashboard onQuizStart={setActiveQuizSession} />;
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
          {activeQuizSession && (
            <>
              <li><button onClick={() => setCurrentPage('control')} className={currentPage === 'control' ? 'active' : ''}>Control</button></li>
              <li><button onClick={() => setCurrentPage('marking')} className={currentPage === 'marking' ? 'active' : ''}>Mark Answers</button></li>
            </>
          )}
        </ul>
      </nav>
      <main className="admin-main">
        {renderPage()}
      </main>
    </div>
  );
}

function Dashboard({ onQuizStart }) {
  const [quizzes, setQuizzes] = useState([]);

  const loadQuizzes = async () => {
    try {
      const response = await fetch('/api/quizzes');
      const data = await response.json();
      setQuizzes(data);
    } catch (error) {
      console.error('Error loading quizzes:', error);
    }
  };

  const startQuiz = async (quizId) => {
    try {
      const response = await fetch(`/api/quizzes/${quizId}/start`, { method: 'POST' });
      const session = await response.json();
      onQuizStart(session.id);
    } catch (error) {
      console.error('Error starting quiz:', error);
    }
  };

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      <button onClick={loadQuizzes} className="btn btn-primary">Load Quizzes</button>
      <div className="quiz-list">
        {quizzes.map(quiz => (
          <div key={quiz.id} className="quiz-card">
            <h3>{quiz.name}</h3>
            <p>Code: <strong>{quiz.code}</strong></p>
            <button onClick={() => startQuiz(quiz.id)} className="btn btn-success">Start Quiz</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
