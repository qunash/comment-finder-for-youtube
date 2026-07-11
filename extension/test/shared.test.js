import { expect, test } from "bun:test";
import { apiErrorMessage, commentView, isDeferredChannelPage, relativeTimeFrom, videoIdFromUrl, videoMetadata } from "../src/shared.js";

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
        totalReplyCount: 4,
        topLevelComment: {
          id: "Ugy-comment-id",
          snippet: {
            authorChannelUrl: "http://www.youtube.com/channel/UC_author",
            authorDisplayName: "A commenter",
            authorProfileImageUrl: "https://yt3.ggpht.com/avatar-photo",
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
    authorProfileImageUrl: "https://yt3.ggpht.com/avatar-photo",
    commentUrl: `https://www.youtube.com/watch?v=${videoId}&lc=Ugy-comment-id`,
    likeCount: 12,
    publishedAt: "2026-07-11T10:00:00Z",
    replyCount: 4,
    text: "<script>not markup</script>\nFull public comment",
  });
});

test("rejects unsafe author image hosts and formats relative timestamps", () => {
  const view = commentView(
    {
      snippet: {
        topLevelComment: {
          id: "Ugy-comment-id",
          snippet: {
            authorDisplayName: "A commenter",
            authorProfileImageUrl: "https://evil.example/avatar.png",
            likeCount: 0,
            publishedAt: "2026-07-11T10:00:00Z",
            textDisplay: "Hello",
          },
        },
      },
    },
    videoId,
  );

  expect(view.authorProfileImageUrl).toBeNull();
  expect(view.replyCount).toBe(0);
  expect(relativeTimeFrom("2026-07-11T07:00:00Z", Date.parse("2026-07-11T10:00:00Z"))).toBe(
    new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-3, "hour"),
  );
});

test("extracts required video metadata and maps expected API errors", () => {
  expect(
    videoMetadata({
      items: [{ snippet: { channelTitle: "Example channel", title: "Example video" }, statistics: { commentCount: "1284" } }],
    }),
  ).toEqual({
    channelTitle: "Example channel",
    commentCount: 1284,
    title: "Example video",
  });
  expect(videoMetadata({ items: [{ snippet: { channelTitle: "Example channel", title: "Example video" } }] })).toEqual({
    channelTitle: "Example channel",
    commentCount: null,
    title: "Example video",
  });
  expect(videoMetadata({ items: [] })).toBeNull();
  expect(apiErrorMessage({ body: { error: { errors: [{ reason: "commentsDisabled" }] } }, status: 403 })).toContain("disabled");
  expect(apiErrorMessage({ status: 429 })).toContain("quota");
});
