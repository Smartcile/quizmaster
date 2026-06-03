import { useState, useEffect, useRef, useCallback } from 'react';
import { fabric } from 'fabric';
import { api } from '../services/api';
import ImagePicker from '../components/ImagePicker';

// ── Canvas constants ──────────────────────────────────────────────────────────
const CANVAS_W = 960;
const CANVAS_H = 540;
const MASTER_SCALE = CANVAS_W / 1920; // placeholders stored in 1920×1080 space

const ROLE_OPTIONS = ['title', 'question', 'answer', 'body', 'decoration'];

const FONT_FAMILIES = [
  { label: 'Inter (sans-serif)',   value: 'Inter, sans-serif' },
  { label: 'Arial',                value: 'Arial, sans-serif' },
  { label: 'Georgia (serif)',      value: 'Georgia, serif' },
  { label: 'Courier New (mono)',   value: "'Courier New', monospace" },
  { label: 'Oswald',               value: 'Oswald, sans-serif' },
];

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

// ── Template definitions ──────────────────────────────────────────────────────
const TEMPLATE_TYPES = [
  { key: 'intro',        label: 'Intro Slide',   icon: '🎬' },
  { key: 'round_intro',  label: 'Round Intro',   icon: '🔔' },
  { key: 'mark_answers', label: 'Mark Answers',  icon: '✏' },
  { key: 'end',          label: 'End Slide',     icon: '🏁' },
  { key: 'scoreboard',   label: 'Scoreboard',    icon: '🏆' },
  { key: 'rules',        label: 'Rules',         icon: '📋' },
  { key: 'custom',       label: 'Custom Pages',  icon: '🧩' },
];

const DEFAULT_TMPL = {
  intro:        { title: '', subtitle: '' },
  round_intro:  { label: 'Next Round' },
  mark_answers: { heading: 'Mark Your Answers', subtitle: 'Last chance to submit before answers are revealed.' },
  end:          { title: 'Quiz Complete!', subtitle: 'Thanks for playing.' },
  scoreboard:   { title: 'Leaderboard', bgColor: '#0a0e1f' },
  rules:        { title: 'Rules', body: '1. No phones\n2. No shouting answers\n3. Have fun!', bgColor: '#0a0e1f' },
  custom:       [],
};

// ── Fabric canvas helpers ─────────────────────────────────────────────────────
function buildPhRect(ph) {
  const S = MASTER_SCALE;
  const c = roleColors(ph.role);
  return new fabric.Rect({
    left: ph.x * S, top: ph.y * S,
    width: ph.width * S, height: ph.height * S,
    fill: c.fill, stroke: c.stroke,
    strokeWidth: 1.5, strokeDashArray: [8, 4],
    rx: 4, ry: 4,
    selectable: true, evented: true, hasControls: true,
    isPlaceholder: true,
    phId: ph.id, phStyleName: ph.styleName, phRole: ph.role,
  });
}

function buildPhLabel(ph, styleDef) {
  const S = MASTER_SCALE;
  const fs = styleDef?.fontSize ? ` ${styleDef.fontSize}px` : '';
  return new fabric.Text(`${ph.role.toUpperCase()}${fs}`, {
    left: ph.x * S + 8, top: ph.y * S + 6,
    fontSize: 10, fill: roleColors(ph.role).stroke,
    fontFamily: 'monospace',
    selectable: false, evented: false, isPhLabel: true, phId: ph.id,
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MastersAndSlides() {
  const [view, setView] = useState('list'); // 'list' | 'edit'
  const [masters, setMasters] = useState([]);
  const [editMaster, setEditMaster] = useState(null);
  const [activeSection, setActiveSection] = useState('layout'); // 'layout' | 'templates'
  const [activeTemplateType, setActiveTemplateType] = useState('intro');

  // Layout editor state
  const [masterName, setMasterName] = useState('');
  const [bgColor, setBgColor] = useState('#0a0e1f');
  const [bgImageUrl, setBgImageUrl] = useState('');
  const [styles, setStyles] = useState(mkDefaultStyles());
  const [selPh, setSelPh] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [canvasVersion, setCanvasVersion] = useState(0);

  // Template state
  const [templates, setTemplates] = useState(DEFAULT_TMPL);

  const [saving, setSaving] = useState(false);
  const [flashMsg, setFlashMsg] = useState(null);

  // Canvas refs
  const canvasRef  = useRef(null);
  const fabricRef  = useRef(null);
  const bgObjRef   = useRef(null);
  const phLabels   = useRef(new Map());

  // ── Load masters ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/masters').then(setMasters).catch(console.error);
  }, []);

  // ── Open master for editing ───────────────────────────────────────────────
  const openMaster = (master) => {
    setEditMaster(master);
    setMasterName(master.name);
    setBgColor(master.background_color || '#0a0e1f');
    setBgImageUrl(master.background_image_url || '');
    setStyles({ ...mkDefaultStyles(), ...(master.styles || {}) });
    const saved = master.templates || {};
    setTemplates({
      ...DEFAULT_TMPL,
      ...saved,
      custom: Array.isArray(saved.custom) ? saved.custom : [],
    });
    setSelPh(null);
    setActiveSection('layout');
    setActiveTemplateType('intro');
    setCanvasVersion(0);
    setView('edit');
  };

  // ── Placeholder canvas init ───────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'edit' || activeSection !== 'layout' || !editMaster || !canvasRef.current) return;

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
    if (bgImageUrl) {
      fabric.Image.fromURL(bgImageUrl, img => {
        img.set({ left: 0, top: 0, scaleX: CANVAS_W / img.width, scaleY: CANVAS_H / img.height, selectable: false, evented: false, isBgLayer: true });
        canvas.add(img); canvas.sendToBack(img); bgObjRef.current = img; canvas.requestRenderAll();
      }, { crossOrigin: 'anonymous' });
    } else {
      const bg = new fabric.Rect({
        left: 0, top: 0, width: CANVAS_W, height: CANVAS_H,
        fill: editMaster.background_color || '#0a0e1f',
        selectable: false, evented: false, isBgLayer: true,
      });
      canvas.add(bg); canvas.sendToBack(bg); bgObjRef.current = bg;
    }

    // Placeholders
    const initStyles = { ...mkDefaultStyles(), ...(editMaster.styles || {}) };
    for (const ph of (editMaster.placeholders || [])) {
      const rect  = buildPhRect(ph);
      const label = buildPhLabel(ph, initStyles[ph.styleName]);
      canvas.add(rect); canvas.add(label);
      phLabels.current.set(ph.id, label);
    }

    // Event wiring
    const syncSel = (obj) => {
      if (!obj?.isPlaceholder) { setSelPh(null); return; }
      const S = MASTER_SCALE;
      setSelPh({
        phId: obj.phId, role: obj.phRole, styleName: obj.phStyleName,
        x: Math.round(obj.left / S), y: Math.round(obj.top / S),
        w: Math.round(obj.width / S), h: Math.round(obj.height / S),
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
      const w = Math.round(obj.width  * obj.scaleX);
      const h = Math.round(obj.height * obj.scaleY);
      obj.set({ width: w, height: h, scaleX: 1, scaleY: 1 }); obj.setCoords();
      const lbl = phLabels.current.get(obj.phId);
      if (lbl) lbl.set({ left: obj.left + 8, top: obj.top + 6 });
      syncSel(obj); setCanvasVersion(v => v + 1); canvas.requestRenderAll();
    });
    canvas.requestRenderAll();

    return () => { canvas.dispose(); fabricRef.current = null; bgObjRef.current = null; };
  }, [editMaster?.id, view, activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync background colour → canvas ──────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeSection !== 'layout' || bgImageUrl) return;
    if (bgObjRef.current?.type === 'rect') {
      bgObjRef.current.set('fill', bgColor); canvas.requestRenderAll();
    }
  }, [bgColor, bgImageUrl, activeSection]);

  // ── Sync background image → canvas ───────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeSection !== 'layout') return;
    if (bgObjRef.current) { canvas.remove(bgObjRef.current); bgObjRef.current = null; }
    if (bgImageUrl) {
      fabric.Image.fromURL(bgImageUrl, img => {
        img.set({ left: 0, top: 0, scaleX: CANVAS_W / img.width, scaleY: CANVAS_H / img.height, selectable: false, evented: false, isBgLayer: true });
        canvas.add(img); canvas.sendToBack(img); bgObjRef.current = img; canvas.requestRenderAll();
      }, { crossOrigin: 'anonymous' });
    } else {
      const bg = new fabric.Rect({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, fill: bgColor, selectable: false, evented: false, isBgLayer: true });
      canvas.add(bg); canvas.sendToBack(bg); bgObjRef.current = bg; canvas.requestRenderAll();
    }
  }, [bgImageUrl, activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build master payload from canvas + form ───────────────────────────────
  const buildCurrentMasterData = useCallback(() => {
    const canvas = fabricRef.current;
    const phs = [];
    if (canvas) {
      canvas.getObjects().filter(o => o.isPlaceholder).forEach(obj => {
        const S = MASTER_SCALE;
        phs.push({
          id: obj.phId,
          x: Math.round(obj.left / S), y: Math.round(obj.top / S),
          width: Math.round(obj.width / S), height: Math.round(obj.height / S),
          styleName: obj.phStyleName, role: obj.phRole,
        });
      });
    }
    return { background_color: bgColor, background_image_url: bgImageUrl || null, styles, placeholders: phs };
  }, [bgColor, bgImageUrl, styles]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!editMaster) return;
    setSaving(true);
    try {
      const payload = { name: masterName, ...buildCurrentMasterData(), templates };
      const updated = await api.put(`/masters/${editMaster.id}`, payload);
      setEditMaster(updated);
      setMasters(prev => prev.map(m => m.id === updated.id ? updated : m));
      flash('ok', 'Saved!');
    } catch (err) {
      flash('err', 'Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }, [editMaster, masterName, buildCurrentMasterData, templates]);

  // ── Create new master ─────────────────────────────────────────────────────
  const createMaster = async () => {
    try {
      const m = await api.post('/masters', {
        name: 'New Master',
        background_color: '#0a0e1f',
        styles: mkDefaultStyles(),
        placeholders: [
          { id: 'ph-title',  x: 80, y:  60, width: 1760, height: 120, styleName: 'title',    role: 'title' },
          { id: 'ph-body',   x: 80, y: 240, width: 1760, height: 480, styleName: 'question', role: 'question' },
          { id: 'ph-answer', x: 80, y: 780, width: 1760, height: 200, styleName: 'answer',   role: 'answer' },
        ],
        templates: {},
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

  const deleteMaster = async (m) => {
    if (!confirm(`Delete master "${m.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/masters/${m.id}`);
      setMasters(prev => prev.filter(x => x.id !== m.id));
      flash('ok', `Deleted "${m.name}"`);
    } catch (err) {
      // Backend blocks deletion of an in-use master and names the quizzes.
      flash('err', err.message.replace(/^\d+:\s*/, ''));
    }
  };

  // ── Placeholder canvas actions ────────────────────────────────────────────
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
    setSelPh({ phId: id, role: 'body', styleName: 'body', x: ph.x, y: ph.y, w: ph.width, h: ph.height });
    setCanvasVersion(v => v + 1);
    canvas.requestRenderAll();
  };

  const removeSelPh = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !selPh) return;
    const obj = canvas.getObjects().find(o => o.isPlaceholder && o.phId === selPh.phId);
    if (obj) canvas.remove(obj);
    const lbl = phLabels.current.get(selPh.phId);
    if (lbl) canvas.remove(lbl);
    phLabels.current.delete(selPh.phId);
    canvas.discardActiveObject();
    setSelPh(null); setCanvasVersion(v => v + 1); canvas.requestRenderAll();
  }, [selPh]);

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
      if (lbl) { const fs = (styles[obj.phStyleName] || {}).fontSize; lbl.set({ text: `${value.toUpperCase()}${fs ? ` ${fs}px` : ''}`, fill: c.stroke }); }
      setSelPh(prev => ({ ...prev, role: value }));
    } else if (prop === 'styleName') {
      obj.phStyleName = value;
      if (lbl) { const fs = (styles[value] || {}).fontSize; lbl.set({ text: `${obj.phRole.toUpperCase()}${fs ? ` ${fs}px` : ''}` }); }
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
    setCanvasVersion(v => v + 1); canvas.requestRenderAll();
  };

  const updateStyle = (styleName, prop, raw) => {
    const value = prop === 'fontSize' ? (parseInt(raw) || 16) : raw;
    setStyles(prev => ({ ...prev, [styleName]: { ...(prev[styleName] || mkDefaultStyle()), [prop]: value } }));
    const canvas = fabricRef.current;
    if (canvas) {
      canvas.getObjects().filter(o => o.isPlaceholder && o.phStyleName === styleName).forEach(obj => {
        const lbl = phLabels.current.get(obj.phId);
        if (lbl) { const curStyle = styles[styleName] || mkDefaultStyle(); const fs = prop === 'fontSize' ? value : curStyle.fontSize; lbl.set({ text: `${obj.phRole.toUpperCase()}${fs ? ` ${fs}px` : ''}` }); }
      });
      canvas.requestRenderAll();
    }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'edit') return;
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selPh && activeSection === 'layout') {
        if (fabricRef.current?.getActiveObject()?.isPlaceholder) removeSelPh();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, handleSave, selPh, removeSelPh, activeSection]);

  // ── Template state helpers ────────────────────────────────────────────────
  const setTmpl = (type, key, value) => {
    setTemplates(prev => ({ ...prev, [type]: { ...(prev[type] || {}), [key]: value } }));
  };

  const addCustomPage = () => {
    setTemplates(prev => ({
      ...prev,
      custom: [...(prev.custom || []), {
        id: `cp-${Date.now()}`,
        name: 'New Page',
        title: 'Custom Page',
        body: '',
        imageUrl: '',
        bgColor: '#0a0e1f',
      }],
    }));
  };

  const updateCustomPage = (id, key, value) => {
    setTemplates(prev => ({ ...prev, custom: (prev.custom || []).map(p => p.id === id ? { ...p, [key]: value } : p) }));
  };

  const removeCustomPage = (id) => {
    setTemplates(prev => ({ ...prev, custom: (prev.custom || []).filter(p => p.id !== id) }));
  };

  const flash = (type, text) => { setFlashMsg({ type, text }); setTimeout(() => setFlashMsg(null), 3500); };

  // ── List view ─────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="me-page">
        {flashMsg && <div className={`se-flash se-flash-${flashMsg.type}`} onClick={() => setFlashMsg(null)}>{flashMsg.text}</div>}
        <div className="me-list-header">
          <div>
            <h2>Masters &amp; Slides</h2>
            <p className="mas-page-sub">Masters define the visual theme and slide templates for your quizzes.</p>
          </div>
          <button className="btn btn-primary" onClick={createMaster}>+ New Master</button>
        </div>

        {masters.length === 0 && (
          <p className="se-empty" style={{ marginTop: 32 }}>No masters yet. Create one to define your quiz theme.</p>
        )}

        <div className="me-master-grid">
          {masters.map(m => {
            const customCount = Array.isArray(m.templates?.custom) ? m.templates.custom.length : 0;
            return (
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
                  {customCount > 0 && (
                    <div className="mas-card-custom-badge">
                      🧩 {customCount} custom page{customCount !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
                <div className="me-card-body">
                  <h4>{m.name}</h4>
                  <p className="me-card-meta">{Object.keys(m.styles || {}).join(' · ') || 'Default styles'}</p>
                </div>
                <div className="me-card-actions">
                  <button className="btn btn-primary btn-sm"    onClick={() => openMaster(m)}>Edit</button>
                  <button className="btn btn-secondary btn-sm"  onClick={() => duplicateMaster(m.id)}>Duplicate</button>
                  <button className="btn btn-danger btn-sm"     onClick={() => deleteMaster(m)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Edit view ─────────────────────────────────────────────────────────────
  const styleNames       = Object.keys(styles);
  const addableStyles    = ['title', 'body', 'question', 'answer', 'subtitle', 'caption'].filter(n => !styles[n]);

  return (
    <div className="me-page">
      {flashMsg && (
        <div className={`se-flash se-flash-${flashMsg.type}`} onClick={() => setFlashMsg(null)}>
          {flashMsg.text}
        </div>
      )}

      {/* ── Edit header ── */}
      <div className="mas-edit-header">
        <button className="me-back-btn" onClick={() => { setView('list'); setEditMaster(null); }}>
          ← Masters &amp; Slides
        </button>
        <input
          className="mas-name-input"
          value={masterName}
          onChange={e => setMasterName(e.target.value)}
          placeholder="Master name"
        />
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save (Ctrl+S)'}
        </button>
      </div>

      {/* ── Section tabs ── */}
      <div className="mas-section-tabs">
        <button
          className={`mas-tab ${activeSection === 'layout' ? 'active' : ''}`}
          onClick={() => setActiveSection('layout')}
        >
          <span className="mas-tab-icon">🖼</span>
          <span className="mas-tab-body">
            <span className="mas-tab-title">Layout</span>
            <span className="mas-tab-hint">Background, text styles &amp; placeholder positions</span>
          </span>
        </button>
        <button
          className={`mas-tab ${activeSection === 'templates' ? 'active' : ''}`}
          onClick={() => setActiveSection('templates')}
        >
          <span className="mas-tab-icon">📄</span>
          <span className="mas-tab-body">
            <span className="mas-tab-title">Slide Templates</span>
            <span className="mas-tab-hint">Default content &amp; widgets for each slide type</span>
          </span>
        </button>
      </div>

      {/* ─────────────── LAYOUT SECTION ─────────────── */}
      {activeSection === 'layout' && (
        <div className="me-edit-layout">

          {/* Left sidebar: background + text styles */}
          <aside className="me-sidebar">
            {/* Background */}
            <div className="me-section">
              <h4 className="me-section-title">Background</h4>
              <div className="me-bg-row">
                <input type="color" value={bgColor}
                  onChange={e => { setBgColor(e.target.value); setBgImageUrl(''); }}
                  title="Background colour" className="me-color-swatch" />
                <span className="me-bg-label">{bgImageUrl ? '(image)' : bgColor}</span>
                <button className="btn btn-secondary btn-xs"
                  onClick={() => setShowPicker(true)}>🖼</button>
                {bgImageUrl && (
                  <button className="btn btn-secondary btn-xs" title="Clear image"
                    onClick={() => setBgImageUrl('')}>✕</button>
                )}
              </div>
              {bgImageUrl && (
                <img src={bgImageUrl} alt="bg preview" className="me-bg-preview"
                  onError={e => { e.target.style.display = 'none'; }} />
              )}
            </div>

            {/* Text styles */}
            <div className="me-section">
              <h4 className="me-section-title">Text Styles</h4>
              {styleNames.map(name => {
                const s = styles[name];
                return (
                  <div key={name} className="me-style-entry">
                    <div className="me-style-header">
                      <span className="me-style-name" style={{ color: s.color || '#e8efff' }}>{name}</span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span className="me-style-preview"
                          style={{ fontWeight: s.fontWeight, color: s.color, fontSize: 11 }}>
                          {s.fontSize}px
                        </span>
                        {!['title', 'body', 'question', 'answer'].includes(name) && (
                          <button className="me-icon-btn"
                            onClick={() => setStyles(prev => { const n = { ...prev }; delete n[name]; return n; })}>✕</button>
                        )}
                      </div>
                    </div>
                    <div className="me-style-props">
                      <label className="me-sp-label">
                        <span>Family</span>
                        <select value={s.fontFamily || 'Inter, sans-serif'}
                          onChange={e => updateStyle(name, 'fontFamily', e.target.value)}>
                          {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
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
                );
              })}
              {addableStyles.length > 0 && (
                <select className="me-add-style-sel" value=""
                  onChange={e => { if (!e.target.value) return; setStyles(prev => ({ ...prev, [e.target.value]: mkDefaultStyle() })); }}>
                  <option value="">+ Add style…</option>
                  {addableStyles.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          </aside>

          {/* Center: placeholder canvas */}
          <div className="me-center">
            <div className="me-canvas-bar">
              <span className="me-canvas-hint">Drag placeholders · resize with handles · select to edit properties</span>
              <button className="se-tb-btn" onClick={addPlaceholder}>+ Add placeholder</button>
            </div>
            <div className="se-canvas-outer" style={{ padding: 16 }}>
              <div className="se-canvas-wrap">
                <canvas ref={canvasRef} />
              </div>
            </div>
          </div>

          {/* Right panel: selected placeholder properties */}
          <aside className={`me-right-panel${selPh ? ' visible' : ''}`}>
            {selPh ? (
              <>
                <h4 className="me-rp-title">Placeholder</h4>
                <div className="me-section">
                  <label className="me-sp-label">
                    <span>Role</span>
                    <select value={selPh.role} onChange={e => updateSelPh('role', e.target.value)}>
                      {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                  <label className="me-sp-label">
                    <span>Text style</span>
                    <select value={selPh.styleName} onChange={e => updateSelPh('styleName', e.target.value)}>
                      {Object.keys(styles).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
                <div className="me-section">
                  <h5 className="me-rp-sub">Position (1920×1080)</h5>
                  <div className="me-xywh">
                    {[['x', 'X'], ['y', 'Y'], ['w', 'W'], ['h', 'H']].map(([prop, label]) => (
                      <label key={prop} className="me-sp-label">
                        <span>{label}</span>
                        <input type="number" min={0} value={selPh[prop]}
                          onChange={e => updateSelPh(prop, e.target.value)} />
                      </label>
                    ))}
                  </div>
                </div>
                <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }}
                  onClick={removeSelPh}>✕ Remove placeholder</button>
              </>
            ) : (
              <p className="me-rp-empty">Select a placeholder on the canvas to edit its properties.</p>
            )}
          </aside>
        </div>
      )}

      {/* ─────────────── TEMPLATES SECTION ─────────────── */}
      {activeSection === 'templates' && (
        <div className="mas-templates-layout">
          {/* Slide type sidebar */}
          <aside className="mas-tmpl-sidebar">
            <h4 className="mas-tmpl-sidebar-title">Slide Types</h4>
            <div className="mas-tmpl-type-list">
              {TEMPLATE_TYPES.map(t => {
                const isCustom = t.key === 'custom';
                const count = isCustom ? (templates.custom || []).length : 0;
                return (
                  <button
                    key={t.key}
                    className={`mas-tmpl-type-btn ${activeTemplateType === t.key ? 'active' : ''}`}
                    onClick={() => setActiveTemplateType(t.key)}
                  >
                    <span className="mas-tmpl-icon">{t.icon}</span>
                    <span className="mas-tmpl-label">{t.label}</span>
                    {isCustom && count > 0 && <span className="mas-tmpl-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Template editor */}
          <div className="mas-tmpl-editor">
            <TemplateEditor
              type={activeTemplateType}
              data={templates[activeTemplateType] ?? DEFAULT_TMPL[activeTemplateType]}
              onChange={(key, value) => setTmpl(activeTemplateType, key, value)}
              customPages={templates.custom || []}
              onAddCustomPage={addCustomPage}
              onUpdateCustomPage={updateCustomPage}
              onRemoveCustomPage={removeCustomPage}
            />
          </div>
        </div>
      )}

      {showPicker && (
        <ImagePicker
          onPick={url => { setBgImageUrl(url); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ── Template editor dispatcher ────────────────────────────────────────────────
function TemplateEditor({ type, data, onChange, customPages, onAddCustomPage, onUpdateCustomPage, onRemoveCustomPage }) {
  const d = data || {};

  switch (type) {
    case 'intro':
      return (
        <div className="mas-tmpl-form">
          <h3>Intro Slide</h3>
          <p className="mas-tmpl-desc">
            Shown at the very start of the quiz. Leave fields blank to use the quiz name and code automatically.
          </p>
          <label className="form-label">
            Title text
            <input type="text" value={d.title || ''} placeholder="e.g. Welcome to {{quiz.name}}" onChange={e => onChange('title', e.target.value)} />
          </label>
          <label className="form-label">
            Subtitle text
            <input type="text" value={d.subtitle || ''} placeholder="e.g. Enter code: {{quiz.code}}" onChange={e => onChange('subtitle', e.target.value)} />
          </label>
          <TmplPreview bgColor="#0a0e1f">
            <h2 style={{ color: '#00f0ff', marginBottom: 8 }}>{d.title || '(Quiz Name)'}</h2>
            <p style={{ color: '#8b9dc3' }}>{d.subtitle || 'Enter code: (Quiz Code)'}</p>
          </TmplPreview>
        </div>
      );

    case 'round_intro':
      return (
        <div className="mas-tmpl-form">
          <h3>Round Intro Slide</h3>
          <p className="mas-tmpl-desc">
            Shown before each round starts. The round name is always shown automatically below the label.
          </p>
          <label className="form-label">
            Label above round name
            <input type="text" value={d.label || ''} placeholder="Next Round" onChange={e => onChange('label', e.target.value)} />
          </label>
          <TmplPreview bgColor="#0a0e1f">
            <p style={{ color: '#b829ff', fontSize: 13, marginBottom: 6 }}>{d.label || 'Next Round'}</p>
            <h2 style={{ color: '#e8efff' }}>(Round Name)</h2>
          </TmplPreview>
        </div>
      );

    case 'mark_answers':
      return (
        <div className="mas-tmpl-form">
          <h3>Mark Answers Slide</h3>
          <p className="mas-tmpl-desc">
            Shown after all questions in a round, before the answer reveals. Teams can review and submit answers here.
          </p>
          <label className="form-label">
            Heading
            <input type="text" value={d.heading || ''} placeholder="Mark Your Answers" onChange={e => onChange('heading', e.target.value)} />
          </label>
          <label className="form-label">
            Subtitle
            <input type="text" value={d.subtitle || ''} placeholder="Last chance to submit…" onChange={e => onChange('subtitle', e.target.value)} />
          </label>
          <TmplPreview bgColor="#0a0e1f">
            <h2 style={{ color: '#ff9d00', marginBottom: 8 }}>{d.heading || 'Mark Your Answers'}</h2>
            <p style={{ color: '#8b9dc3' }}>{d.subtitle || 'Last chance to submit before answers are revealed.'}</p>
          </TmplPreview>
        </div>
      );

    case 'end':
      return (
        <div className="mas-tmpl-form">
          <h3>End Slide</h3>
          <p className="mas-tmpl-desc">Shown when the quiz finishes.</p>
          <label className="form-label">
            Title
            <input type="text" value={d.title || ''} placeholder="Quiz Complete!" onChange={e => onChange('title', e.target.value)} />
          </label>
          <label className="form-label">
            Subtitle
            <input type="text" value={d.subtitle || ''} placeholder="Thanks for playing." onChange={e => onChange('subtitle', e.target.value)} />
          </label>
          <TmplPreview bgColor="#0a0e1f">
            <h2 style={{ color: '#00f0ff', marginBottom: 8 }}>{d.title || 'Quiz Complete!'}</h2>
            <p style={{ color: '#8b9dc3' }}>{d.subtitle || 'Thanks for playing.'}</p>
          </TmplPreview>
        </div>
      );

    case 'scoreboard':
      return (
        <div className="mas-tmpl-form">
          <h3>Scoreboard Widget Defaults</h3>
          <p className="mas-tmpl-desc">
            These are the default settings used when you add a Scoreboard widget to a quiz that uses this master.
          </p>
          <label className="form-label">
            Title
            <input type="text" value={d.title || ''} placeholder="Leaderboard" onChange={e => onChange('title', e.target.value)} />
          </label>
          <label className="form-label">
            Background colour
            <input type="color" value={d.bgColor || '#0a0e1f'} onChange={e => onChange('bgColor', e.target.value)} />
          </label>
          <TmplPreview bgColor={d.bgColor || '#0a0e1f'}>
            <h2 style={{ color: '#ffe600', marginBottom: 8 }}>{d.title || 'Leaderboard'}</h2>
            <p style={{ color: '#5a6a8a' }}>Live scores appear here during the quiz</p>
          </TmplPreview>
        </div>
      );

    case 'rules':
      return (
        <div className="mas-tmpl-form">
          <h3>Rules Widget Defaults</h3>
          <p className="mas-tmpl-desc">
            Default content when you add a Rules widget to a quiz using this master.
          </p>
          <label className="form-label">
            Title
            <input type="text" value={d.title || ''} placeholder="Rules" onChange={e => onChange('title', e.target.value)} />
          </label>
          <label className="form-label">
            Body text (one rule per line)
            <textarea rows={5} value={d.body || ''} placeholder={'1. No phones\n2. No shouting answers\n3. Have fun!'} onChange={e => onChange('body', e.target.value)} />
          </label>
          <label className="form-label">
            Background colour
            <input type="color" value={d.bgColor || '#0a0e1f'} onChange={e => onChange('bgColor', e.target.value)} />
          </label>
          <TmplPreview bgColor={d.bgColor || '#0a0e1f'}>
            <h2 style={{ color: '#00f0ff', marginBottom: 8 }}>{d.title || 'Rules'}</h2>
            <p style={{ whiteSpace: 'pre-line', color: '#e8efff', fontSize: 13 }}>{d.body || ''}</p>
          </TmplPreview>
        </div>
      );

    case 'custom':
      return (
        <div className="mas-tmpl-form">
          <div className="mas-tmpl-custom-header">
            <div>
              <h3>Custom Pages</h3>
              <p className="mas-tmpl-desc">
                Custom pages created here appear as widget options when building any quiz that uses this master.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={onAddCustomPage}>+ Add Page</button>
          </div>

          {customPages.length === 0 ? (
            <div className="mas-tmpl-empty">
              <p>No custom pages yet.</p>
              <p style={{ fontSize: 12, marginTop: 4, color: '#5a6a8a' }}>
                Add a custom page to create reusable slides — e.g. sponsor pages, break slides, or half-time announcements.
              </p>
            </div>
          ) : (
            <div className="mas-custom-list">
              {customPages.map(page => (
                <CustomPageEditor
                  key={page.id}
                  page={page}
                  onChange={(key, value) => onUpdateCustomPage(page.id, key, value)}
                  onRemove={() => onRemoveCustomPage(page.id)}
                />
              ))}
            </div>
          )}
        </div>
      );

    default:
      return <p>Unknown template type: {type}</p>;
  }
}

function TmplPreview({ bgColor, children }) {
  return (
    <div className="mas-tmpl-preview" style={{ background: bgColor || '#0a0e1f' }}>
      <span className="mas-tmpl-preview-label">Preview</span>
      {children}
    </div>
  );
}

function CustomPageEditor({ page, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="mas-custom-page-card">
      <div className="mas-custom-page-row">
        <button className="mas-custom-page-toggle" onClick={() => setExpanded(e => !e)}>
          {expanded ? '▾' : '▸'} {page.name || page.title || 'Custom Page'}
        </button>
        <button className="btn btn-danger btn-xs" onClick={onRemove}>✕ Remove</button>
      </div>
      {expanded && (
        <div className="mas-custom-page-fields">
          <label className="form-label">
            Internal name <span className="mas-field-hint">(for admin reference only)</span>
            <input type="text" value={page.name || ''} onChange={e => onChange('name', e.target.value)} />
          </label>
          <label className="form-label">
            Title <span className="mas-field-hint">(shown on slide)</span>
            <input type="text" value={page.title || ''} onChange={e => onChange('title', e.target.value)} />
          </label>
          <label className="form-label">
            Body text
            <textarea rows={4} value={page.body || ''} onChange={e => onChange('body', e.target.value)} />
          </label>
          <label className="form-label">
            Image URL <span className="mas-field-hint">(optional — /uploads/… or https://…)</span>
            <input type="text" value={page.imageUrl || ''} onChange={e => onChange('imageUrl', e.target.value)} />
          </label>
          <label className="form-label">
            Background colour
            <input type="color" value={page.bgColor || '#0a0e1f'} onChange={e => onChange('bgColor', e.target.value)} />
          </label>
          <TmplPreview bgColor={page.bgColor || '#0a0e1f'}>
            {page.title && <h3 style={{ color: '#00f0ff', marginBottom: 6 }}>{page.title}</h3>}
            {page.body  && <p style={{ whiteSpace: 'pre-line', fontSize: 13, color: '#e8efff' }}>{page.body}</p>}
            {page.imageUrl && <img src={page.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 80, borderRadius: 6, marginTop: 8 }} />}
          </TmplPreview>
        </div>
      )}
    </div>
  );
}
