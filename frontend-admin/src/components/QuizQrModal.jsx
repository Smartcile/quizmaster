import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../services/api';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Printable static join QR for a quiz. Built from the QUIZ code deep link
// (`${quizzerBase}/${quiz.code}`) — independent of any running session, so
// papers can be printed in advance. Scanning before the session starts is
// fine: the quizzer shows a "waiting for the quiz to start" state and joins
// automatically once the lobby opens.
export default function QuizQrModal({ quiz, onClose }) {
  const [portalConfig, setPortalConfig] = useState(null);
  const qrRef = useRef(null);

  useEffect(() => {
    api.get('/config').then(setPortalConfig).catch(() => {});
  }, []);

  const quizzerBase = (
    portalConfig?.quizzerUrl ||
    `${window.location.protocol}//${window.location.hostname}:3003`
  ).replace(/\/+$/, '');
  const joinUrl = `${quizzerBase}/${quiz.code}`;

  // Print via a minimal standalone window: the rendered SVG is serialized in,
  // so the printout needs no app CSS and always comes out clean.
  const print = () => {
    const svg = qrRef.current?.querySelector('svg');
    const svgHtml = svg ? new XMLSerializer().serializeToString(svg) : '';
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) {
      alert('Pop-up blocked — allow pop-ups for this site to print the QR sheet.');
      return;
    }
    w.document.write(`<!doctype html>
<html><head><title>Join ${escapeHtml(quiz.name)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px; color: #111; }
  h1 { margin: 0 0 6px; }
  .qr svg { width: 320px; height: 320px; }
  .code { font-size: 42px; letter-spacing: 6px; font-weight: 800; margin: 18px 0 6px; }
  .url { font-size: 18px; word-break: break-all; }
  .hint { color: #555; margin-top: 22px; font-size: 14px; }
</style></head>
<body>
  <h1>${escapeHtml(quiz.name)}</h1>
  <p>Scan to join the quiz on your phone</p>
  <div class="qr">${svgHtml}</div>
  <div class="code">${escapeHtml(quiz.code)}</div>
  <div class="url">${escapeHtml(joinUrl)}</div>
  <p class="hint">Or open the address above and enter the code with your team name.</p>
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Join QR — {quiz.name}</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body quiz-qr-body" ref={qrRef}>
          <div className="quiz-qr-code">
            <QRCodeSVG value={joinUrl} size={240} bgColor="#ffffff" fgColor="#07091a" level="M" />
          </div>
          <p className="quiz-qr-code-text">{quiz.code}</p>
          <p className="quiz-qr-url">{joinUrl}</p>
          <p className="help-text">
            Static quiz link — it always points at this quiz's current session, so this
            sheet can be printed before the session is started.
          </p>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
          <button onClick={print} className="btn btn-primary">🖨 Print</button>
        </div>
      </div>
    </div>
  );
}
