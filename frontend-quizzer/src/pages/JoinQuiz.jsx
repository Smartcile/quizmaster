import { useState } from 'react';

// Read a pre-filled quiz code from the URL. Preferred form is a path segment
// (e.g. https://answer.website.com/ABC123). A legacy ?code=ABC123 query param
// is still honoured for older links.
function codeFromUrl() {
  const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (/^[A-Za-z0-9]{4,8}$/.test(seg)) return seg.toUpperCase();
  const param = new URLSearchParams(window.location.search).get('code');
  return param ? param.toUpperCase() : '';
}

export default function JoinQuiz({ onJoin, error }) {
  const [code, setCode] = useState(codeFromUrl);
  const [teamName, setTeamName] = useState('');
  const [teamSize, setTeamSize] = useState(1);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim() || !teamName.trim()) return;
    setLoading(true);
    try {
      await onJoin(code.toUpperCase(), teamName, parseInt(teamSize));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="join-container">
      <div className="join-card">
        <div className="join-header">
          <h1>🎯 Quiz Master</h1>
          <p>Join a live quiz</p>
        </div>

        {error && <div className="join-error">{error}</div>}

        <form onSubmit={handleSubmit} className="join-form">
          <div className="form-group">
            <label htmlFor="code">Quiz Code</label>
            <input
              id="code"
              type="text"
              placeholder="ABC123"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength="6"
              disabled={loading}
              autoFocus
              required
            />
            <p className="hint">Ask your quiz master for the code</p>
          </div>

          <div className="form-group">
            <label htmlFor="teamName">Team Name</label>
            <input
              id="teamName"
              type="text"
              placeholder="The Quizinators"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              disabled={loading}
              required
            />
            <p className="hint">Lost your connection? Enter the same team name to pick up where you left off.</p>
          </div>

          <div className="form-group">
            <label htmlFor="teamSize">Team Size</label>
            <input
              id="teamSize"
              type="number"
              min="1"
              max="10"
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-join" disabled={loading}>
            {loading ? 'Joining...' : 'Join Quiz'}
          </button>
        </form>
      </div>
    </div>
  );
}
