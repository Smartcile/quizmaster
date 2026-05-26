import { useState, useEffect } from 'react';

export default function QuizBuilder() {
  const [quizzes, setQuizzes] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [form, setForm] = useState({ name: '', quizRounds: [] });
  const [widgets, setWidgets] = useState([]);
  const [widgetForm, setWidgetForm] = useState({ type: 'scoreboard' });

  useEffect(() => {
    loadQuizzes();
    loadRounds();
  }, []);

  const loadQuizzes = async () => {
    try {
      const response = await fetch('/api/quizzes');
      const data = await response.json();
      setQuizzes(data);
    } catch (error) {
      console.error('Error loading quizzes:', error);
    }
  };

  const loadRounds = async () => {
    try {
      const response = await fetch('/api/rounds');
      const data = await response.json();
      setRounds(data);
    } catch (error) {
      console.error('Error loading rounds:', error);
    }
  };

  const handleCreateQuiz = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        rounds: form.quizRounds,
        widgets: widgets
      };

      const response = await fetch('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const newQuiz = await response.json();
        alert(`Quiz created! Code: ${newQuiz.code}`);
        setForm({ name: '', quizRounds: [] });
        setWidgets([]);
        loadQuizzes();
      }
    } catch (error) {
      console.error('Error creating quiz:', error);
    }
  };

  const toggleRound = (roundId) => {
    const updated = form.quizRounds.includes(roundId)
      ? form.quizRounds.filter(id => id !== roundId)
      : [...form.quizRounds, roundId];
    setForm({ ...form, quizRounds: updated });
  };

  const addWidget = () => {
    setWidgets([...widgets, { type: widgetForm.type, data: {} }]);
    setWidgetForm({ type: 'scoreboard' });
  };

  const removeWidget = (index) => {
    setWidgets(widgets.filter((_, i) => i !== index));
  };

  return (
    <div className="quiz-builder">
      <h2>Quiz Builder</h2>

      <div className="builder-split">
        <div className="left-panel">
          <h3>Available Rounds & Widgets</h3>
          <div className="item-list">
            <div className="section">
              <h4>Rounds</h4>
              {rounds.map(r => (
                <label key={r.id} className="item-label">
                  <input
                    type="checkbox"
                    checked={form.quizRounds.includes(r.id)}
                    onChange={() => toggleRound(r.id)}
                  />
                  <span>{r.name}</span>
                </label>
              ))}
            </div>

            <div className="section">
              <h4>Widgets</h4>
              <div className="widget-adder">
                <select value={widgetForm.type} onChange={(e) => setWidgetForm({ ...widgetForm, type: e.target.value })}>
                  <option value="scoreboard">Scoreboard</option>
                  <option value="rules">Rules</option>
                  <option value="custom">Custom Page</option>
                </select>
                <button onClick={addWidget} className="btn btn-sm btn-secondary">+ Add Widget</button>
              </div>
            </div>
          </div>
        </div>

        <div className="right-panel">
          <h3>Create Quiz</h3>
          <form onSubmit={handleCreateQuiz} className="form">
            <input
              type="text"
              placeholder="Quiz name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <p>Rounds: {form.quizRounds.length} | Widgets: {widgets.length}</p>
            <button type="submit" className="btn btn-primary">Create Quiz</button>
          </form>

          <div className="selected-items">
            <h4>Selected Items ({form.quizRounds.length + widgets.length})</h4>
            <div className="item-order">
              {form.quizRounds.map((roundId, i) => {
                const round = rounds.find(r => r.id === roundId);
                return <div key={roundId} className="item-badge">{i + 1}. {round?.name}</div>;
              })}
              {widgets.map((w, i) => (
                <div key={i} className="item-badge">
                  {form.quizRounds.length + i + 1}. {w.type}
                  <button onClick={() => removeWidget(i)} className="btn-close">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>My Quizzes ({quizzes.length})</h3>
        <div className="quiz-list">
          {quizzes.map(q => (
            <div key={q.id} className="quiz-card">
              <h4>{q.name}</h4>
              <p>Code: <strong>{q.code}</strong></p>
              <p>Created: {new Date(q.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
