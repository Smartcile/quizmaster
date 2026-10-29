import { useState, useEffect, useRef, useCallback } from 'react';

const PRESETS = [
  { key: 'free', label: 'Free', ratio: null },
  { key: '1:1',  label: 'Square 1:1', ratio: 1 },
  { key: '4:3',  label: '4:3', ratio: 4 / 3 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: 'a4p',  label: 'A4 portrait', ratio: 210 / 297 },
  { key: 'a4l',  label: 'A4 landscape', ratio: 297 / 210 },
];

const STAGE_W = 560, STAGE_H = 420;
const MIN_CROP = 8; // display px — small enough for a tight close-up

// Resize a crop box by dragging one corner. The opposite corner stays put, the
// box never leaves `bounds`, and an aspect ratio (when set) is preserved.
export function resizeRect(orig, mode, dx, dy, { aspect = null, bounds, min = MIN_CROP }) {
  const east = mode.includes('e');
  const west = mode.includes('w');
  const south = mode.includes('s');
  const north = mode.includes('n');

  const ax = west ? orig.x + orig.w : orig.x;   // anchor = opposite corner
  const ay = north ? orig.y + orig.h : orig.y;
  const maxW = west ? ax : bounds.w - ax;
  const maxH = north ? ay : bounds.h - ay;

  let w = orig.w + (east ? dx : 0) - (west ? dx : 0);
  let h = orig.h + (south ? dy : 0) - (north ? dy : 0);
  w = Math.max(min, Math.min(w, maxW));
  h = Math.max(min, Math.min(h, maxH));

  if (aspect) {
    // Drive the size from whichever axis moved most, then fit the pair inside
    // the stage without distorting the ratio.
    if (Math.abs(w - orig.w) >= Math.abs(h - orig.h)) h = w / aspect;
    else w = h * aspect;
    const fit = Math.min(1, maxW / w, maxH / h);
    w *= fit; h *= fit;
  }

  return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
}

// "Baguette.jpg" -> "Baguette"; strips an upload timestamp prefix and the
// "-clue" suffix so the picture's own name can be used as the answer.
export function clueAnswerName(file) {
  const raw = String(file?.display_name || file?.original_name || file?.filename || '')
    .replace(/\.[^.]+$/, '');
  const cleaned = raw
    .replace(/^\d{10,}[-_ ]?/, '')
    .replace(/[-_ ]?clue$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return cleaned || raw;
}

// In-browser image cropper/resizer. Pick an aspect preset (or free), drag the
// box to move / drag the corner to resize, then export the crop at full source
// resolution and upload as a NEW media file (the original is kept).
//
// Pass `preview` (e.g. { columns: 5, number: 3 }) to show a live mock of the
// crop as a picture-round grid cell — that is how it looks on the question
// slide for an intermission round.
export default function ImageCropEditor({ file, onClose, onSaved, preview }) {
  const [img, setImg] = useState(null);          // HTMLImageElement
  const [disp, setDisp] = useState({ w: 0, h: 0 }); // displayed image size
  const [crop, setCrop] = useState(null);        // { x, y, w, h } in display px
  const [aspectKey, setAspectKey] = useState('1:1');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const wrapRef = useRef(null);
  const previewRef = useRef(null);
  const dragRef = useRef(null); // { mode, startX, startY, orig }

  const previewNumber = preview?.number || 1;
  const previewColumns = preview?.columns || 5;

  const aspect = PRESETS.find(p => p.key === aspectKey)?.ratio ?? null;

  // Build a centred crop box of the given ratio that fits inside the image.
  const centeredCrop = useCallback((dw, dh, ratio) => {
    if (!ratio) {
      const w = dw * 0.8, h = dh * 0.8;
      return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
    }
    let w = dw, h = w / ratio;
    if (h > dh) { h = dh; w = h * ratio; }
    w *= 0.9; h *= 0.9;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
  }, []);

  // Load the image and fit it into the stage
  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const scale = Math.min(STAGE_W / image.naturalWidth, STAGE_H / image.naturalHeight, 1);
      const w = Math.round(image.naturalWidth * scale);
      const h = Math.round(image.naturalHeight * scale);
      setImg(image);
      setDisp({ w, h });
      setCrop(centeredCrop(w, h, aspect));
    };
    image.onerror = () => setError('Could not load this image.');
    image.src = file.url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.url]);

  // Reset the box when the preset changes
  useEffect(() => {
    if (disp.w) setCrop(centeredCrop(disp.w, disp.h, aspect));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectKey]);

  // Draw the crop into a square grid cell the way the slideshow does it
  // (object-fit: cover, centred).
  useEffect(() => {
    if (!preview || !img || !crop) return;
    const canvas = previewRef.current;
    let ctx;
    try { ctx = canvas?.getContext?.('2d'); } catch { return; } // jsdom has no canvas
    if (!ctx) return;
    const T = canvas.clientWidth || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = T * dpr;
    canvas.height = T * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, T, T);

    const sx = crop.x * (img.naturalWidth / disp.w);
    const sy = crop.y * (img.naturalHeight / disp.h);
    const sw = crop.w * (img.naturalWidth / disp.w);
    const sh = crop.h * (img.naturalHeight / disp.h);
    const scale = Math.max(T / sw, T / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(img, sx, sy, sw, sh, (T - dw) / 2, (T - dh) / 2, dw, dh);
  }, [preview, img, crop, disp]);

  const clampBox = useCallback((box) => {
    let { x, y, w, h } = box;
    w = Math.max(MIN_CROP, Math.min(w, disp.w));
    h = Math.max(MIN_CROP, Math.min(h, disp.h));
    x = Math.max(0, Math.min(x, disp.w - w));
    y = Math.max(0, Math.min(y, disp.h - h));
    return { x, y, w, h };
  }, [disp]);

  const onPointerDown = (mode) => (e) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: { ...crop } };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      setCrop(clampBox({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }));
    } else {
      setCrop(resizeRect(d.orig, d.mode, dx, dy, { aspect, bounds: disp }));
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  async function save() {
    if (!img || !crop) return;
    setSaving(true); setError(null);
    try {
      const sx = img.naturalWidth / disp.w;
      const sy = img.naturalHeight / disp.h;
      const cw = Math.round(crop.w * sx);
      const ch = Math.round(crop.h * sy);
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, crop.x * sx, crop.y * sy, cw, ch, 0, 0, cw, ch);

      const isJpeg = (file.mime_type || '').includes('jpeg') || /\.jpe?g$/i.test(file.filename || '');
      const type = isJpeg ? 'image/jpeg' : 'image/png';
      const ext = isJpeg ? 'jpg' : 'png';
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
      if (!blob) throw new Error('Could not render the crop.');
      const base = (file.original_name || file.filename || 'image').replace(/\.[^.]+$/, '');
      const suggested = preview ? `${base}-clue` : `${base}-${aspectKey}`;
      const name = window.prompt('Save the cropped image as (name shown in the Media Library):', suggested);
      if (name === null) { setSaving(false); return; } // cancelled
      const newFile = new File([blob], `${suggested}.${ext}`, { type });
      const fd = new FormData();
      fd.append('file', newFile);
      fd.append('display_name', name.trim() || suggested);
      if (file.folder) fd.append('folder', file.folder);
      const res = await fetch('/api/upload/media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('qm_admin_token')}` },
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      // A clue crop can name the answer after the source picture, and keeps
      // the full picture for the answer reveal.
      onSaved?.(data, preview ? { answerName: clueAnswerName(file), sourceUrl: file.url } : undefined);
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{preview ? '✂ Clue close-up' : '✂ Crop / resize'} — {file.original_name || file.filename}</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

          <div className="ic-presets">
            {PRESETS.map(p => (
              <button key={p.key} type="button"
                className={`btn btn-sm ${aspectKey === p.key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAspectKey(p.key)}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="ic-stage" style={{ width: disp.w || STAGE_W, height: disp.h || STAGE_H }} ref={wrapRef}>
            {img && <img src={file.url} alt="" width={disp.w} height={disp.h} draggable={false} />}
            {crop && (
              <div className="ic-crop" style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                   onPointerDown={onPointerDown('move')}>
                {['nw', 'ne', 'sw', 'se'].map(pos => (
                  <span key={pos} className={`ic-handle ic-handle-${pos}`}
                        onPointerDown={onPointerDown(pos)} />
                ))}
              </div>
            )}
          </div>
          {crop && img && (
            <p className="help-text">
              Output: {Math.round(crop.w * img.naturalWidth / disp.w)} × {Math.round(crop.h * img.naturalHeight / disp.h)} px
            </p>
          )}

          {preview && (
            <div className="ic-preview">
              <p className="ic-preview-label">Question slide preview — picture-round cell</p>
              <div className="ic-preview-cell" data-testid="crop-slide-preview">
                <canvas ref={previewRef} width="220" height="220" data-testid="crop-preview-canvas" />
                <span className="ic-preview-num">{previewNumber}</span>
                {!img && <span className="ic-preview-empty">Select a crop</span>}
              </div>
              <p className="help-text">
                Shown with the same square cover-fit as the {previewColumns}-column picture grid on the slideshow.
              </p>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={save} disabled={!img || saving}>
            {saving ? 'Saving…' : '💾 Save as new file'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
