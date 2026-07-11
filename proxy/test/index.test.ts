import { expect, test } from "bun:test";
import { type Env, handleRequest } from "../src/index";

const extensionId = "test-extension-id";
const origin = `chrome-extension://${extensionId}`;
const videoId = "dQw4w9WgXcQ";

function environment(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_EXTENSION_ORIGIN: origin,
    SEARCH_RATE_LIMIT: { limit: async () => ({ success: true }) },
    YOUTUBE_API_KEY: "server-only-key",
    ...overrides,
  };
}

function extensionRequest(path: string, options: RequestInit = {}): Request {
  const headers = new Headers(options.headers);
  headers.set("X-Extension-Id", extensionId);
  headers.set("CF-Connecting-IP", "203.0.113.1");

  return new Request(`https://proxy.example${path}`, { ...options, headers });
}

test("forwards a fixed, encoded commentThreads request and preserves its JSON response", async () => {
  const seenUrls: URL[] = [];
  const upstreamBody = JSON.stringify({ items: [{ id: "thread-1" }], nextPageToken: "next" });
  const fetcher: typeof fetch = async (input) => {
    seenUrls.push(new URL(input instanceof Request ? input.url : input.toString()));
    return new Response(upstreamBody, { headers: { "Content-Type": "application/json" } });
  };

  const response = await handleRequest(
    extensionRequest(`/yt/commentThreads?videoId=${videoId}&searchTerms=space%20%26%20time&pageToken=opaque%3Dtoken`),
    environment(),
    fetcher,
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe(upstreamBody);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(seenUrls).toHaveLength(1);
  expect(seenUrls[0].pathname).toBe("/youtube/v3/commentThreads");
  expect(seenUrls[0].searchParams.get("part")).toBe("snippet,replies");
  expect(seenUrls[0].searchParams.get("maxResults")).toBe("100");
  expect(seenUrls[0].searchParams.get("order")).toBe("time");
  expect(seenUrls[0].searchParams.get("textFormat")).toBe("plainText");
  expect(seenUrls[0].searchParams.get("searchTerms")).toBe("space & time");
  expect(seenUrls[0].searchParams.get("pageToken")).toBe("opaque=token");
  expect(seenUrls[0].searchParams.get("key")).toBe("server-only-key");
  expect(upstreamBody).not.toContain("server-only-key");
});

test("rejects unknown, duplicate, and client-controlled upstream parameters without fetching", async () => {
  let fetchCount = 0;
  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    return new Response();
  };

  const response = await handleRequest(
    extensionRequest(`/yt/commentThreads?videoId=${videoId}&videoId=${videoId}&searchTerms=hello&key=leak`),
    environment(),
    fetcher,
  );

  expect(response.status).toBe(400);
  expect(fetchCount).toBe(0);
  expect(await response.text()).not.toContain("server-only-key");
});

test("rejects requests from other extensions and supports valid preflight", async () => {
  const foreignRequest = new Request(`https://proxy.example/yt/commentThreads?videoId=${videoId}&searchTerms=hello`, {
    headers: { "X-Extension-Id": "another-extension" },
  });
  const foreignResponse = await handleRequest(foreignRequest, environment());
  expect(foreignResponse.status).toBe(403);
  expect(foreignResponse.headers.get("Access-Control-Allow-Origin")).toBeNull();

  const preflight = await handleRequest(extensionRequest("/yt/commentThreads", { method: "OPTIONS" }), environment());
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(preflight.headers.get("Vary")).toBe("Origin");
});

test("returns a rate-limit response before calling YouTube and records aggregate telemetry", async () => {
  const points: Array<{ blobs: string[]; doubles: number[] }> = [];
  let fetchCount = 0;
  const response = await handleRequest(
    extensionRequest(`/yt/commentThreads?videoId=${videoId}&searchTerms=hello`),
    environment({
      SEARCH_RATE_LIMIT: { limit: async () => ({ success: false }) },
      USAGE: { writeDataPoint: (point) => points.push(point) },
    }),
    async () => {
      fetchCount += 1;
      return new Response();
    },
  );

  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(fetchCount).toBe(0);
  expect(points).toEqual([{ blobs: ["rate_limited", "429"], doubles: [1] }]);
});

test("proxies video metadata and preserves YouTube API errors", async () => {
  const urls: URL[] = [];
  const errorBody = JSON.stringify({ error: { errors: [{ reason: "commentsDisabled" }] } });
  const response = await handleRequest(
    extensionRequest(`/yt/videos?id=${videoId}`),
    environment(),
    async (input) => {
      urls.push(new URL(input instanceof Request ? input.url : input.toString()));
      return new Response(errorBody, { headers: { "Content-Type": "application/json" }, status: 403 });
    },
  );

  expect(response.status).toBe(403);
  expect(await response.text()).toBe(errorBody);
  expect(urls[0].pathname).toBe("/youtube/v3/videos");
  expect(urls[0].searchParams.get("part")).toBe("snippet,statistics");
  expect(urls[0].searchParams.get("id")).toBe(videoId);
});

test("does not expose configuration when the upstream is unreachable or a secret is absent", async () => {
  const networkResponse = await handleRequest(
    extensionRequest(`/yt/commentThreads?videoId=${videoId}&searchTerms=hello`),
    environment(),
    async () => {
      throw new TypeError("offline");
    },
  );
  expect(networkResponse.status).toBe(502);
  expect(await networkResponse.text()).not.toContain("server-only-key");

  const missingSecretResponse = await handleRequest(
    extensionRequest(`/yt/commentThreads?videoId=${videoId}&searchTerms=hello`),
    environment({ YOUTUBE_API_KEY: undefined }),
    async () => new Response(),
  );
  expect(missingSecretResponse.status).toBe(500);
  expect(await missingSecretResponse.text()).not.toContain("server-only-key");
});
