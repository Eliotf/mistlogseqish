// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { CLOSE_OUTDATED_CLIENT, DOC_FORMAT_VERSION, clientUnderstandsFormat } from "~/shared/constants";

/** Enough of PartySocket: events, close and reconnect. */
class FakeSocket extends EventTarget {
  readyState = 0;
  close = vi.fn();
  reconnect = vi.fn();
  send = vi.fn();
}

const { mockUseAgent } = vi.hoisted(() => ({ mockUseAgent: vi.fn() }));
vi.mock("agents/react", () => ({ useAgent: mockUseAgent }));

import { useYjsEditor } from "~/lib/useYjsEditor";

describe("clientUnderstandsFormat", () => {
  const url = (q: string) => `https://mistlog.test/agents/document-agent/abcd1234${q}`;
  it("accepts the current format or newer", () => {
    expect(clientUnderstandsFormat(url(`?format=${DOC_FORMAT_VERSION}`))).toBe(true);
    expect(clientUnderstandsFormat(url(`?format=${DOC_FORMAT_VERSION + 1}`))).toBe(true);
  });
  it.each(["", "?format=", `?format=${DOC_FORMAT_VERSION - 1}`, "?format=abc", "?format=4.5", "?format=-4"])("refuses %j", (q) => {
    expect(clientUnderstandsFormat(url(q))).toBe(false);
  });
});

describe("useYjsEditor and older code", () => {
  let socket: FakeSocket;
  beforeEach(() => {
    socket = new FakeSocket();
    mockUseAgent.mockReset();
    mockUseAgent.mockImplementation(() => socket);
  });

  it("tells the server which document format it understands", () => {
    renderHook(() => useYjsEditor("abcd1234"));
    expect(mockUseAgent).toHaveBeenCalledWith(expect.objectContaining({ query: { format: String(DOC_FORMAT_VERSION) } }));
  });

  it("stops reconnecting and reports outdated when refused", () => {
    const { result } = renderHook(() => useYjsEditor("abcd1234"));
    expect(result.current.outdated).toBe(false);
    act(() => {
      socket.dispatchEvent(Object.assign(new Event("close"), { code: CLOSE_OUTDATED_CLIENT }));
    });
    expect(result.current.outdated).toBe(true);
    expect(socket.close).toHaveBeenCalled();
  });

  it("ignores ordinary disconnects, which PartySocket retries", () => {
    const { result } = renderHook(() => useYjsEditor("abcd1234"));
    act(() => {
      socket.dispatchEvent(Object.assign(new Event("close"), { code: 1006 }));
    });
    expect(result.current.outdated).toBe(false);
    expect(socket.close).not.toHaveBeenCalled();
  });
});
