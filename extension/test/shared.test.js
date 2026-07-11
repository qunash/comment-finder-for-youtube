import { expect, test } from "bun:test";
import { apiErrorMessage, commentView, isDeferredChannelPage, videoIdFromUrl, videoMetadata } from "../src/shared.js";

const videoId = "dQw4w9WgXcQ";

test("extracts a video ID from a supported watch URL", () => {
  expect(videoIdFromUrl(`https://www.youtube.com/watch?v=${videoId}&t=42`)).toBe(videoId);
  expect(videoIdFromUrl(`https://m.youtube.com/watch?v=${videoId}`)).toBe(videoId);
});

test("rejects unsupported and malformed page URLs", () => {
  expect(videoIdFromUrl("https://www.youtube.com/@openai")).toBeNull();
  expect(videoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  expect(videoIdFromUrl("https://www.youtube.com/watch?v=not-a-video-id")).toBeNull();
  expect(videoIdFromUrl("not a URL")).toBeNull();
  expect(isDeferredChannelPage("https://www.youtube.com/@openai/videos")).toBe(true);
  expect(isDeferredChannelPage("https://www.youtube.com/channel/UC123")).toBe(true);
  expect(isDeferredChannelPage(`https://www.youtube.com/watch?v=${videoId}`)).toBe(false);
});

test("maps a top-level comment to a safe, complete display model", () => {
  const view = commentView(
    {
      snippet: {
        topLevelComment: {
          id: "Ugy-comment-id",
          snippet: {
            authorChannelUrl: "http://www.youtube.com/channel/UC_author",
            authorDisplayName: "A commenter",
            likeCount: 12,
            publishedAt: "2026-07-11T10:00:00Z",
            textDisplay: "<script>not markup</script>\nFull public comment",
          },
        },
      },
    },
    videoId,
  );

  expect(view).toEqual({
    authorChannelUrl: "https://www.youtube.com/channel/UC_author",
    authorName: "A commenter",
    commentUrl: `https://www.youtube.com/watch?v=${videoId}&lc=Ugy-comment-id`,
    likeCount: 12,
    publishedAt: "2026-07-11T10:00:00Z",
    text: "<script>not markup</script>\nFull public comment",
  });
});

test("extracts required video metadata and maps expected API errors", () => {
  expect(videoMetadata({ items: [{ snippet: { channelTitle: "Example channel", title: "Example video" } }] })).toEqual({
    channelTitle: "Example channel",
    title: "Example video",
  });
  expect(videoMetadata({ items: [] })).toBeNull();
  expect(apiErrorMessage({ body: { error: { errors: [{ reason: "commentsDisabled" }] } }, status: 403 })).toContain("disabled");
  expect(apiErrorMessage({ status: 429 })).toContain("quota");
});
