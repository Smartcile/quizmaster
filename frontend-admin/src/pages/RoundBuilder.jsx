import { useState, useEffect } from 'react';

export default function RoundBuilder() {
  const [rounds, setRounds] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [form, setForm] = useState({ name: '', background_color: '#e8f4f8', format: 'standard', selectedQuestions: [] });
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    loadRounds();
    loadQuestions();
  }, []);

  const loadRounds = async () => {
    try {
      const response = await fetch('/api/rounds');
      const data = await response.json();
      setRounds(data);
    } catch (error) {
      console.error('Error loading rounds:', error);
    }
  };

  const loadQuestions = async () => {
    try {
      const response = await fetch('/api/questions');
      const data = await response.json();
      setQuestions(data);
    } catch (error) {
      console.error('Error loading questions:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        background_color: form.background_color,
        format: form.format,
        questions: form.selectedQuestions
      };

      const url = editingId ? `/api/rounds/${editingId}` : '/api/rounds';
      const method = editingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        setForm({ name: '', background_color: '#e8f4f8', format: 'standard', selectedQuestions: [] });
        setEditingId(null);
        loadRounds();
      }
    } catch (error) {
      console.error('Error saving round:', error);
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/rounds/${id}`, { method: 'DELETE' });
      loadRounds();
    } catch (error) {
      console.error('Error deleting round:', error);
    }
  };

  const toggleQuestion = (questionId) => {
    const selected = form.selectedQuestions.includes(questionId)
      ? form.selectedQuestions.filter(id => id !== questionId)
      : [...form.selectedQuestions, questionId];
    setForm({ ...form, selectedQuestions: selected });
  };

  return (
    <div className="round-builder">
      <h2>Round Builder</h2>

      <div className="builder-split">
        <div className="left-panel">
          <h3>Available Questions</h3>
          <div className="question-selector">
            {questions.map(q => (
              <label key={q.id} className="question-checkbox">
                <input
                  type="checkbox"
                  checked={form.selectedQuestions.includes(q.id)}
                  onChange={() => toggleQuestion(q.id)}
                />
                <span>{q.text} ({q.type})</span>
              </label>
            ))}
          </div>
        </div>

        <div className="right-panel">
          <h3>Create/Edit Round</h3>
          <form onSubmit={handleSubmit} className="form">
            <input
              type="text"
              placeholder="Round name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              type="color"
              value={form.background_color}
              onChange={(e) => setForm({ ...form, background_color: e.target.value })}
            />
            <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              <option value="standard">Standard</option>
              <option value="rapid-fire">Rapid Fire</option>
              <option value="who-am-i">Who Am I?</option>
            </select>
            <p>{form.selectedQuestions.length} questions selected</p>
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Update Round' : 'Create Round'}
            </button>
            {editingId && <button type="button" onClick={() => setEditingId(null)} className="btn btn-secondary">Cancel</button>}
          </form>
        </div>
      </div>

      <div className="panel">
        <h3>Rounds ({rounds.length})</h3>
        <div className="round-list">
          {rounds.map(r => (
            <div key={r.id} className="round-item">
              <div>
                <h4>{r.name}</h4>
                <p>Format: {r.format} | Questions: {r.questions?.length || 0}</p>
              </div>
              <div>
                <button onClick={() => { setEditingId(r.id); setForm({ ...r, selectedQuestions: (r.questions || []).map(q => q.id) }); }} className="btn btn-sm">Edit</button>
                <button onClick={() => handleDelete(r.id)} className="btn btn-danger btn-sm">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
