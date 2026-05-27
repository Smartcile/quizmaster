// autoShrink.js — reusable auto-shrink utility for Fabric.js Textbox objects.
//
// Contract: when a textbox has autoShrink=true and fixedHeight set, the font
// size is reduced from originalFontSize until the wrapped text height fits
// within fixedHeight. Other slide types that reuse this only need to import
// applyAutoShrink and call it in their text:changed handler.

const MIN_FONT_SIZE = 8;

/**
 * Shrinks textbox.fontSize until text height <= textbox.fixedHeight.
 * No-ops when autoShrink is false or fixedHeight is unset.
 * Safe to call on every keystroke — bails early when not applicable.
 */
export function applyAutoShrink(textbox) {
  if (!textbox || !textbox.autoShrink) return;
  const maxH = textbox.fixedHeight;
  if (!maxH || maxH <= 0) return;

  // Seed originalFontSize the first time so we always shrink from the intended size.
  if (!textbox.originalFontSize) {
    textbox.originalFontSize = textbox.fontSize;
  }

  let size = textbox.originalFontSize;
  textbox.set('fontSize', size);
  textbox.initDimensions();

  while (textbox.height > maxH && size > MIN_FONT_SIZE) {
    size -= 0.5;
    textbox.set('fontSize', size);
    textbox.initDimensions();
  }

  textbox.canvas?.requestRenderAll();
}

/**
 * Call after the user resizes a textbox to update fixedHeight to the new
 * visual size and reset originalFontSize so shrinking restarts from current.
 */
export function updateFixedHeight(textbox) {
  if (!textbox || textbox.type !== 'textbox') return;
  textbox.fixedHeight = textbox.height * textbox.scaleY;
  // Flatten scale into height so the box isn't double-scaled after.
  textbox.set({ height: textbox.fixedHeight, scaleY: 1 });
  textbox.originalFontSize = textbox.fontSize;
  if (textbox.autoShrink) applyAutoShrink(textbox);
}

// Custom properties that must be passed to toObject() to survive serialisation.
export const AUTOSHRINK_PROPS = ['autoShrink', 'fixedHeight', 'originalFontSize'];
