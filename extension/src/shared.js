const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function videoIdFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const isYouTubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname);
    const videoId = url.searchParams.get("v");

    if (url.protocol !== "https:" || !isYouTubeHost || url.pathname !== "/watch" || !videoId) {
      return null;
    }

    return VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }

    throw error;
  }
}

export function isDeferredChannelPage(urlString) {
  try {
    const url = new URL(urlString);
    const isYouTubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname);

    return url.protocol === "https:" && isYouTubeHost && (/^\/@[^/]+/.test(url.pathname) || /^\/(channel|c)\//.test(url.pathname));
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }

    throw error;
  }
}

export function commentView(thread, videoId) {
  const comment = thread?.snippet?.topLevelComment;
  const snippet = comment?.snippet;

  if (!comment || !snippet || typeof comment.id !== "string") {
    return null;
  }

  let authorChannelUrl = null;
  if (typeof snippet.authorChannelUrl === "string") {
    try {
      const authorUrl = new URL(snippet.authorChannelUrl);
      const isYouTubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(authorUrl.hostname);

      if (["http:", "https:"].includes(authorUrl.protocol) && isYouTubeHost) {
        authorUrl.protocol = "https:";
        authorChannelUrl = authorUrl.toString();
      }
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }
  }

  const commentUrl = new URL("https://www.youtube.com/watch");
  commentUrl.searchParams.set("v", videoId);
  commentUrl.searchParams.set("lc", comment.id);

  return {
    authorChannelUrl,
    authorName: typeof snippet.authorDisplayName === "string" ? snippet.authorDisplayName : "YouTube user",
    commentUrl: commentUrl.toString(),
    likeCount: Number.isFinite(snippet.likeCount) ? snippet.likeCount : 0,
    publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : null,
    text: typeof snippet.textDisplay === "string" ? snippet.textDisplay : "",
  };
}

export function videoMetadata(response) {
  const item = response?.items?.[0];
  const snippet = item?.snippet;

  if (!snippet || typeof snippet.title !== "string" || typeof snippet.channelTitle !== "string") {
    return null;
  }

  return { channelTitle: snippet.channelTitle, title: snippet.title };
}

export function apiErrorMessage(error) {
  if (error?.name === "AbortError") {
    return null;
  }

  const reason = error?.body?.error?.errors?.[0]?.reason;

  if (reason === "commentsDisabled") {
    return "Comments are disabled for this video in the YouTube Data API.";
  }

  if (error?.status === 429 || reason === "quotaExceeded") {
    return "The search service is busy or has reached its quota. Please try again later.";
  }

  if (error?.status === 404 || reason === "videoNotFound") {
    return "This video is not available through the YouTube Data API.";
  }

  if (error?.status === 400) {
    return "YouTube could not process this search. Try a shorter or different keyword.";
  }

  if (error?.status >= 500) {
    return "The search service is temporarily unavailable. Please try again.";
  }

  return "Unable to search comments right now. Please try again.";
}
