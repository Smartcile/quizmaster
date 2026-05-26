import { useState, useEffect } from 'react';

export default function QuestionManager() {
  const [questions, setQuestions] = useState([]);
  const [form, setForm] = useState({ text: '', answer: '', type: 'text', points: 1, media_url: '' });
  const [csvFile, setCsvFile] = useState(null);

  useEffect(() => {
    loadQuestions();
  }, []);

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
      const response = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (response.ok) {
        setForm({ text: '', answer: '', type: 'text', points: 1, media_url: '' });
        loadQuestions();
      }
    } catch (error) {
      console.error('Error creating question:', error);
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/questions/${id}`, { method: 'DELETE' });
      loadQuestions();
    } catch (error) {
      console.error('Error deleting question:', error);
    }
  };

  const handleCSVUpload = async () => {
    if (!csvFile) return;
    const formData = new FormData();
    formData.append('file', csvFile);
    try {
      const response = await fetch('/api/upload/csv', {
        method: 'POST',
        body: formData
      });
      if (response.ok) {
        alert('CSV uploaded successfully');
        setCsvFile(null);
      }
    } catch (error) {
      console.error('Error uploading CSV:', error);
    }
  };

  return (
    <div className="question-manager">
      <h2>Question Manager</h2>

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
            type="url"
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
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files[0])}
          />
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
