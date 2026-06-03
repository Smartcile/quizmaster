import { useState, useEffect } from 'react';
import { api } from '../services/api';
import {
  downloadAnswerSheet,
  downloadQuestionsAnswers,
  downloadMarkingForm,
  downloadSlideshowPptx
} from '../utils/quizFiles';

// Popup listing offline downloads for a quiz. Accepts a full `quiz` object OR a
// `quizId` to fetch (the generators need rounds → questions with answers, which
// the list endpoints don't include).
export default function DownloadFilesModal({ quiz: quizProp, quizId, onClose }) {
  const [quiz, setQuiz]   = useState(quizProp || null);
  const [loading, setLoad] = useState(!quizProp);
  const [busy, setBusy]   = useState(null);   // which file is generating
  const [error, setError] = useState(null);

  useEffect(() => {
    // Always (re)fetch the full quiz by id so we have rounds + answers, even if a
    // partial quiz object was passed in.
    const id = quizId || quizProp?.id;
    if (!id) return;
    setLoad(true);
    api.get(`/quizzes/${id}`)
      .then(q => { setQuiz(q); setLoad(false); })
      .catch(err => { setError(err.message); setLoad(false); });
  }, [quizId, quizProp?.id]);

  const run = async (key, fn) => {
    if (!quiz) return;
    setBusy(key); setError(null);
    try {
      await fn(quiz);
    } catch (err) {
      setError('Could not generate that file: ' + err.message);
    } finally {
      setBusy(null);
    }
  };

  const FILES = [
    {
      key: 'answers', icon: '📝', label: 'Quizzer Answer Sheet',
      desc: 'PDF · one page per round · blank answer boxes in the quiz style · team name & size on page 1 · no answers.',
      fn: downloadAnswerSheet
    },
    {
      key: 'qanda', icon: '✅', label: 'Questions & Answers',
      desc: 'PDF · one page per round · correct option highlighted · easy to read for marking.',
      fn: downloadQuestionsAnswers
    },
    {
      key: 'marking', icon: '🗂', label: 'Marking Form',
      desc: 'PDF · per-round grid with 12 team rows and a column per question + total.',
      fn: downloadMarkingForm
    },
    {
      key: 'pptx', icon: '🖥', label: 'Quiz Slideshow (PPTX)',
      desc: 'PowerPoint deck · one slide per quiz slide · dark theme · editable in PowerPoint / Keynote / Google Slides.',
      fn: downloadSlideshowPptx
    }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>⬇ Download Quiz Files{quiz ? ` — ${quiz.name}` : ''}</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body">
          <p className="help-text" style={{ marginTop: 0 }}>
            Offline copies in case the live apps go down — print them or run the deck from any device.
          </p>
          {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}
          {loading ? (
            <p className="help-text">Loading quiz…</p>
          ) : (
            <div className="dlfiles-list">
              {FILES.map(f => (
                <div key={f.key} className="dlfiles-row">
                  <span className="dlfiles-icon">{f.icon}</span>
                  <div className="dlfiles-info">
                    <span className="dlfiles-label">{f.label}</span>
                    <span className="dlfiles-desc">{f.desc}</span>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!quiz || !!busy}
                    onClick={() => run(f.key, f.fn)}
                  >
                    {busy === f.key ? 'Generating…' : 'Download'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
