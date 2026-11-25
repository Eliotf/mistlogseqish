/**
 * Widths for the left sidebar (PRD F8) and the right-hand column (the side
 * panel, F18, or a page's comments), chosen by dragging their inner edge or
 * with the arrow keys on it. Remembered per browser (a viewer convenience):
 * each is a CSS variable on <html>, set by a head script before anything is
 * drawn, so a chosen width doesn't jump when the app loads. With nothing
 * stored, the CSS default applies.
 */

export interface PanelSize {
  storageKey: string;
  /** The CSS variable the panel's width reads. */
  cssVar: string;
  /** Which way the panel sits: dragging its edge toward the middle widens it. */
  side: "left" | "right";
  min: number;
  max: number;
  /** At most this share of the window, so the page always keeps room (the CSS caps it too). */
  maxShare: number;
}

export const LEFT_SIDEBAR_SIZE: PanelSize = {
  storageKey: "mistlog-left-sidebar-width",
  cssVar: "--left-sidebar-width",
  side: "left",
  min: 160,
  max: 480,
  maxShare: 0.4,
};

/** The side panel and a page's comments share one width: they take the same place. */
export const RIGHT_PANEL_SIZE: PanelSize = {
  storageKey: "mistlog-right-panel-width",
  cssVar: "--right-panel-width",
  side: "right",
  min: 280,
  max: 900,
  maxShare: 0.6,
};

/** Arrow key steps, in pixels: plain, and with Shift. */
export const KEY_STEP = 16;
export const BIG_KEY_STEP = 64;

/** The widest a panel can be in a window this wide. */
export function maxWidth(size: PanelSize, viewport: number): number {
  return Math.max(size.min, Math.min(size.max, Math.floor(viewport * size.maxShare)));
}

export function clampWidth(size: PanelSize, px: number, viewport: number): number {
  return Math.round(Math.min(maxWidth(size, viewport), Math.max(size.min, px)));
}

/** The width after dragging the edge `dx` pixels from where it was `start` wide. */
export function dragWidth(size: PanelSize, start: number, dx: number, viewport: number): number {
  return clampWidth(size, size.side === "left" ? start + dx : start - dx, viewport);
}

/**
 * The width after a key on the edge, or null for a key that does nothing.
 * The arrows move the edge (so → widens the left sidebar and narrows the
 * right panel), Shift in bigger steps; Home and End go to narrowest and widest.
 */
export function keyWidth(size: PanelSize, current: number, key: string, shift: boolean, viewport: number): number | null {
  const step = shift ? BIG_KEY_STEP : KEY_STEP;
  const toward = size.side === "left" ? 1 : -1;
  if (key === "ArrowRight") return clampWidth(size, current + step * toward, viewport);
  if (key === "ArrowLeft") return clampWidth(size, current - step * toward, viewport);
  if (key === "Home") return size.min;
  if (key === "End") return maxWidth(size, viewport);
  return null;
}

/** A stored width, or null for none (or rubbish, or blocked storage). */
export function readWidth(size: PanelSize): number | null {
  try {
    const px = Number(localStorage.getItem(size.storageKey));
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

/** Show the panel `px` wide, or at its default for null. */
export function applyWidth(size: PanelSize, px: number | null): void {
  if (px === null) document.documentElement.style.removeProperty(size.cssVar);
  else document.documentElement.style.setProperty(size.cssVar, `${px}px`);
}

/** Show and remember a width, or forget it for null. */
export function saveWidth(size: PanelSize, px: number | null): void {
  applyWidth(size, px);
  try {
    if (px === null) localStorage.removeItem(size.storageKey);
    else localStorage.setItem(size.storageKey, String(px));
  } catch {
    // Not remembered, but it still works
  }
}

/** Run in the page head (root.tsx): sets the stored widths before anything is drawn. */
export const PANEL_WIDTH_HEAD_SCRIPT = `(function(){try{var s=document.documentElement.style;${[LEFT_SIDEBAR_SIZE, RIGHT_PANEL_SIZE]
  .map((size) => `var ${size.side}=Number(localStorage.getItem('${size.storageKey}'));if(${size.side}>0)s.setProperty('${size.cssVar}',${size.side}+'px');`)
  .join("")}}catch(e){}})()`;
