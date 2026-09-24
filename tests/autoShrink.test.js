import { describe, it, expect, vi } from 'vitest';
import { applyAutoShrink, updateFixedHeight, AUTOSHRINK_PROPS } from '../frontend-admin/src/utils/autoShrink.js';

// Minimal Fabric.Textbox stand-in: height is proportional to fontSize, exactly
// the property applyAutoShrink relies on.
function makeTextbox({ autoShrink = true, fontSize = 40, fixedHeight = 100, ratio = 3, type = 'textbox' } = {}) {
  return {
    type,
    autoShrink,
    fontSize,
    fixedHeight,
    scaleY: 1,
    height: fontSize * ratio,
    set(key, val) { if (typeof key === 'object') Object.assign(this, key); else this[key] = val; },
    initDimensions() { this.height = this.fontSize * ratio; },
    canvas: { requestRenderAll: vi.fn() },
  };
}

describe('applyAutoShrink', () => {
  it('shrinks fontSize until the wrapped height fits fixedHeight', () => {
    const tb = makeTextbox({ fontSize: 40, fixedHeight: 100, ratio: 3 });
    applyAutoShrink(tb);
    expect(tb.height).toBeLessThanOrEqual(100);
    expect(tb.fontSize).toBeCloseTo(33, 5);
    expect(tb.originalFontSize).toBe(40); // seeded so it always shrinks from the intended size
    expect(tb.canvas.requestRenderAll).toHaveBeenCalled();
  });

  it('never shrinks below the 8px floor', () => {
    const tb = makeTextbox({ fontSize: 40, fixedHeight: 1, ratio: 3 });
    applyAutoShrink(tb);
    expect(tb.fontSize).toBe(8);
  });

  it('does nothing when autoShrink is off or fixedHeight is unset', () => {
    const off = makeTextbox({ autoShrink: false });
    applyAutoShrink(off);
    expect(off.fontSize).toBe(40);
    expect(off.originalFontSize).toBeUndefined();

    const noH = makeTextbox({ fixedHeight: 0 });
    applyAutoShrink(noH);
    expect(noH.fontSize).toBe(40);
  });

  it('tolerates a null textbox', () => {
    expect(() => applyAutoShrink(null)).not.toThrow();
  });
});

describe('updateFixedHeight', () => {
  it('flattens the visual size into height and resets the shrink baseline', () => {
    const tb = makeTextbox({ fontSize: 20, fixedHeight: 100, ratio: 3 });
    tb.height = 50;
    tb.scaleY = 2;
    updateFixedHeight(tb);
    expect(tb.fixedHeight).toBe(100);      // height * scaleY
    expect(tb.scaleY).toBe(1);             // scale flattened into height
    expect(tb.originalFontSize).toBe(20);  // shrink baseline reset
    expect(tb.height).toBeLessThanOrEqual(tb.fixedHeight); // re-fit at current font
    expect(tb.canvas.requestRenderAll).toHaveBeenCalled();
  });

  it('ignores non-textbox objects', () => {
    const rect = makeTextbox({ type: 'rect' });
    rect.height = 999;
    updateFixedHeight(rect);
    expect(rect.height).toBe(999);
  });
});

describe('AUTOSHRINK_PROPS', () => {
  it('exports the custom props that must survive serialisation', () => {
    expect(AUTOSHRINK_PROPS).toEqual(['autoShrink', 'fixedHeight', 'originalFontSize']);
  });
});
