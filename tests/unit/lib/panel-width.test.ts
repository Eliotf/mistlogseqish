// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BIG_KEY_STEP,
  KEY_STEP,
  LEFT_SIDEBAR_SIZE as LEFT,
  PANEL_WIDTH_HEAD_SCRIPT,
  RIGHT_PANEL_SIZE as RIGHT,
  applyWidth,
  clampWidth,
  dragWidth,
  keyWidth,
  maxWidth,
  readWidth,
  saveWidth,
} from "~/lib/panel-width";

const WIDE = 2000;
const css = (name: string) => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});
afterEach(() => vi.restoreAllMocks());

describe("panel widths", () => {
  it("stay between the narrowest and the widest", () => {
    expect(clampWidth(LEFT, 10, WIDE)).toBe(LEFT.min);
    expect(clampWidth(LEFT, 5000, WIDE)).toBe(LEFT.max);
    expect(clampWidth(RIGHT, 400.4, WIDE)).toBe(400);
  });

  it("leave the page room in a narrow window, but never go below the narrowest", () => {
    expect(maxWidth(RIGHT, 1000)).toBe(600);
    expect(maxWidth(LEFT, 1000)).toBe(400);
    expect(maxWidth(RIGHT, 300)).toBe(RIGHT.min);
    expect(clampWidth(RIGHT, 800, 1000)).toBe(600);
  });

  it("grow as the edge is dragged toward the middle", () => {
    expect(dragWidth(LEFT, 224, 50, WIDE)).toBe(274);
    expect(dragWidth(LEFT, 224, -50, WIDE)).toBe(174);
    expect(dragWidth(RIGHT, 448, -50, WIDE)).toBe(498);
    expect(dragWidth(RIGHT, 448, 50, WIDE)).toBe(398);
    expect(dragWidth(RIGHT, 448, 1000, WIDE)).toBe(RIGHT.min);
  });

  it("follow the arrow keys as the edge moves, Shift in bigger steps, Home and End to the ends", () => {
    expect(keyWidth(LEFT, 224, "ArrowRight", false, WIDE)).toBe(224 + KEY_STEP);
    expect(keyWidth(LEFT, 224, "ArrowLeft", true, WIDE)).toBe(224 - BIG_KEY_STEP);
    expect(keyWidth(RIGHT, 448, "ArrowLeft", false, WIDE)).toBe(448 + KEY_STEP);
    expect(keyWidth(RIGHT, 448, "ArrowRight", true, WIDE)).toBe(448 - BIG_KEY_STEP);
    expect(keyWidth(RIGHT, 448, "Home", false, WIDE)).toBe(RIGHT.min);
    expect(keyWidth(RIGHT, 448, "End", false, 1000)).toBe(600);
    expect(keyWidth(LEFT, LEFT.max, "ArrowRight", false, WIDE)).toBe(LEFT.max);
    expect(keyWidth(LEFT, 224, "a", false, WIDE)).toBeNull();
    expect(keyWidth(LEFT, 224, "ArrowUp", false, WIDE)).toBeNull();
  });

  it("are shown through a CSS variable and remembered, and forgotten for the default", () => {
    saveWidth(LEFT, 300);
    expect(css(LEFT.cssVar)).toBe("300px");
    expect(readWidth(LEFT)).toBe(300);
    expect(readWidth(RIGHT)).toBeNull();
    saveWidth(LEFT, null);
    expect(css(LEFT.cssVar)).toBe("");
    expect(readWidth(LEFT)).toBeNull();
    applyWidth(RIGHT, 500);
    expect(css(RIGHT.cssVar)).toBe("500px");
    expect(readWidth(RIGHT)).toBeNull();
  });

  it("ignore rubbish in storage, and still work when storage is blocked", () => {
    localStorage.setItem(LEFT.storageKey, "wide");
    expect(readWidth(LEFT)).toBeNull();
    localStorage.setItem(LEFT.storageKey, "-5");
    expect(readWidth(LEFT)).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readWidth(LEFT)).toBeNull();
    saveWidth(LEFT, 250);
    expect(css(LEFT.cssVar)).toBe("250px");
  });

  it("are set by the head script before the app loads, and it skips what isn't there", () => {
    localStorage.setItem(RIGHT.storageKey, "520");
    localStorage.setItem(LEFT.storageKey, "nonsense");
    new Function(PANEL_WIDTH_HEAD_SCRIPT)();
    expect(css(RIGHT.cssVar)).toBe("520px");
    expect(css(LEFT.cssVar)).toBe("");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => new Function(PANEL_WIDTH_HEAD_SCRIPT)()).not.toThrow();
  });
});
