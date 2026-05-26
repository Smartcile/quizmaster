import { useState } from 'react';
import { loginAdmin } from '../services/api';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loginAdmin(password);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>🎯 Quiz Master</h1>
          <p>Admin Dashboard</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <label className="form-label">Admin password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              required
              disabled={loading}
            />
          </label>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading || !password}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="login-hint">
          Default password is <code>admin</code> unless you set <code>ADMIN_PASSWORD</code> in your <code>.env</code>.
        </p>
      </div>
    </div>
  );
}
