import { useState, useEffect } from 'react';
import { clearToken, setUnauthorizedHandler, verifyAdminToken } from './services/api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import QuestionManager from './pages/QuestionManager';
import RoundBuilder from './pages/RoundBuilder';
import QuizBuilder from './pages/QuizBuilder';
import AnswerMarking from './pages/AnswerMarking';
import QuizControl from './pages/QuizControl';
import MastersAndSlides from './pages/MastersAndSlides';
import QuizHistory from './pages/QuizHistory';
import MediaLibrary from './pages/MediaLibrary';
import Settings from './pages/Settings';

function App() {
  const [authed, setAuthed] = useState(null); // null = checking, false = login, true = in
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [activeQuiz, setActiveQuiz] = useState(null); // { sessionId, quiz }

  // Boot: verify token if present
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    verifyAdminToken().then(ok => setAuthed(ok));
  }, []);

  if (authed === null) {
    return <div className="boot-screen"><div className="boot-spinner" /></div>;
  }

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  const handleQuizStart = (sessionId, quiz, isTest = false) => {
    setActiveQuiz({ sessionId, quiz, isTest });
    setCurrentPage('control');
  };

  const handleSessionEnd = () => {
    setActiveQuiz(null);
    setCurrentPage('dashboard');
  };

  const handleLogout = () => {
    clearToken();
    setActiveQuiz(null);
    setAuthed(false);
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
        return <QuizControl sessionId={activeQuiz?.sessionId} quiz={activeQuiz?.quiz} isTest={activeQuiz?.isTest} onSessionEnd={handleSessionEnd} />;
      case 'masters-slides':
        return <MastersAndSlides />;
      case 'history':
        return <QuizHistory />;
      case 'media':
        return <MediaLibrary />;
      case 'settings':
        return <Settings />;
      default:
        return (
          <Dashboard
            onQuizStart={handleQuizStart}
            activeQuizId={activeQuiz?.sessionId}
          />
        );
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
          <li><button onClick={() => setCurrentPage('masters-slides')} className={currentPage === 'masters-slides' ? 'active' : ''}>Masters &amp; Slides</button></li>
          <li><button onClick={() => setCurrentPage('media')} className={currentPage === 'media' ? 'active' : ''}>Media</button></li>
          <li><button onClick={() => setCurrentPage('history')} className={currentPage === 'history' ? 'active' : ''}>History</button></li>
          <li><button onClick={() => setCurrentPage('settings')} className={currentPage === 'settings' ? 'active' : ''}>Settings</button></li>
        </ul>

        {activeQuiz && (
          <div className={`nav-temp-group ${activeQuiz.isTest ? 'nav-temp-test' : 'nav-temp-live'}`}>
            <span className="nav-temp-label">
              {activeQuiz.isTest ? '🧪 Test session' : '● Live session'}
            </span>
            <ul className="nav-menu nav-temp-menu">
              <li><button onClick={() => setCurrentPage('control')} className={currentPage === 'control' ? 'active' : ''}>Control</button></li>
              <li><button onClick={() => setCurrentPage('marking')} className={currentPage === 'marking' ? 'active' : ''}>Mark Answers</button></li>
            </ul>
          </div>
        )}

        {activeQuiz && (
          <div className={`active-quiz-banner ${activeQuiz.isTest ? 'active-quiz-banner-test' : ''}`}>
            <p>{activeQuiz.isTest ? 'Testing' : 'Active'}: <strong>{activeQuiz.quiz.name}</strong></p>
            <p>Code: <strong>{activeQuiz.quiz.code}</strong></p>
          </div>
        )}

        <button onClick={handleLogout} className="logout-btn" title="Sign out">
          ⎋ Sign out
        </button>
      </nav>
      <main className="admin-main">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
