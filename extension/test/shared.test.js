import { expect, test } from "bun:test";
import { apiErrorMessage, commentResourceView, commentView, isDeferredChannelPage, relativeTimeFrom, videoIdFromUrl, videoMetadata } from "../src/shared.js";

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
            authorChannelId: { value: "UC_author" },
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
    "UC_video_owner",
  );

  expect(view).toEqual({
    authorChannelUrl: "https://www.youtube.com/channel/UC_author",
    authorName: "A commenter",
    authorProfileImageUrl: "https://yt3.ggpht.com/avatar-photo",
    commentUrl: `https://www.youtube.com/watch?v=${videoId}&lc=Ugy-comment-id`,
    id: "Ugy-comment-id",
    isVideoAuthor: false,
    likeCount: 12,
    publishedAt: "2026-07-11T10:00:00Z",
    text: "<script>not markup</script>\nFull public comment",
  });
});

test("flags the comment as authored by the video owner when channel IDs match", () => {
  const view = commentView(
    {
      snippet: {
        topLevelComment: {
          id: "Ugy-comment-id",
          snippet: {
            authorChannelId: { value: "UC_video_owner" },
            authorDisplayName: "The owner",
            likeCount: 1,
            publishedAt: "2026-07-11T10:00:00Z",
            textDisplay: "Hey",
          },
        },
      },
    },
    videoId,
    "UC_video_owner",
  );

  expect(view.isVideoAuthor).toBe(true);
});

test("maps a reply comment resource to the same display model", () => {
  const view = commentResourceView(
    {
      id: "Ugy-reply-id",
      snippet: {
        authorChannelId: { value: "UC_video_owner" },
        authorChannelUrl: "https://www.youtube.com/channel/UC_video_owner",
        authorDisplayName: "The owner",
        authorProfileImageUrl: "https://yt3.ggpht.com/owner-photo",
        likeCount: 3,
        parentId: "Ugy-comment-id",
        publishedAt: "2026-07-11T11:00:00Z",
        textDisplay: "A reply",
      },
    },
    videoId,
    "UC_video_owner",
  );

  expect(view).toEqual({
    authorChannelUrl: "https://www.youtube.com/channel/UC_video_owner",
    authorName: "The owner",
    authorProfileImageUrl: "https://yt3.ggpht.com/owner-photo",
    commentUrl: `https://www.youtube.com/watch?v=${videoId}&lc=Ugy-reply-id`,
    id: "Ugy-reply-id",
    isVideoAuthor: true,
    likeCount: 3,
    publishedAt: "2026-07-11T11:00:00Z",
    text: "A reply",
  });
});

test("attaches matching bundled thread replies from search", () => {
  const complete = commentView(
    {
      replies: {
        comments: [
          {
            id: "Ugy-reply-1",
            snippet: {
              authorDisplayName: "One",
              likeCount: 0,
              publishedAt: "2026-07-11T11:00:00Z",
              textDisplay: "First",
            },
          },
        ],
      },
      snippet: {
        totalReplyCount: 1,
        topLevelComment: {
          id: "Ugy-comment-id",
          snippet: {
            authorDisplayName: "A commenter",
            likeCount: 0,
            publishedAt: "2026-07-11T10:00:00Z",
            textDisplay: "Parent",
          },
        },
      },
    },
    videoId,
  );

  expect(complete.replies).toHaveLength(1);
  expect(complete.hasMoreReplies).toBe(false);

  const truncated = commentView(
    {
      replies: {
        comments: [
          {
            id: "Ugy-reply-1",
            snippet: {
              authorDisplayName: "One",
              likeCount: 0,
              publishedAt: "2026-07-11T11:00:00Z",
              textDisplay: "First",
            },
          },
        ],
      },
      snippet: {
        totalReplyCount: 12,
        topLevelComment: {
          id: "Ugy-comment-id",
          snippet: {
            authorDisplayName: "A commenter",
            likeCount: 0,
            publishedAt: "2026-07-11T10:00:00Z",
            textDisplay: "Parent",
          },
        },
      },
    },
    videoId,
  );

  expect(truncated.replies).toHaveLength(1);
  expect(truncated.hasMoreReplies).toBe(true);
});

test("does not flag authorship when video or author channel ID is missing", () => {
  const thread = {
    snippet: {
      topLevelComment: {
        id: "Ugy-comment-id",
        snippet: { authorDisplayName: "Someone", likeCount: 0, publishedAt: "2026-07-11T10:00:00Z", textDisplay: "Hi" },
      },
    },
  };
  expect(commentView(thread, videoId, "UC_video_owner").isVideoAuthor).toBe(false);
  expect(commentView(thread, videoId, null).isVideoAuthor).toBe(false);
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
  expect(view.replies).toBeUndefined();
  expect(relativeTimeFrom("2026-07-11T07:00:00Z", Date.parse("2026-07-11T10:00:00Z"))).toBe(
    new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-3, "hour"),
  );
});

test("extracts required video metadata and maps expected API errors", () => {
  expect(
    videoMetadata({
      items: [{ snippet: { channelId: "UC_video_owner", channelTitle: "Example channel", title: "Example video" }, statistics: { commentCount: "1284" } }],
    }),
  ).toEqual({
    channelId: "UC_video_owner",
    channelTitle: "Example channel",
    commentCount: 1284,
    title: "Example video",
  });
  expect(videoMetadata({ items: [{ snippet: { channelTitle: "Example channel", title: "Example video" } }] })).toEqual({
    channelId: null,
    channelTitle: "Example channel",
    commentCount: null,
    title: "Example video",
  });
  expect(videoMetadata({ items: [] })).toBeNull();
  expect(apiErrorMessage({ body: { error: { errors: [{ reason: "commentsDisabled" }] } }, status: 403 })).toContain("disabled");
  expect(apiErrorMessage({ status: 429 })).toContain("quota");
});
