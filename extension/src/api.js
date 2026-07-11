const API_ORIGIN = __API_ORIGIN__;

export class ApiError extends Error {
  constructor(status, body) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchVideoMetadata(videoIds, signal) {
  const id = Array.isArray(videoIds) ? videoIds.join(",") : videoIds;
  return requestJson("/yt/videos", { id }, signal);
}

export async function fetchChannelMetadata({ channelId, forHandle }, signal) {
  if (channelId) {
    return requestJson("/yt/channels", { id: channelId }, signal);
  }

  return requestJson("/yt/channels", { forHandle }, signal);
}

export async function searchCommentThreads({ videoId, channelId }, searchTerms, pageToken, signal) {
  const parameters = { searchTerms };

  if (videoId) {
    parameters.videoId = videoId;
  } else {
    parameters.channelId = channelId;
  }

  if (pageToken) {
    parameters.pageToken = pageToken;
  }

  return requestJson("/yt/commentThreads", parameters, signal);
}

async function requestJson(path, parameters, signal) {
  const url = new URL(path, API_ORIGIN);

  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-Extension-Id": chrome.runtime.id,
    },
    signal,
  });

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body;
}
