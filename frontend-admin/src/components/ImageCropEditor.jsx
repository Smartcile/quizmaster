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

// In-browser image cropper/resizer. Pick an aspect preset (or free), drag the
// box to move / drag the corner to resize, then export the crop at full source
// resolution and upload as a NEW media file (the original is kept).
export default function ImageCropEditor({ file, onClose, onSaved }) {
  const [img, setImg] = useState(null);          // HTMLImageElement
  const [disp, setDisp] = useState({ w: 0, h: 0 }); // displayed image size
  const [crop, setCrop] = useState(null);        // { x, y, w, h } in display px
  const [aspectKey, setAspectKey] = useState('1:1');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const wrapRef = useRef(null);
  const dragRef = useRef(null); // { mode, startX, startY, orig }

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

  const clampBox = useCallback((box) => {
    let { x, y, w, h } = box;
    w = Math.max(20, Math.min(w, disp.w));
    h = Math.max(20, Math.min(h, disp.h));
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
      let w = d.orig.w + dx;
      let h = aspect ? w / aspect : d.orig.h + dy;
      if (aspect) {
        // keep within bounds
        if (d.orig.x + w > disp.w) { w = disp.w - d.orig.x; h = w / aspect; }
        if (d.orig.y + h > disp.h) { h = disp.h - d.orig.y; w = h * aspect; }
      }
      setCrop(clampBox({ x: d.orig.x, y: d.orig.y, w, h }));
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
      const newFile = new File([blob], `${base}-${aspectKey}.${ext}`, { type });
      const fd = new FormData();
      fd.append('file', newFile);
      const res = await fetch('/api/upload/media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('qm_admin_token')}` },
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      onSaved?.(data);
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
          <h3>✂ Crop / resize — {file.original_name || file.filename}</h3>
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
                <span className="ic-handle" onPointerDown={onPointerDown('resize')} />
              </div>
            )}
          </div>
          {crop && img && (
            <p className="help-text">
              Output: {Math.round(crop.w * img.naturalWidth / disp.w)} × {Math.round(crop.h * img.naturalHeight / disp.h)} px
            </p>
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
