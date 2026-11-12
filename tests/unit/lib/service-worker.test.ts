import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/**
 * public/sw.js, run with a fake `self`, caches and network (it is plain JS
 * served as is, so it is tested as it ships).
 */

const ORIGIN = "https://mist.example";

class FakeCache {
  entries = new Map<string, Response>();
  async match(request: Request | string, opts?: { ignoreSearch?: boolean }) {
    // As in browsers: ignoreSearch ignores the query on both sides
    const key = (href: string) => {
      const url = new URL(href);
      if (opts?.ignoreSearch) url.search = "";
      return url.href;
    };
    const wanted = key(typeof request === "string" ? request : request.url);
    for (const [href, response] of this.entries) if (key(href) === wanted) return response.clone();
    return undefined;
  }
  async put(request: Request, response: Response) {
    this.entries.set(request.url, response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
}

let stores: Map<string, FakeCache>;
let network: (request: Request) => Promise<Response>;
let sw: {
  kindOf(request: Request, origin: string): string | null;
  keepable(response: Response, origin: string): boolean;
  page(request: Request, origin: string): Promise<Response>;
  asset(request: Request, origin: string): Promise<Response>;
  PAGES: string;
  ASSETS: string;
  MAX_PAGES: number;
};
let listeners: Record<string, (event: unknown) => void>;

/** A response as fetch gives it: from a URL, maybe after a redirect. */
function answer(body: string, url: string, init: { status?: number; redirected?: boolean } = {}): Response {
  const res = new Response(body, { status: init.status ?? 200, headers: { "Content-Type": "text/html" } });
  Object.defineProperties(res, { url: { value: url }, type: { value: "basic" }, redirected: { value: !!init.redirected } });
  return res;
}

const navigate = (path: string) => {
  const req = new Request(ORIGIN + path);
  Object.defineProperty(req, "mode", { value: "navigate" });
  return req;
};

beforeEach(() => {
  stores = new Map();
  listeners = {};
  network = async (req) => answer(`page ${new URL(req.url).pathname}`, req.url);
  const self: Record<string, unknown> = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, fetch: (req: Request) => network(req), URL, Request, Response, console });
  sw = self.__mistlogServiceWorker as typeof sw;
});

describe("service worker (offline journal, F14)", () => {
  it("handles pages, their route data and built files from this site only", () => {
    expect(sw.kindOf(navigate("/"), ORIGIN)).toBe("page");
    expect(sw.kindOf(new Request(`${ORIGIN}/journal/2026-11-12.data`), ORIGIN)).toBe("page");
    expect(sw.kindOf(new Request(`${ORIGIN}/assets/app-abc123.js`), ORIGIN)).toBe("asset");
    expect(sw.kindOf(new Request(`${ORIGIN}/api/journals`), ORIGIN)).toBeNull();
    expect(sw.kindOf(new Request(`${ORIGIN}/agents/document-agent/x`), ORIGIN)).toBeNull();
    // Opening an API address in a tab is a navigation, but not a page to keep
    expect(sw.kindOf(navigate("/api/index/status"), ORIGIN)).toBeNull();
    expect(sw.kindOf(navigate("/agents/document-agent/x"), ORIGIN)).toBeNull();
    expect(sw.kindOf(new Request("https://fonts.example/css"), ORIGIN)).toBeNull();
    expect(sw.kindOf(new Request(`${ORIGIN}/api/pages`, { method: "POST" }), ORIGIN)).toBeNull();
  });

  it("serves pages from the network when it can, keeping the last copy", async () => {
    expect(await (await sw.page(navigate("/"), ORIGIN)).text()).toBe("page /");
    network = async (req) => answer("newer", req.url);
    // Online always wins over the kept copy
    expect(await (await sw.page(navigate("/"), ORIGIN)).text()).toBe("newer");
    expect(await (await stores.get(sw.PAGES)!.match(`${ORIGIN}/`))!.text()).toBe("newer");
  });

  it("offline, serves the kept copy, sends an unseen page to the journal, and fails without either", async () => {
    await sw.page(navigate("/"), ORIGIN);
    await sw.page(navigate("/journal/2026-11-12?block=x"), ORIGIN);
    network = async () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await (await sw.page(navigate("/journal/2026-11-12"), ORIGIN)).text()).toBe("page /journal/2026-11-12");
    const unseen = await sw.page(navigate("/journal/2026-01-01"), ORIGIN);
    expect([unseen.status, unseen.headers.get("Location")]).toEqual([302, `${ORIGIN}/`]);
    // Route data for a day not seen fails, so the route's own offline fallback runs
    await expect(sw.page(new Request(`${ORIGIN}/journal/2026-01-01.data`), ORIGIN)).rejects.toThrow("Failed to fetch");
    stores.clear();
    await expect(sw.page(navigate("/"), ORIGIN)).rejects.toThrow("Failed to fetch");
  });

  it("never keeps errors or redirects (a sign-in page), so they can't be served offline", async () => {
    network = async () => answer("sign in", "https://team.cloudflareaccess.com/login", { redirected: true });
    await sw.page(navigate("/"), ORIGIN);
    // A sign-in page on this site, reached by a redirect, isn't the page either
    network = async () => answer("sign in", `${ORIGIN}/cdn-cgi/access/login`, { redirected: true });
    await sw.page(navigate("/tasks"), ORIGIN);
    network = async (req) => answer("oops", req.url, { status: 500 });
    await sw.page(navigate("/pages"), ORIGIN);
    expect(stores.get(sw.PAGES)!.entries.size).toBe(0);
  });

  it("keeps built files after the first load and serves them from the cache", async () => {
    let calls = 0;
    network = async (req) => {
      calls++;
      return answer("code", req.url);
    };
    const req = new Request(`${ORIGIN}/assets/app-abc123.js`);
    await sw.asset(req, ORIGIN);
    network = async () => Promise.reject(new TypeError("offline"));
    expect(await (await sw.asset(req, ORIGIN)).text()).toBe("code");
    expect(calls).toBe(1);
  });

  it("keeps at most MAX_PAGES pages, dropping the oldest", async () => {
    for (let i = 0; i < sw.MAX_PAGES + 5; i++) await sw.page(navigate(`/page/p${i}`), ORIGIN);
    const kept = [...stores.get(sw.PAGES)!.entries.keys()];
    expect(kept).toHaveLength(sw.MAX_PAGES);
    expect(kept[0]).toBe(`${ORIGIN}/page/p5`);
  });

  it("clears caches from older versions when it takes over", async () => {
    stores.set("mistlog-pages-v0", new FakeCache());
    stores.set("other-app", new FakeCache());
    await sw.page(navigate("/"), ORIGIN);
    let done: Promise<unknown> = Promise.resolve();
    listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...stores.keys()].sort()).toEqual(["mistlog-pages-v1", "other-app"]);
  });
});
