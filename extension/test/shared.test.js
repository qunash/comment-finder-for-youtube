import { expect, test } from "bun:test";
import {
  apiErrorMessage,
  channelMetadata,
  commentResourceView,
  commentView,
  isUnsupportedChannelPage,
  pageTargetFromUrl,
  relativeTimeFrom,
  timestampMatches,
  videoIdFromUrl,
  videoMetadata,
  videoTitlesFromResponse,
} from "../src/shared.js";

const videoId = "dQw4w9WgXcQ";
const channelId = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

test("extracts a video ID from a supported watch URL", () => {
  expect(videoIdFromUrl(`https://www.youtube.com/watch?v=${videoId}&t=42`)).toBe(videoId);
  expect(videoIdFromUrl(`https://m.youtube.com/watch?v=${videoId}`)).toBe(videoId);
});

test("extracts a video ID from a Shorts URL", () => {
  expect(videoIdFromUrl(`https://www.youtube.com/shorts/${videoId}`)).toBe(videoId);
  expect(videoIdFromUrl(`https://m.youtube.com/shorts/${videoId}`)).toBe(videoId);
  expect(videoIdFromUrl(`https://www.youtube.com/shorts/${videoId}?feature=share`)).toBe(videoId);
});

test("parses video, channel, and handle page targets", () => {
  expect(pageTargetFromUrl(`https://www.youtube.com/watch?v=${videoId}`)).toEqual({ kind: "video", videoId });
  expect(pageTargetFromUrl(`https://www.youtube.com/shorts/${videoId}`)).toEqual({ kind: "video", videoId });
  expect(pageTargetFromUrl(`https://www.youtube.com/channel/${channelId}/videos`)).toEqual({ kind: "channel", channelId });
  expect(pageTargetFromUrl("https://www.youtube.com/@openai/videos")).toEqual({ kind: "handle", handle: "openai" });
  expect(pageTargetFromUrl("https://m.youtube.com/@Some_Handle")).toEqual({ kind: "handle", handle: "Some_Handle" });
});

test("rejects unsupported and malformed page URLs", () => {
  expect(videoIdFromUrl("https://www.youtube.com/@openai")).toBeNull();
  expect(videoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  expect(videoIdFromUrl("https://www.youtube.com/watch?v=not-a-video-id")).toBeNull();
  expect(videoIdFromUrl("https://www.youtube.com/shorts/not-a-video-id")).toBeNull();
  expect(videoIdFromUrl("https://www.youtube.com/shorts/")).toBeNull();
  expect(videoIdFromUrl("not a URL")).toBeNull();
  expect(pageTargetFromUrl("https://www.youtube.com/c/legacy")).toBeNull();
  expect(pageTargetFromUrl("https://www.youtube.com/channel/not-a-channel-id")).toBeNull();
  expect(pageTargetFromUrl("https://www.youtube.com/@ab")).toBeNull();
  expect(isUnsupportedChannelPage("https://www.youtube.com/c/legacy")).toBe(true);
  expect(isUnsupportedChannelPage(`https://www.youtube.com/channel/${channelId}`)).toBe(false);
  expect(isUnsupportedChannelPage(`https://www.youtube.com/watch?v=${videoId}`)).toBe(false);
});

test("finds m:ss and h:mm:ss stamps in comment text", () => {
  expect(timestampMatches("See 0:00 1:23 12:34 and 1:02:15")).toEqual([
    { index: 4, label: "0:00", seconds: 0 },
    { index: 9, label: "1:23", seconds: 83 },
    { index: 14, label: "12:34", seconds: 754 },
    { index: 24, label: "1:02:15", seconds: 3735 },
  ]);
  expect(timestampMatches("bad 1:99 1:60:00 time")).toEqual([]);
  expect(timestampMatches("no times here")).toEqual([]);
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
            textOriginal: "<script>not markup</script>\nFull public comment",
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
    videoId,
  });
});

test("uses the thread video ID for channel search results", () => {
  const sourceVideoId = "abcdefghijk";
  const view = commentView(
    {
      snippet: {
        videoId: sourceVideoId,
        topLevelComment: {
          id: "Ugy-comment-id",
          snippet: {
            authorDisplayName: "A commenter",
            likeCount: 0,
            publishedAt: "2026-07-11T10:00:00Z",
            textOriginal: "From another video",
          },
        },
      },
    },
    null,
    channelId,
    channelId,
  );

  expect(view.videoId).toBe(sourceVideoId);
  expect(view.commentUrl).toBe(`https://www.youtube.com/watch?v=${sourceVideoId}&lc=Ugy-comment-id`);
});

test("keeps channel discussion comments that have no source video", () => {
  const view = commentView(
    {
      snippet: {
        topLevelComment: {
          id: "Ugy-channel-comment",
          snippet: {
            authorDisplayName: "A commenter",
            likeCount: 0,
            publishedAt: "2026-07-11T10:00:00Z",
            textOriginal: "On the channel",
          },
        },
      },
    },
    null,
    channelId,
    channelId,
  );

  expect(view.videoId).toBeNull();
  expect(view.commentUrl).toBe(`https://www.youtube.com/channel/${channelId}`);
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
            textOriginal: "Hey",
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
        textOriginal: "A reply",
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
    videoId,
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
              textOriginal: "First",
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
            textOriginal: "Parent",
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
              textOriginal: "First",
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
            textOriginal: "Parent",
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
        snippet: { authorDisplayName: "Someone", likeCount: 0, publishedAt: "2026-07-11T10:00:00Z", textOriginal: "Hi" },
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
            textOriginal: "Hello",
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

test("extracts video and channel metadata and maps expected API errors", () => {
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
  expect(
    channelMetadata({
      items: [{
        id: channelId,
        snippet: {
          customUrl: "@openai",
          thumbnails: { medium: { url: "https://yt3.ggpht.com/channel-photo" } },
          title: "OpenAI",
        },
        statistics: { hiddenSubscriberCount: false, subscriberCount: "1280000", videoCount: "42" },
      }],
    }),
  ).toEqual({
    channelId,
    handle: "openai",
    hiddenSubscriberCount: false,
    subscriberCount: 1280000,
    thumbnailUrl: "https://yt3.ggpht.com/channel-photo",
    title: "OpenAI",
    videoCount: 42,
  });
  expect(
    channelMetadata({
      items: [{
        id: channelId,
        snippet: { title: "Private subs" },
        statistics: { hiddenSubscriberCount: true, subscriberCount: "999", videoCount: "3" },
      }],
    }),
  ).toEqual({
    channelId,
    handle: null,
    hiddenSubscriberCount: true,
    subscriberCount: null,
    thumbnailUrl: null,
    title: "Private subs",
    videoCount: 3,
  });
  expect(channelMetadata({ items: [] })).toBeNull();
  expect(videoTitlesFromResponse({ items: [{ id: videoId, snippet: { title: "Example video" } }] })).toEqual({
    [videoId]: "Example video",
  });
  expect(apiErrorMessage({ body: { error: { errors: [{ reason: "commentsDisabled" }] } }, status: 403 })).toContain("disabled");
  expect(apiErrorMessage({ body: { error: { errors: [{ reason: "channelNotFound" }] } }, status: 404 })).toContain("not available");
  expect(apiErrorMessage({ status: 429 })).toContain("quota");
});
