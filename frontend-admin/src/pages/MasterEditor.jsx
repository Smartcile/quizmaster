import { useState, useEffect, useRef, useCallback } from 'react';
import { fabric } from 'fabric';
import { api } from '../services/api';
import ImagePicker from '../components/ImagePicker';
import { applyAutoShrink } from '../utils/autoShrink';

// Canvas dimensions — identical to SlideEditor so coordinates are compatible.
const CANVAS_W = 960;
const CANVAS_H = 540;
// Master placeholder coordinates are stored in 1920×1080 space; scale by 0.5 to canvas.
const MASTER_SCALE = CANVAS_W / 1920;

const ROLE_OPTIONS = ['title', 'question', 'answer', 'body', 'decoration'];

const FONT_FAMILIES = [
  { label: 'Inter (sans-serif)',    value: 'Inter, sans-serif' },
  { label: 'Arial',                 value: 'Arial, sans-serif' },
  { label: 'Georgia (serif)',       value: 'Georgia, serif' },
  { label: 'Courier New (mono)',    value: "'Courier New', monospace" },
  { label: 'Oswald',                value: 'Oswald, sans-serif' },
];

// Neon colour per role — fill + stroke for canvas placeholder boxes.
const ROLE_COLORS = {
  title:      { fill: 'rgba(0,240,255,0.07)',   stroke: 'rgba(0,240,255,0.7)' },
  question:   { fill: 'rgba(184,41,255,0.07)',  stroke: 'rgba(184,41,255,0.7)' },
  answer:     { fill: 'rgba(255,230,0,0.07)',   stroke: 'rgba(255,230,0,0.7)' },
  body:       { fill: 'rgba(0,255,159,0.07)',   stroke: 'rgba(0,255,159,0.7)' },
  decoration: { fill: 'rgba(255,56,104,0.07)',  stroke: 'rgba(255,56,104,0.7)' },
};
const roleColors = (role) => ROLE_COLORS[role] || ROLE_COLORS.decoration;

function mkDefaultStyle() {
  return { fontFamily: 'Inter, sans-serif', fontSize: 32, color: '#e8efff', fontWeight: 'normal' };
}
function mkDefaultStyles() {
  return {
    title:    { fontFamily: 'Inter, sans-serif', fontSize: 64, color: '#00f0ff', fontWeight: 'bold' },
    body:     { fontFamily: 'Inter, sans-serif', fontSize: 32, color: '#e8efff', fontWeight: 'normal' },
    question: { fontFamily: 'Inter, sans-serif', fontSize: 40, color: '#e8efff', fontWeight: 'normal' },
    answer:   { fontFamily: 'Inter, sans-serif', fontSize: 48, color: '#ffe600', fontWeight: 'bold' },
  };
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function buildPhRect(ph) {
  const S = MASTER_SCALE;
  const c = roleColors(ph.role);
  return new fabric.Rect({
    left:   ph.x * S,
    top:    ph.y * S,
    width:  ph.width * S,
    height: ph.height * S,
    fill:   c.fill,
    stroke: c.stroke,
    strokeWidth:    1.5,
    strokeDashArray:[8, 4],
    rx: 4, ry: 4,
    selectable: true,
    evented:    true,
    hasControls:true,
    isPlaceholder: true,
    phId:       ph.id,
    phStyleName:ph.styleName,
    phRole:     ph.role,
  });
}

function buildPhLabel(ph, styleDef) {
  const S = MASTER_SCALE;
  const fs = styleDef?.fontSize ? ` ${styleDef.fontSize}px` : '';
  return new fabric.Text(`${ph.role.toUpperCase()}${fs}`, {
    left:       ph.x * S + 8,
    top:        ph.y * S + 6,
    fontSize:   10,
    fill:       roleColors(ph.role).stroke,
    fontFamily: 'monospace',
    selectable: false,
    evented:    false,
    isPhLabel:  true,
    phId:       ph.id,
  });
}

// Renders the full master+slide composite onto a Fabric canvas (preview).
function renderPreviewCanvas(canvas, masterData, slideContent) {
  canvas.clear();
  const S = MASTER_SCALE;

  if (masterData.background_image_url) {
    fabric.Image.fromURL(masterData.background_image_url, img => {
      img.set({
        left: 0, top: 0,
        scaleX: CANVAS_W / img.width,
        scaleY: CANVAS_H / img.height,
        selectable: false, evented: false,
      });
      canvas.add(img);
      canvas.sendToBack(img);
      canvas.requestRenderAll();
    }, { crossOrigin: 'anonymous' });
  } else {
    canvas.add(new fabric.Rect({
      left: 0, top: 0, width: CANVAS_W, height: CANVAS_H,
      fill: masterData.background_color || '#0a0e1f',
      selectable: false, evented: false,
    }));
  }

  for (const ph of (masterData.placeholders || [])) {
    const styleDef = masterData.styles?.[ph.styleName] || {};
    const c = roleColors(ph.role);
    canvas.add(new fabric.Rect({
      left: ph.x * S, top: ph.y * S,
      width: ph.width * S, height: ph.height * S,
      fill: c.fill, stroke: c.stroke,
      strokeWidth: 1, strokeDashArray: [8, 4],
      rx: 4, ry: 4,
      selectable: false, evented: false,
    }));
    canvas.add(new fabric.Text(
      `${ph.role.toUpperCase()}${styleDef.fontSize ? ` ${styleDef.fontSize}px` : ''}`,
      {
        left: ph.x * S + 8, top: ph.y * S + 6,
        fontSize: 11,
        fill: c.stroke,
        fontFamily: 'monospace',
        selectable: false, evented: false,
      }
    ));
  }

  if (slideContent?.length) {
    fabric.util.enlivenObjects(slideContent, objects => {
      objects.forEach(obj => {
        obj.set({ selectable: false, evented: false });
        canvas.add(obj);
        if (obj.type === 'textbox' && obj.autoShrink) applyAutoShrink(obj);
      });
      canvas.requestRenderAll();
    }, 'fabric');
  }

  canvas.requestRenderAll();
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MasterEditor() {
  const [view, setView]       = useState('list');  // 'list' | 'edit'
  const [masters, setMasters] = useState([]);
  const [editMaster, setEditMaster] = useState(null);
  const [linkedSlide, setLinkedSlide] = useState(null); // slide for live preview

  // Edit-mode form state
  const [masterName, setMasterName]   = useState('');
  const [bgColor, setBgColor]         = useState('#0a0e1f');
  const [bgImageUrl, setBgImageUrl]   = useState('');
  const [styles, setStyles]           = useState(mkDefaultStyles());

  // Selected placeholder panel
  const [selPh, setSelPh] = useState(null); // { phId, role, styleName, x, y, w, h }

  const [showPicker, setShowPicker]   = useState(false);
  const [pickerTarget, setPickerTarget] = useState(null); // 'bg'
  const [saving, setSaving]           = useState(false);
  const [flashMsg, setFlashMsg]       = useState(null);
  const [canvasVersion, setCanvasVersion] = useState(0);

  // Canvas refs
  const canvasRef     = useRef(null);
  const fabricRef     = useRef(null);
  const bgObjRef      = useRef(null);
  const phLabels      = useRef(new Map()); // phId → fabric.Text label

  const previewCanvasRef = useRef(null);
  const previewFabricRef = useRef(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/masters').then(setMasters).catch(console.error);
  }, []);

  // ── Open master for editing ───────────────────────────────────────────────
  const openMaster = async (master) => {
    try {
      const slides = await api.get(`/slides?master_id=${master.id}`);
      setLinkedSlide(slides[0] || null);
    } catch {
      setLinkedSlide(null);
    }
    setEditMaster(master);
    setMasterName(master.name);
    setBgColor(master.background_color || '#0a0e1f');
    setBgImageUrl(master.background_image_url || '');
    setStyles({ ...mkDefaultStyles(), ...(master.styles || {}) });
    setSelPh(null);
    setCanvasVersion(0);
    setView('edit');
  };

  // ── Placeholder editor canvas init ────────────────────────────────────────
  useEffect(() => {
    if (view !== 'edit' || !editMaster || !canvasRef.current) return;

    if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null; }
    bgObjRef.current = null;
    phLabels.current = new Map();

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: CANVAS_W, height: CANVAS_H,
      backgroundColor: '#111',
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Background
    const initUrl = editMaster.background_image_url || '';
    if (initUrl) {
      fabric.Image.fromURL(initUrl, img => {
        img.set({
          left: 0, top: 0,
          scaleX: CANVAS_W / img.width, scaleY: CANVAS_H / img.height,
          selectable: false, evented: false, isBgLayer: true,
        });
        canvas.add(img); canvas.sendToBack(img);
        bgObjRef.current = img; canvas.requestRenderAll();
      }, { crossOrigin: 'anonymous' });
    } else {
      const bg = new fabric.Rect({
        left: 0, top: 0, width: CANVAS_W, height: CANVAS_H,
        fill: editMaster.background_color || '#0a0e1f',
        selectable: false, evented: false, isBgLayer: true,
      });
      canvas.add(bg); canvas.sendToBack(bg); bgObjRef.current = bg;
    }

    // Placeholder rects + labels
    const initStyles = { ...mkDefaultStyles(), ...(editMaster.styles || {}) };
    for (const ph of (editMaster.placeholders || [])) {
      const rect  = buildPhRect(ph);
      const label = buildPhLabel(ph, initStyles[ph.styleName]);
      canvas.add(rect); canvas.add(label);
      phLabels.current.set(ph.id, label);
    }

    // Events
    const syncSel = (obj) => {
      if (!obj?.isPlaceholder) { setSelPh(null); return; }
      const S = MASTER_SCALE;
      setSelPh({
        phId:      obj.phId,
        role:      obj.phRole,
        styleName: obj.phStyleName,
        x: Math.round(obj.left / S),
        y: Math.round(obj.top  / S),
        w: Math.round(obj.width / S),
        h: Math.round(obj.height / S),
      });
    };

    canvas.on('selection:created', e => syncSel(e.selected?.[0]));
    canvas.on('selection:updated', e => syncSel(e.selected?.[0]));
    canvas.on('selection:cleared', () => setSelPh(null));

    canvas.on('object:moving', e => {
      const obj = e.target;
      if (!obj.isPlaceholder) return;
      const lbl = phLabels.current.get(obj.phId);
      if (lbl) lbl.set({ left: obj.left + 8, top: obj.top + 6 });
    });

    canvas.on('object:modified', e => {
      const obj = e.target;
      if (!obj.isPlaceholder) return;
      // Flatten scale → width/height so positions stay in pixel coords.
      const w = Math.round(obj.width  * obj.scaleX);
      const h = Math.round(obj.height * obj.scaleY);
      obj.set({ width: w, height: h, scaleX: 1, scaleY: 1 });
      obj.setCoords();
      const lbl = phLabels.current.get(obj.phId);
      if (lbl) lbl.set({ left: obj.left + 8, top: obj.top + 6 });
      syncSel(obj);
      setCanvasVersion(v => v + 1);
      canvas.requestRenderAll();
    });

    canvas.requestRenderAll();

    return () => { canvas.dispose(); fabricRef.current = null; bgObjRef.current = null; };
  }, [editMaster?.id, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Preview canvas init ───────────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'edit' || !previewCanvasRef.current) return;
    if (previewFabricRef.current) { previewFabricRef.current.dispose(); previewFabricRef.current = null; }
    const canvas = new fabric.Canvas(previewCanvasRef.current, {
      width: CANVAS_W, height: CANVAS_H,
      backgroundColor: '#111',
      selection: false,
    });
    previewFabricRef.current = canvas;
    return () => { canvas.dispose(); previewFabricRef.current = null; };
  }, [view, editMaster?.id]);

  // ── Build current master object from form + canvas ────────────────────────
  const buildCurrentMasterData = useCallback(() => {
    const canvas = fabricRef.current;
    const phs = [];
    if (canvas) {
      canvas.getObjects()
        .filter(o => o.isPlaceholder)
        .forEach(obj => {
          const S = MASTER_SCALE;
          phs.push({
            id:        obj.phId,
            x:         Math.round(obj.left   / S),
            y:         Math.round(obj.top    / S),
            width:     Math.round(obj.width  / S),
            height:    Math.round(obj.height / S),
            styleName: obj.phStyleName,
            role:      obj.phRole,
          });
        });
    }
    return { background_color: bgColor, background_image_url: bgImageUrl || null, styles, placeholders: phs };
  }, [bgColor, bgImageUrl, styles]);

  // ── Live preview: re-render whenever master content or slide changes ───────
  useEffect(() => {
    const canvas = previewFabricRef.current;
    if (!canvas || view !== 'edit') return;
    renderPreviewCanvas(canvas, buildCurrentMasterData(), linkedSlide?.content);
  }, [buildCurrentMasterData, canvasVersion, linkedSlide, view]);

  // ── Sync background color change → edit canvas ───────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || view !== 'edit' || bgImageUrl) return;
    if (bgObjRef.current?.type === 'rect') {
      bgObjRef.current.set('fill', bgColor);
      canvas.requestRenderAll();
    }
  }, [bgColor, bgImageUrl, view]);

  // ── Sync background image change → edit canvas ───────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || view !== 'edit') return;
    if (bgObjRef.current) { canvas.remove(bgObjRef.current); bgObjRef.current = null; }

    if (bgImageUrl) {
      fabric.Image.fromURL(bgImageUrl, img => {
        img.set({
          left: 0, top: 0,
          scaleX: CANVAS_W / img.width, scaleY: CANVAS_H / img.height,
          selectable: false, evented: false, isBgLayer: true,
        });
        canvas.add(img); canvas.sendToBack(img);
        bgObjRef.current = img; canvas.requestRenderAll();
      }, { crossOrigin: 'anonymous' });
    } else {
      const bg = new fabric.Rect({
        left: 0, top: 0, width: CANVAS_W, height: CANVAS_H,
        fill: bgColor, selectable: false, evented: false, isBgLayer: true,
      });
      canvas.add(bg); canvas.sendToBack(bg);
      bgObjRef.current = bg; canvas.requestRenderAll();
    }
  }, [bgImageUrl, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!editMaster) return;
    setSaving(true);
    try {
      const payload = { name: masterName, ...buildCurrentMasterData() };
      const updated = await api.put(`/masters/${editMaster.id}`, payload);
      setEditMaster(updated);
      setMasters(prev => prev.map(m => m.id === updated.id ? updated : m));
      // Re-fetch linked slide to prove cascade: slide content is untouched,
      // but the preview now composites with the freshly saved master.
      if (linkedSlide) {
        const fresh = await api.get(`/slides/${linkedSlide.id}`);
        setLinkedSlide(fresh); // triggers preview re-render via useEffect
      }
      flash('ok', 'Saved — preview updated to show cascade.');
    } catch (err) {
      flash('err', 'Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }, [editMaster, masterName, buildCurrentMasterData, linkedSlide]);

  // ── Create new master ─────────────────────────────────────────────────────
  const createMaster = async () => {
    try {
      const m = await api.post('/masters', {
        name: 'New Master',
        background_color: '#0a0e1f',
        styles: mkDefaultStyles(),
        placeholders: [
          { id: 'ph-title',  x: 80, y: 60,  width: 1760, height: 120, styleName: 'title',    role: 'title' },
          { id: 'ph-body',   x: 80, y: 240, width: 1760, height: 480, styleName: 'question', role: 'question' },
          { id: 'ph-answer', x: 80, y: 780, width: 1760, height: 200, styleName: 'answer',   role: 'answer' },
        ],
      });
      setMasters(prev => [m, ...prev]);
      openMaster(m);
    } catch (err) { flash('err', err.message); }
  };

  const duplicateMaster = async (id) => {
    try {
      const m = await api.post(`/masters/${id}/duplicate`, {});
      setMasters(prev => [m, ...prev]);
      flash('ok', `Duplicated as "${m.name}"`);
    } catch (err) { flash('err', err.message); }
  };

  // ── Add placeholder ───────────────────────────────────────────────────────
  const addPlaceholder = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const id = `ph-${Date.now()}`;
    const ph = { id, x: 400, y: 400, width: 800, height: 200, styleName: 'body', role: 'body' };
    const rect  = buildPhRect(ph);
    const label = buildPhLabel(ph, styles.body || mkDefaultStyle());
    canvas.add(rect); canvas.add(label);
    phLabels.current.set(id, label);
    canvas.setActiveObject(rect);
    const S = MASTER_SCALE;
    setSelPh({ phId: id, role: 'body', styleName: 'body',
      x: ph.x, y: ph.y, w: ph.width, h: ph.height });
    setCanvasVersion(v => v + 1);
    canvas.requestRenderAll();
  };

  // ── Remove selected placeholder ───────────────────────────────────────────
  const removeSelPh = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !selPh) return;
    const obj = canvas.getObjects().find(o => o.isPlaceholder && o.phId === selPh.phId);
    if (obj) canvas.remove(obj);
    const lbl = phLabels.current.get(selPh.phId);
    if (lbl) canvas.remove(lbl);
    phLabels.current.delete(selPh.phId);
    canvas.discardActiveObject();
    setSelPh(null);
    setCanvasVersion(v => v + 1);
    canvas.requestRenderAll();
  }, [selPh]);

  // ── Update selected placeholder via right panel ───────────────────────────
  const updateSelPh = (prop, value) => {
    const canvas = fabricRef.current;
    if (!canvas || !selPh) return;
    const obj = canvas.getObjects().find(o => o.isPlaceholder && o.phId === selPh.phId);
    if (!obj) return;
    const S = MASTER_SCALE;
    const lbl = phLabels.current.get(selPh.phId);

    if (prop === 'role') {
      obj.phRole = value;
      const c = roleColors(value);
      obj.set({ fill: c.fill, stroke: c.stroke });
      if (lbl) {
        const fs = (styles[obj.phStyleName] || {}).fontSize;
        lbl.set({ text: `${value.toUpperCase()}${fs ? ` ${fs}px` : ''}`, fill: c.stroke });
      }
      setSelPh(prev => ({ ...prev, role: value }));
    } else if (prop === 'styleName') {
      obj.phStyleName = value;
      if (lbl) {
        const fs = (styles[value] || {}).fontSize;
        lbl.set({ text: `${obj.phRole.toUpperCase()}${fs ? ` ${fs}px` : ''}` });
      }
      setSelPh(prev => ({ ...prev, styleName: value }));
    } else {
      const v = Math.max(1, parseInt(value) || 0);
      if (prop === 'x') obj.set('left',   v * S);
      if (prop === 'y') obj.set('top',    v * S);
      if (prop === 'w') obj.set('width',  v * S);
      if (prop === 'h') obj.set('height', v * S);
      obj.setCoords();
      if (lbl) lbl.set({ left: obj.left + 8, top: obj.top + 6 });
      setSelPh(prev => ({ ...prev, [prop]: v }));
    }
    setCanvasVersion(v => v + 1);
    canvas.requestRenderAll();
  };

  // ── Update style entry ────────────────────────────────────────────────────
  const updateStyle = (styleName, prop, raw) => {
    const value = prop === 'fontSize' ? (parseInt(raw) || 16) : raw;
    setStyles(prev => ({
      ...prev,
      [styleName]: { ...(prev[styleName] || mkDefaultStyle()), [prop]: value },
    }));
    // Immediately update canvas labels that reference this style.
    const canvas = fabricRef.current;
    if (canvas) {
      canvas.getObjects()
        .filter(o => o.isPlaceholder && o.phStyleName === styleName)
        .forEach(obj => {
          const lbl = phLabels.current.get(obj.phId);
          if (lbl) {
            const curStyle = styles[styleName] || mkDefaultStyle();
            const fs = prop === 'fontSize' ? value : curStyle.fontSize;
            lbl.set({ text: `${obj.phRole.toUpperCase()}${fs ? ` ${fs}px` : ''}` });
          }
        });
      canvas.requestRenderAll();
    }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'edit') return;
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selPh) {
        if (fabricRef.current?.getActiveObject()?.isPlaceholder) removeSelPh();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, handleSave, selPh, removeSelPh]);

  const flash = (type, text) => {
    setFlashMsg({ type, text });
    setTimeout(() => setFlashMsg(null), 3500);
  };

  // ── List view ─────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="me-page">
        {flashMsg && (
          <div className={`se-flash se-flash-${flashMsg.type}`} onClick={() => setFlashMsg(null)}>
            {flashMsg.text}
          </div>
        )}
        <div className="me-list-header">
          <h2>Slide Masters</h2>
          <button className="btn btn-primary" onClick={createMaster}>+ New master</button>
        </div>
        {masters.length === 0 && (
          <p className="se-empty" style={{ marginTop: 32 }}>No masters yet. Create one to get started.</p>
        )}
        <div className="me-master-grid">
          {masters.map(m => (
            <div key={m.id} className="me-master-card">
              <div className="me-card-thumb" style={{ background: m.background_color || '#0a0e1f' }}>
                <div className="me-card-phs">
                  {(m.placeholders || []).slice(0, 5).map(ph => (
                    <div key={ph.id} className="me-card-ph-chip"
                      style={{ borderColor: (ROLE_COLORS[ph.role] || ROLE_COLORS.decoration).stroke }}>
                      {ph.role}
                    </div>
                  ))}
                </div>
              </div>
              <div className="me-card-body">
                <h4>{m.name}</h4>
                <p className="me-card-meta">
                  {Object.keys(m.styles || {}).join(' · ') || 'No styles'}
                </p>
              </div>
              <div className="me-card-actions">
                <button className="btn btn-primary btn-sm" onClick={() => openMaster(m)}>Edit</button>
                <button className="btn btn-secondary btn-sm" onClick={() => duplicateMaster(m.id)}>Duplicate</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Edit view ─────────────────────────────────────────────────────────────
  const styleEntries = Object.entries(styles);
  const availableStyleNames = ['title', 'body', 'question', 'answer', 'subtitle', 'caption']
    .filter(n => !styles[n]);

  return (
    <div className="me-page me-edit-layout">
      {flashMsg && (
        <div className={`se-flash se-flash-${flashMsg.type}`} onClick={() => setFlashMsg(null)}>
          {flashMsg.text}
        </div>
      )}

      {/* ── Left sidebar: meta + background + text styles ── */}
      <aside className="me-sidebar">
        <button className="me-back-btn" onClick={() => { setView('list'); setEditMaster(null); }}>
          ← Masters
        </button>

        {/* Name */}
        <div className="me-section">
          <h4 className="me-section-title">Name</h4>
          <input className="me-input" value={masterName}
            onChange={e => setMasterName(e.target.value)} placeholder="Master name" />
        </div>

        {/* Background */}
        <div className="me-section">
          <h4 className="me-section-title">Background</h4>
          <div className="me-bg-row">
            <input type="color" value={bgColor}
              onChange={e => { setBgColor(e.target.value); setBgImageUrl(''); }}
              title="Background colour" className="me-color-swatch" />
            <span className="me-bg-label">{bgImageUrl ? '(image)' : bgColor}</span>
            <button className="btn btn-secondary btn-xs"
              onClick={() => { setPickerTarget('bg'); setShowPicker(true); }}>🖼</button>
            {bgImageUrl && (
              <button className="btn btn-secondary btn-xs" title="Clear image"
                onClick={() => setBgImageUrl('')}>✕</button>
            )}
          </div>
          {bgImageUrl && (
            <img src={bgImageUrl} alt="bg preview"
              className="me-bg-preview" onError={e => { e.target.style.display = 'none'; }} />
          )}
        </div>

        {/* Text styles */}
        <div className="me-section">
          <h4 className="me-section-title">Text Styles</h4>
          {styleEntries.map(([name, s]) => (
            <div key={name} className="me-style-entry">
              <div className="me-style-header">
                <span className="me-style-name"
                  style={{ color: s.color || '#e8efff' }}>{name}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span className="me-style-preview"
                    style={{ fontWeight: s.fontWeight, color: s.color, fontSize: 11 }}>
                    {s.fontSize}px
                  </span>
                  {!['title','body','question','answer'].includes(name) && (
                    <button className="me-icon-btn"
                      onClick={() => setStyles(prev => { const n = { ...prev }; delete n[name]; return n; })}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="me-style-props">
                <label className="me-sp-label">
                  <span>Family</span>
                  <select value={s.fontFamily || 'Inter, sans-serif'}
                    onChange={e => updateStyle(name, 'fontFamily', e.target.value)}>
                    {FONT_FAMILIES.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </label>
                <div className="me-sp-row">
                  <label className="me-sp-label">
                    <span>Size</span>
                    <input type="number" min={8} max={200} value={s.fontSize || 32}
                      onChange={e => updateStyle(name, 'fontSize', e.target.value)} />
                  </label>
                  <label className="me-sp-label">
                    <span>Colour</span>
                    <input type="color" value={s.color || '#ffffff'}
                      onChange={e => updateStyle(name, 'color', e.target.value)}
                      className="me-color-swatch" />
                  </label>
                  <label className="me-sp-label me-sp-bold">
                    <input type="checkbox" checked={s.fontWeight === 'bold'}
                      onChange={e => updateStyle(name, 'fontWeight', e.target.checked ? 'bold' : 'normal')} />
                    <span>Bold</span>
                  </label>
                </div>
              </div>
            </div>
          ))}
          {availableStyleNames.length > 0 && (
            <select className="me-add-style-sel"
              value="" onChange={e => {
                if (!e.target.value) return;
                setStyles(prev => ({ ...prev, [e.target.value]: mkDefaultStyle() }));
              }}>
              <option value="">+ Add style…</option>
              {availableStyleNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>

        {/* Save */}
        <div className="me-section">
          <button className="btn btn-primary" style={{ width: '100%' }}
            onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save (Ctrl+S)'}
          </button>
        </div>
      </aside>

      {/* ── Center: placeholder canvas + preview ── */}
      <div className="me-center">
        <div className="me-canvas-bar">
          <span className="me-canvas-hint">Drag placeholders · resize with handles · select to edit properties</span>
          <button className="se-tb-btn" onClick={addPlaceholder}>+ Add placeholder</button>
        </div>

        {/* Placeholder editor canvas */}
        <div className="se-canvas-outer" style={{ padding: 16 }}>
          <div className="se-canvas-wrap">
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* Live preview panel */}
        <div className="me-preview-section">
          <div className="me-preview-header">
            <h4>Live preview</h4>
            <span className="me-preview-badge">
              {linkedSlide
                ? `Slide #${linkedSlide.order + 1}${linkedSlide.quiz_name ? ' — ' + linkedSlide.quiz_name : ''}`
                : 'No linked slides — showing master only'}
            </span>
          </div>
          <div className="me-preview-outer">
            <div className="me-preview-inner">
              <canvas ref={previewCanvasRef} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel: placeholder properties ── */}
      <aside className={`me-right-panel${selPh ? ' visible' : ''}`}>
        {selPh ? (
          <>
            <h4 className="me-rp-title">Placeholder</h4>

            <div className="me-section">
              <label className="me-sp-label">
                <span>Role</span>
                <select value={selPh.role}
                  onChange={e => updateSelPh('role', e.target.value)}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="me-sp-label">
                <span>Text style</span>
                <select value={selPh.styleName}
                  onChange={e => updateSelPh('styleName', e.target.value)}>
                  {Object.keys(styles).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>

            <div className="me-section">
              <h5 className="me-rp-sub">Position (1920×1080)</h5>
              <div className="me-xywh">
                {[['x','X'],['y','Y'],['w','W'],['h','H']].map(([prop, label]) => (
                  <label key={prop} className="me-sp-label">
                    <span>{label}</span>
                    <input type="number" min={0} value={selPh[prop]}
                      onChange={e => updateSelPh(prop, e.target.value)} />
                  </label>
                ))}
              </div>
            </div>

            <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }}
              onClick={removeSelPh}>
              ✕ Remove placeholder
            </button>
          </>
        ) : (
          <p className="me-rp-empty">Select a placeholder on the canvas to edit its properties.</p>
        )}
      </aside>

      {showPicker && (
        <ImagePicker
          onPick={url => {
            if (pickerTarget === 'bg') setBgImageUrl(url);
            setShowPicker(false); setPickerTarget(null);
          }}
          onClose={() => { setShowPicker(false); setPickerTarget(null); }}
        />
      )}
    </div>
  );
}
