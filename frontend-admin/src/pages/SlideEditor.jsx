import { useState, useEffect, useRef, useCallback } from 'react';
import { fabric } from 'fabric';
import { api } from '../services/api';
import ImagePicker from '../components/ImagePicker';
import { applyAutoShrink, updateFixedHeight, AUTOSHRINK_PROPS } from '../utils/autoShrink';

// ── Canvas dimensions ────────────────────────────────────────────────────────
// The editor canvas is 960×540 (16:9). Master coordinates are defined in the
// canonical 1920×1080 space, so we scale them by MASTER_SCALE when rendering
// the underlay. Slide content is stored and loaded in editor (960×540) space.
const CANVAS_W = 960;
const CANVAS_H = 540;
const MASTER_SCALE = CANVAS_W / 1920; // 0.5

// Custom props that Fabric must serialise with each object.
const SLIDE_OWNED_PROPS = ['isSlideOwned', ...AUTOSHRINK_PROPS];

// Default master used when creating a new master via the "seed" button.
const DEFAULT_MASTER = {
  name: 'Quiz Night Default',
  background_color: '#0a0e1f',
  styles: {
    title:  { fontFamily: 'Inter, sans-serif', fontSize: 64, color: '#00f0ff', fontWeight: 'bold' },
    body:   { fontFamily: 'Inter, sans-serif', fontSize: 32, color: '#e8efff', fontWeight: 'normal' },
    answer: { fontFamily: 'Inter, sans-serif', fontSize: 40, color: '#ffe600', fontWeight: 'bold' }
  },
  placeholders: [
    { id: 'ph-title',    x: 80,  y: 60,  width: 1760, height: 120, styleName: 'title',  role: 'title' },
    { id: 'ph-body',     x: 80,  y: 240, width: 1760, height: 480, styleName: 'body',   role: 'question' },
    { id: 'ph-answer',   x: 80,  y: 780, width: 1760, height: 200, styleName: 'answer', role: 'answer' }
  ]
};

// ── Master underlay renderer ──────────────────────────────────────────────────
// Renders the master as non-interactive Fabric objects. All objects get
// isMasterLayer=true so the save filter never picks them up.
function renderMasterUnderlay(canvas, master) {
  const S = MASTER_SCALE;

  // Background — colour or image
  if (master.background_image_url) {
    fabric.Image.fromURL(master.background_image_url, img => {
      img.set({
        left: 0, top: 0,
        scaleX: CANVAS_W / img.width,
        scaleY: CANVAS_H / img.height,
        selectable: false, evented: false,
        isMasterLayer: true
      });
      canvas.add(img);
      canvas.sendToBack(img);
      canvas.requestRenderAll();
    }, { crossOrigin: 'anonymous' });
  } else {
    canvas.add(new fabric.Rect({
      left: 0, top: 0, width: CANVAS_W, height: CANVAS_H,
      fill: master.background_color || '#0a0e1f',
      selectable: false, evented: false, isMasterLayer: true
    }));
  }

  // Placeholder boxes with dashed borders + role labels
  for (const ph of (master.placeholders || [])) {
    const style = master.styles?.[ph.styleName] || {};

    canvas.add(new fabric.Rect({
      left: ph.x * S,   top: ph.y * S,
      width: ph.width * S, height: ph.height * S,
      fill: 'rgba(0,240,255,0.04)',
      stroke: 'rgba(0,240,255,0.35)',
      strokeWidth: 1,
      strokeDashArray: [8, 5],
      rx: 3, ry: 3,
      selectable: false, evented: false, isMasterLayer: true
    }));

    canvas.add(new fabric.Text(
      `${ph.role.toUpperCase()}  ${style.fontSize ? style.fontSize + 'px' : ''}`.trim(),
      {
        left: ph.x * S + 8, top: ph.y * S + 6,
        fontSize: 10, fill: 'rgba(0,240,255,0.55)',
        fontFamily: 'monospace',
        selectable: false, evented: false, isMasterLayer: true
      }
    ));
  }

  canvas.requestRenderAll();
}

// ── Slide content loader ──────────────────────────────────────────────────────
// Restores serialised Fabric objects back onto the canvas.
// Master layers are NEVER in slides.content so nothing isMasterLayer is loaded.
function loadSlideContent(canvas, content) {
  if (!content?.length) return;
  fabric.util.enlivenObjects(
    content,
    objects => {
      objects.forEach(obj => {
        obj.set('isSlideOwned', true);
        canvas.add(obj);
        if (obj.type === 'textbox' && obj.autoShrink) applyAutoShrink(obj);
      });
      canvas.requestRenderAll();
    },
    'fabric'
  );
}

// ── Main page component ───────────────────────────────────────────────────────
export default function SlideEditor() {
  const [quizzes, setQuizzes]         = useState([]);
  const [masters, setMasters]         = useState([]);
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [slides, setSlides]           = useState([]);
  const [activeSlide, setActiveSlide] = useState(null);   // full slide row incl. master
  const [activeMaster, setActiveMaster] = useState(null); // resolved master object

  const [activeObj, setActiveObj]   = useState(null);  // selected Fabric object
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [flashMsg, setFlashMsg]     = useState(null);   // { type: 'ok'|'err', text }

  // Textbox property panel state (mirrors selected object)
  const [fontSize, setFontSize]   = useState(24);
  const [fillColor, setFillColor] = useState('#ffffff');
  const [bold, setBold]           = useState(false);
  const [italic, setItalic]       = useState(false);
  const [autoShrink, setAutoShrink] = useState(true);

  const canvasRef = useRef(null);
  const fabricRef = useRef(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.get('/quizzes'), api.get('/masters')]).then(([qz, ms]) => {
      setQuizzes(qz);
      setMasters(ms);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedQuizId) { setSlides([]); setActiveSlide(null); return; }
    api.get(`/slides?quiz_id=${selectedQuizId}&type=intro,custom`)
      .then(setSlides).catch(console.error);
  }, [selectedQuizId]);

  // ── Canvas init / teardown ────────────────────────────────────────────────
  // Re-runs only when the slide ID or master ID changes. The cleanup disposes
  // the previous Fabric instance so there is never a leaked canvas.
  useEffect(() => {
    if (!activeSlide || !canvasRef.current) return;

    if (fabricRef.current) {
      fabricRef.current.dispose();
      fabricRef.current = null;
    }

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: CANVAS_W, height: CANVAS_H,
      backgroundColor: '#111827',
      preserveObjectStacking: true,
      selection: true
    });
    fabricRef.current = canvas;

    // ── Event wiring ─────────────────────────────────────────────────────
    const syncProps = obj => {
      if (!obj || obj.type !== 'textbox') return;
      setFontSize(Math.round(obj.fontSize || 24));
      setFillColor(obj.fill || '#ffffff');
      setBold(obj.fontWeight === 'bold');
      setItalic(obj.fontStyle === 'italic');
      setAutoShrink(!!obj.autoShrink);
    };

    canvas.on('selection:created', e => {
      setActiveObj(e.selected?.[0] || null);
      syncProps(e.selected?.[0]);
    });
    canvas.on('selection:updated', e => {
      setActiveObj(e.selected?.[0] || null);
      syncProps(e.selected?.[0]);
    });
    canvas.on('selection:cleared', () => setActiveObj(null));

    // Auto-shrink fires on every keystroke in a textbox
    canvas.on('text:changed', e => {
      if (e.target.autoShrink) applyAutoShrink(e.target);
    });

    // After resize/move, update fixedHeight for textboxes
    canvas.on('object:modified', e => {
      const obj = e.target;
      if (obj?.type === 'textbox' && obj.isSlideOwned) {
        updateFixedHeight(obj);
        syncProps(obj);
      }
    });

    // ── Render layers ─────────────────────────────────────────────────────
    if (activeMaster) renderMasterUnderlay(canvas, activeMaster);
    loadSlideContent(canvas, activeSlide.content);

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [activeSlide?.id, activeMaster?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open a slide ──────────────────────────────────────────────────────────
  const openSlide = async (slide) => {
    try {
      const full = await api.get(`/slides/${slide.id}`);
      setActiveSlide(full);
      setActiveMaster(full.master || null);
      setActiveObj(null);
    } catch (err) {
      flash('err', err.message);
    }
  };

  // ── New slide ─────────────────────────────────────────────────────────────
  const createSlide = async (type) => {
    if (!selectedQuizId) return;
    const master_id = masters[0]?.id || null;
    const order = slides.length;
    try {
      const s = await api.post('/slides', { quiz_id: parseInt(selectedQuizId), master_id, type, order });
      const full = await api.get(`/slides/${s.id}`);
      setSlides(prev => [...prev, full]);
      setActiveSlide(full);
      setActiveMaster(full.master || null);
    } catch (err) {
      flash('err', err.message);
    }
  };

  // ── Seed default master ───────────────────────────────────────────────────
  const seedMaster = async () => {
    try {
      const m = await api.post('/masters', DEFAULT_MASTER);
      setMasters(prev => [m, ...prev]);
      flash('ok', `Master "${m.name}" created.`);
    } catch (err) {
      flash('err', err.message);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  // Serialises ONLY slide-owned layers — the master underlay is excluded by
  // the isSlideOwned filter. isMasterLayer objects never appear in this array.
  const handleSave = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || !activeSlide) return;
    setSaving(true);
    try {
      const content = canvas.getObjects()
        .filter(obj => obj.isSlideOwned)
        .map(obj => obj.toObject(SLIDE_OWNED_PROPS));
      await api.put(`/slides/${activeSlide.id}/content`, { content });
      setActiveSlide(prev => ({ ...prev, content }));
      flash('ok', 'Saved.');
    } catch (err) {
      flash('err', 'Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }, [activeSlide]);

  // ── Keyboard shortcut: Delete ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && fabricRef.current) {
        const obj = fabricRef.current.getActiveObject();
        if (obj && obj.isSlideOwned && obj.type !== 'textbox') {
          fabricRef.current.remove(obj);
          setActiveObj(null);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  // ── Toolbar helpers ───────────────────────────────────────────────────────
  const addTextbox = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const tb = new fabric.Textbox('Type here…', {
      left: 80, top: 80, width: 360,
      fontSize: 24, fontFamily: 'Inter, sans-serif',
      fill: '#ffffff',
      isSlideOwned: true,
      autoShrink: true,
      fixedHeight: 120,
      originalFontSize: 24,
      editable: true
    });
    canvas.add(tb);
    canvas.setActiveObject(tb);
    applyAutoShrink(tb);
    canvas.requestRenderAll();
  };

  const deleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj && obj.isSlideOwned) {
      canvas.remove(obj);
      setActiveObj(null);
    }
  };

  const bringForward = () => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (obj && obj.isSlideOwned) { canvas.bringForward(obj); canvas.requestRenderAll(); }
  };

  const sendBackward = () => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (obj && obj.isSlideOwned) { canvas.sendBackwards(obj); canvas.requestRenderAll(); }
  };

  const addImage = (url) => {
    const canvas = fabricRef.current;
    if (!canvas || !url) return;
    fabric.Image.fromURL(
      url,
      img => {
        // Scale so largest dimension is 200px
        const max = 200;
        const ratio = Math.min(max / img.width, max / img.height, 1);
        img.set({
          left: 200, top: 150,
          scaleX: ratio, scaleY: ratio,
          isSlideOwned: true
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
      },
      { crossOrigin: 'anonymous' }
    );
  };

  // ── Property panel: sync from UI → Fabric ────────────────────────────────
  const applyProp = (prop, value) => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || !obj.isSlideOwned || obj.type !== 'textbox') return;
    obj.set(prop, value);
    if (prop === 'autoShrink') {
      obj.autoShrink = value;
      if (value) {
        obj.originalFontSize = obj.fontSize;
        applyAutoShrink(obj);
      }
    }
    canvas.requestRenderAll();
  };

  const flash = (type, text) => {
    setFlashMsg({ type, text });
    setTimeout(() => setFlashMsg(null), 3000);
  };

  const isTextboxSelected = activeObj?.type === 'textbox' && activeObj?.isSlideOwned;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="se-page">
      {/* ── Left panel: slide list ── */}
      <aside className="se-sidebar">
        <h3>Slide Editor</h3>

        {masters.length === 0 && (
          <div className="se-no-masters">
            <p>No masters found.</p>
            <button className="btn btn-secondary btn-sm" onClick={seedMaster}>
              + Create default master
            </button>
          </div>
        )}

        <label className="form-label" style={{ marginTop: 12 }}>Quiz
          <select value={selectedQuizId} onChange={e => setSelectedQuizId(e.target.value)}>
            <option value="">— select a quiz —</option>
            {quizzes.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        </label>

        {selectedQuizId && (
          <div className="se-new-btns">
            <button className="btn btn-primary btn-sm" onClick={() => createSlide('intro')}>+ Intro slide</button>
            <button className="btn btn-secondary btn-sm" onClick={() => createSlide('custom')}>+ Custom slide</button>
          </div>
        )}

        <div className="se-slide-list">
          {slides.length === 0 && selectedQuizId && (
            <p className="se-empty">No intro/custom slides yet.</p>
          )}
          {slides.map(s => (
            <button
              key={s.id}
              className={`se-slide-item ${activeSlide?.id === s.id ? 'active' : ''}`}
              onClick={() => openSlide(s)}
            >
              <span className={`qm-tag qm-tag-${s.type === 'intro' ? 'text' : 'both'}`}>{s.type}</span>
              <span className="se-slide-label">Slide #{s.order + 1}</span>
              {s.content?.length > 0 && <span className="se-slide-layers">{s.content.length} layer{s.content.length !== 1 ? 's' : ''}</span>}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Right panel: canvas editor ── */}
      <div className="se-editor">
        {flashMsg && (
          <div className={`se-flash se-flash-${flashMsg.type}`} onClick={() => setFlashMsg(null)}>
            {flashMsg.text}
          </div>
        )}

        {!activeSlide ? (
          <div className="se-placeholder">
            <div className="se-placeholder-icon">🎨</div>
            <p>Select or create a slide to start editing</p>
          </div>
        ) : (
          <>
            {/* ── Toolbar ── */}
            <div className="se-toolbar">
              <div className="se-toolbar-group">
                <button className="se-tb-btn" title="Add text box (T)" onClick={addTextbox}>
                  T <span>Text</span>
                </button>
                <button className="se-tb-btn" title="Add image from media library" onClick={() => setShowPicker(true)}>
                  🖼 <span>Image</span>
                </button>
              </div>

              <div className="se-toolbar-group">
                <button className="se-tb-btn" title="Bring forward" onClick={bringForward} disabled={!activeObj?.isSlideOwned}>↑ Fwd</button>
                <button className="se-tb-btn" title="Send backward" onClick={sendBackward} disabled={!activeObj?.isSlideOwned}>↓ Back</button>
                <button className="se-tb-btn se-tb-danger" title="Delete selected (Del)" onClick={deleteSelected} disabled={!activeObj?.isSlideOwned}>✕ Del</button>
              </div>

              {/* Textbox-specific properties */}
              {isTextboxSelected && (
                <div className="se-toolbar-group se-props">
                  <label className="se-prop-label" title="Font size">
                    <span>Size</span>
                    <input
                      type="number" min={6} max={200} value={fontSize}
                      onChange={e => {
                        const v = parseInt(e.target.value) || 24;
                        setFontSize(v);
                        const obj = fabricRef.current?.getActiveObject();
                        if (obj) { obj.originalFontSize = v; applyProp('fontSize', v); }
                      }}
                    />
                  </label>
                  <label className="se-prop-label" title="Text colour">
                    <span>Colour</span>
                    <input
                      type="color" value={fillColor}
                      onChange={e => { setFillColor(e.target.value); applyProp('fill', e.target.value); }}
                    />
                  </label>
                  <button
                    className={`se-tb-btn ${bold ? 'se-tb-active' : ''}`}
                    onClick={() => { const v = !bold; setBold(v); applyProp('fontWeight', v ? 'bold' : 'normal'); }}
                    title="Bold"
                  ><strong>B</strong></button>
                  <button
                    className={`se-tb-btn ${italic ? 'se-tb-active' : ''}`}
                    onClick={() => { const v = !italic; setItalic(v); applyProp('fontStyle', v ? 'italic' : ''); }}
                    title="Italic"
                  ><em>I</em></button>
                  <label className={`se-shrink-toggle ${autoShrink ? 'on' : ''}`} title="Auto-shrink font to fit box">
                    <input
                      type="checkbox" checked={autoShrink}
                      onChange={e => { setAutoShrink(e.target.checked); applyProp('autoShrink', e.target.checked); }}
                    />
                    <span>Auto-shrink</span>
                  </label>
                </div>
              )}

              <div className="se-toolbar-spacer" />

              <div className="se-toolbar-group">
                <span className="se-master-label" title="Active master">
                  {activeMaster ? `⬜ ${activeMaster.name}` : 'No master'}
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSave}
                  disabled={saving}
                  title="Save (Ctrl+S)"
                >
                  {saving ? 'Saving…' : '💾 Save'}
                </button>
              </div>
            </div>

            {/* ── Canvas ── */}
            <div className="se-canvas-outer">
              <div className="se-canvas-wrap">
                <canvas ref={canvasRef} />
              </div>
            </div>
          </>
        )}
      </div>

      {showPicker && (
        <ImagePicker
          onPick={addImage}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
