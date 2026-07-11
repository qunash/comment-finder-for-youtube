interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface UsageDataset {
  writeDataPoint(point: { blobs: string[]; doubles: number[] }): void;
}

export interface Env {
  ALLOWED_EXTENSION_ORIGIN?: string;
  SEARCH_RATE_LIMIT?: RateLimitBinding;
  USAGE?: UsageDataset;
  YOUTUBE_API_KEY?: string;
}

const COMMENT_THREADS_PATH = "/yt/commentThreads";
const VIDEOS_PATH = "/yt/videos";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const EXTENSION_ORIGIN_PREFIX = "chrome-extension://";

function responseHeaders(origin?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-Extension-Id");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Vary", "Origin");
  }

  return headers;
}

function errorResponse(status: number, message: string, reason: string, origin?: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: status,
        errors: [{ domain: "global", message, reason }],
        message,
      },
    }),
    { headers: responseHeaders(origin), status },
  );
}

function invalidQuery(parameters: URLSearchParams, allowed: readonly string[], required: readonly string[]): boolean {
  for (const [name] of parameters) {
    if (!allowed.includes(name)) {
      return true;
    }
  }

  for (const name of allowed) {
    const count = parameters.getAll(name).length;
    if (count > 1 || (required.includes(name) && count !== 1)) {
      return true;
    }
  }

  return false;
}

function youtubeRequest(path: string, parameters: Record<string, string>, apiKey: string): URL {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);

  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("key", apiKey);

  return url;
}

function recordUsage(env: Env, endpoint: string, status: number): void {
  env.USAGE?.writeDataPoint({ blobs: [endpoint, String(status)], doubles: [1] });
}

function passThroughResponse(upstream: Response, origin: string): Response {
  const headers = responseHeaders(origin);
  headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/json; charset=utf-8");

  return new Response(upstream.body, { headers, status: upstream.status });
}

export async function handleRequest(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const allowedOrigin = env.ALLOWED_EXTENSION_ORIGIN;
  const allowedExtensionId = allowedOrigin?.startsWith(EXTENSION_ORIGIN_PREFIX)
    ? allowedOrigin.slice(EXTENSION_ORIGIN_PREFIX.length)
    : null;

  if (!allowedExtensionId || request.headers.get("X-Extension-Id")?.trim() !== allowedExtensionId) {
    return errorResponse(403, "This origin is not allowed to use the proxy.", "forbidden");
  }

  const origin = allowedOrigin!;

  const isSupportedPath = url.pathname === COMMENT_THREADS_PATH || url.pathname === VIDEOS_PATH;
  if (request.method === "OPTIONS") {
    if (!isSupportedPath) {
      return errorResponse(404, "Route not found.", "notFound", origin);
    }

    return new Response(null, { headers: responseHeaders(origin), status: 204 });
  }

  if (request.method !== "GET") {
    return errorResponse(405, "Only GET requests are supported.", "methodNotAllowed", origin);
  }

  if (!isSupportedPath) {
    return errorResponse(404, "Route not found.", "notFound", origin);
  }

  let upstreamUrl: URL;
  let endpoint: string;

  if (url.pathname === COMMENT_THREADS_PATH) {
    if (invalidQuery(url.searchParams, ["videoId", "searchTerms", "pageToken"], ["videoId", "searchTerms"])) {
      return errorResponse(400, "Use one videoId and searchTerms; pageToken is optional.", "invalidParameter", origin);
    }

    const videoId = url.searchParams.get("videoId")?.trim();
    const searchTerms = url.searchParams.get("searchTerms")?.trim();
    const pageToken = url.searchParams.get("pageToken");

    if (!videoId || !VIDEO_ID_PATTERN.test(videoId) || !searchTerms || searchTerms.length > 200 || (pageToken !== null && (!pageToken || pageToken.length > 1024))) {
      return errorResponse(400, "The video ID, keyword, or page token is invalid.", "invalidParameter", origin);
    }

    if (!env.YOUTUBE_API_KEY) {
      return errorResponse(500, "The proxy is not configured.", "backendError", origin);
    }

    const parameters: Record<string, string> = {
      maxResults: "100",
      order: "time",
      part: "snippet,replies",
      searchTerms,
      textFormat: "plainText",
      videoId,
    };
    if (pageToken) {
      parameters.pageToken = pageToken;
    }

    upstreamUrl = youtubeRequest("commentThreads", parameters, env.YOUTUBE_API_KEY);
    endpoint = "commentThreads";
  } else {
    if (invalidQuery(url.searchParams, ["id"], ["id"])) {
      return errorResponse(400, "Use one video id.", "invalidParameter", origin);
    }

    const videoId = url.searchParams.get("id")?.trim();
    if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
      return errorResponse(400, "The video ID is invalid.", "invalidParameter", origin);
    }

    if (!env.YOUTUBE_API_KEY) {
      return errorResponse(500, "The proxy is not configured.", "backendError", origin);
    }

    upstreamUrl = youtubeRequest("videos", { id: videoId, part: "snippet,statistics" }, env.YOUTUBE_API_KEY);
    endpoint = "videos";
  }

  if (!env.SEARCH_RATE_LIMIT) {
    return errorResponse(500, "The proxy is not configured.", "backendError", origin);
  }

  // Local Wrangler requests do not supply this Cloudflare header; production requests do.
  const clientKey = request.headers.get("CF-Connecting-IP") ?? "local-development";
  const { success } = await env.SEARCH_RATE_LIMIT.limit({ key: clientKey });
  if (!success) {
    recordUsage(env, "rate_limited", 429);
    const response = errorResponse(429, "Too many requests. Please try again in a minute.", "rateLimitExceeded", origin);
    response.headers.set("Retry-After", "60");
    return response;
  }

  let upstream: Response;
  try {
    upstream = await fetcher(upstreamUrl, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return errorResponse(502, "YouTube could not be reached.", "backendError", origin);
    }

    throw error;
  }

  recordUsage(env, endpoint, upstream.status);
  return passThroughResponse(upstream, origin);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
