// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as Y from "yjs";
import { CLOSE_DELETED_PAGE, CLOSE_OUTDATED_CLIENT, DOC_FORMAT_VERSION } from "~/shared/constants";

/** Enough of PartySocket: events, close and reconnect. */
class FakeSocket extends EventTarget {
  readyState = 0;
  close = vi.fn();
  reconnect = vi.fn();
  send = vi.fn();
}

const { mockUseAgent, persistences } = vi.hoisted(() => ({
  mockUseAgent: vi.fn(),
  persistences: [] as Array<{ name: string; doc: unknown; destroy: ReturnType<typeof vi.fn>; clearData: ReturnType<typeof vi.fn> }>,
}));
vi.mock("agents/react", () => ({ useAgent: mockUseAgent }));
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    destroy = vi.fn(async () => {});
    clearData = vi.fn(async () => {});
    constructor(
      public name: string,
      public doc: unknown,
    ) {
      persistences.push(this);
    }
  },
}));

import { useYjsEditor } from "~/lib/useYjsEditor";
import { cacheName, openLocalCache } from "~/lib/local-cache";

describe("keeping pages in the browser", () => {
  let socket: FakeSocket;
  beforeEach(() => {
    persistences.length = 0;
    socket = new FakeSocket();
    mockUseAgent.mockReset().mockImplementation(() => socket);
    vi.stubGlobal("indexedDB", {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names each page's copy by document format and page", () => {
    expect(cacheName("abcd1234")).toBe(`mistlog:v${DOC_FORMAT_VERSION}:abcd1234`);
  });

  it("keeps the open page's document in the browser, and lets go of it when the page closes", () => {
    const { result, unmount } = renderHook(() => useYjsEditor("abcd1234"));
    expect(persistences).toHaveLength(1);
    expect(persistences[0].name).toBe(cacheName("abcd1234"));
    expect(persistences[0].doc).toBe(result.current.doc);
    unmount();
    expect(persistences[0].destroy).toHaveBeenCalled();
    expect(persistences[0].clearData).not.toHaveBeenCalled();
  });

  it("erases a deleted page's copy, but keeps it when the tab is only outdated", () => {
    renderHook(() => useYjsEditor("abcd1234"));
    act(() => {
      socket.dispatchEvent(Object.assign(new Event("close"), { code: CLOSE_OUTDATED_CLIENT }));
    });
    expect(persistences[0].clearData).not.toHaveBeenCalled();
    act(() => {
      socket.dispatchEvent(Object.assign(new Event("close"), { code: CLOSE_DELETED_PAGE }));
    });
    expect(persistences[0].clearData).toHaveBeenCalled();
  });

  it("does nothing where the browser has no IndexedDB", () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(openLocalCache("abcd1234", new Y.Doc())).toBeNull();
    renderHook(() => useYjsEditor("abcd1234"));
    expect(persistences).toHaveLength(0);
  });
});
