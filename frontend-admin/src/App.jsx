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

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  questions: 'Questions',
  rounds: 'Rounds',
  quizzes: 'Quizzes',
  'masters-slides': 'Masters & Slides',
  media: 'Media',
  history: 'History',
  settings: 'Settings',
  control: 'Control',
  marking: 'Mark Answers',
};

function App() {
  const [authed, setAuthed] = useState(null); // null = checking, false = login, true = in
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [activeQuiz, setActiveQuiz] = useState(null); // { sessionId, quiz }
  const [navOpen, setNavOpen] = useState(false);      // mobile drawer

  // Boot: verify token if present
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    verifyAdminToken().then(ok => setAuthed(ok));
  }, []);

  // Mobile drawer: lock the page behind it and close on Escape.
  useEffect(() => {
    document.body.classList.toggle('nav-locked', navOpen);
    return () => document.body.classList.remove('nav-locked');
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

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
    setNavOpen(false);
    clearToken();
    setActiveQuiz(null);
    setAuthed(false);
  };

  // Navigate and close the mobile drawer in one step.
  const go = (page) => {
    setCurrentPage(page);
    setNavOpen(false);
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
        return <AnswerMarking sessionId={activeQuiz?.sessionId} quiz={activeQuiz?.quiz} />;
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
      {/* Compact mobile top bar — the sidebar becomes a drawer below 700px. */}
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label="Open menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <span className="mobile-topbar-title">{PAGE_TITLES[currentPage] || 'Quiz Master'}</span>
        {activeQuiz && (
          <span
            className={`mobile-session-dot ${activeQuiz.isTest ? 'is-test' : ''}`}
            aria-label={activeQuiz.isTest ? 'Test session' : 'Live session'}
          />
        )}
      </header>

      <nav className={`admin-nav ${navOpen ? 'nav-open' : ''}`} aria-label="Main">
        <div className="nav-header">
          <h1>📊 Quiz Master Admin</h1>
          <button
            type="button"
            className="nav-close"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
          >
            ✕
          </button>
        </div>
        <ul className="nav-menu">
          <li><button onClick={() => go('dashboard')} className={currentPage === 'dashboard' ? 'active' : ''}>Dashboard</button></li>
          <li><button onClick={() => go('questions')} className={currentPage === 'questions' ? 'active' : ''}>Questions</button></li>
          <li><button onClick={() => go('rounds')} className={currentPage === 'rounds' ? 'active' : ''}>Rounds</button></li>
          <li><button onClick={() => go('quizzes')} className={currentPage === 'quizzes' ? 'active' : ''}>Quizzes</button></li>
          <li><button onClick={() => go('masters-slides')} className={currentPage === 'masters-slides' ? 'active' : ''}>Masters &amp; Slides</button></li>
          <li><button onClick={() => go('media')} className={currentPage === 'media' ? 'active' : ''}>Media</button></li>
          <li><button onClick={() => go('history')} className={currentPage === 'history' ? 'active' : ''}>History</button></li>
          <li><button onClick={() => go('settings')} className={currentPage === 'settings' ? 'active' : ''}>Settings</button></li>
        </ul>

        {activeQuiz && (
          <div className={`nav-temp-group ${activeQuiz.isTest ? 'nav-temp-test' : 'nav-temp-live'}`}>
            <span className="nav-temp-label">
              {activeQuiz.isTest ? '🧪 Test session' : '● Live session'}
            </span>
            <ul className="nav-menu nav-temp-menu">
              <li><button onClick={() => go('control')} className={currentPage === 'control' ? 'active' : ''}>Control</button></li>
              <li><button onClick={() => go('marking')} className={currentPage === 'marking' ? 'active' : ''}>Mark Answers</button></li>
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

      <div
        className={`nav-backdrop ${navOpen ? 'show' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <main className="admin-main">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
