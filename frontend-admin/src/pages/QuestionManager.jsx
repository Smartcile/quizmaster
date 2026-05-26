import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function QuestionManager() {
  const [questions, setQuestions] = useState([]);
  const [form, setForm] = useState({ text: '', answer: '', type: 'text', points: 1, media_url: '' });
  const [csvFile, setCsvFile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { loadQuestions(); }, []);

  const loadQuestions = async () => {
    try {
      const data = await api.get('/questions');
      setQuestions(data);
      setError(null);
    } catch (err) {
      setError('Failed to load questions: ' + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/questions', form);
      setForm({ text: '', answer: '', type: 'text', points: 1, media_url: '' });
      setError(null);
      loadQuestions();
    } catch (err) {
      setError('Failed to save question: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/questions/${id}`);
      loadQuestions();
    } catch (err) {
      setError('Failed to delete question: ' + err.message);
    }
  };

  const handleCSVUpload = async () => {
    if (!csvFile) return;
    const formData = new FormData();
    formData.append('file', csvFile);
    try {
      await api.upload('/upload/csv', formData);
      alert('CSV uploaded successfully');
      setCsvFile(null);
      loadQuestions();
    } catch (err) {
      setError('Failed to upload CSV: ' + err.message);
    }
  };

  return (
    <div className="question-manager">
      <h2>Question Manager</h2>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <h3>Add Question</h3>
        <form onSubmit={handleSubmit} className="form">
          <input
            type="text"
            placeholder="Question text"
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            required
          />
          <input
            type="text"
            placeholder="Answer"
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
            required
          />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="text">Text</option>
            <option value="mcq">Multiple Choice</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
          </select>
          <input
            type="number"
            placeholder="Points"
            value={form.points}
            onChange={(e) => setForm({ ...form, points: parseInt(e.target.value) })}
            min="1"
          />
          <input
            type="text"
            placeholder="Media URL (optional)"
            value={form.media_url}
            onChange={(e) => setForm({ ...form, media_url: e.target.value })}
          />
          <button type="submit" className="btn btn-primary">Add Question</button>
        </form>
      </div>

      <div className="panel">
        <h3>Import from CSV</h3>
        <div className="csv-upload">
          <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} />
          <button onClick={handleCSVUpload} className="btn btn-secondary">Upload CSV</button>
        </div>
        <p className="help-text">CSV format: question, answer, type, points, media_url</p>
      </div>

      <div className="panel">
        <h3>Questions ({questions.length})</h3>
        <div className="question-list">
          {questions.map(q => (
            <div key={q.id} className="question-item">
              <div>
                <h4>{q.text}</h4>
                <p>Answer: {q.answer} | Type: {q.type} | Points: {q.points}</p>
              </div>
              <button onClick={() => handleDelete(q.id)} className="btn btn-danger btn-sm">Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
