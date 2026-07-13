# Comment Finder

Comment Finder is a Chrome extension for searching public comments on the current YouTube video or channel. The default UI is the toolbar popup; an optional browser side panel is available from a header control or the Alt+Shift+C hotkey (Option+Shift+C on Mac). It uses the YouTube Data API v3 through a Cloudflare Workers proxy, keeping the API key out of the extension bundle.

The extension is deliberately named **Comment Finder**, rather than using YouTube in its product name. YouTube's branding rules prohibit using “YouTube”, “YT”, or a variant in an application's overall name. The bundled, unmodified “Developed with YouTube” asset links to YouTube instead. See the [branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines).

## Plan and implementation choices

| Concern | Decision | Why |
| --- | --- | --- |
| Extension UI | MV3 action popup + optional side panel | No page injection, content script, DOM scraping, or YouTube UI modification. Toolbar click opens the popup; a header button or `Alt+Shift+C` (`Option+Shift+C` on Mac) toggles the same UI in a window-scoped Chrome side panel (`sidepanel.html`, derived at build time). The side panel follows tab switches and YouTube SPA navigations. YouTube page URLs are readable via YouTube `host_permissions` (not broad `tabs`). A `declarativeContent` rule swaps the toolbar icon (active red / inactive gray) from a page-URL match evaluated by the browser. |
| Current page | Watch, Shorts, `/channel/UC…`, or `@handle` | Video search uses `videoId`. Channel search uses `allThreadsRelatedToChannelId`. Legacy `/c/` custom URLs stay unsupported. |
| API key | Cloudflare Worker secret | The extension never receives the key. |
| Hosting | Cloudflare Workers | A small HTTP proxy fits the free edge offering. Bun is used for package management, builds, tests, and Wrangler commands; Workers is the deployed JavaScript runtime, not Bun. |
| Video metadata | Background `videos.list` request with a five-minute per-video cache | `commentThreads.list` does not return the video title or uploader channel title. Displaying both alongside video comments is required by YouTube's Required Minimum Functionality rules. Popup/sidebar opens share an in-flight request, and stale metadata refreshes without discarding restored results. |
| Channel metadata | `channels.list` by `id` or `forHandle` | Handle pages resolve to a channel ID before search and session restore. |
| Channel result titles | Batched `videos.list` (up to 50 IDs) | Channel comment threads include `snippet.videoId` but not the source video title. |
| Comment rendering | Full `textOriginal`, author, likes, published time, and an individual comment link | Plain text avoids HTML injection; in-comment `m:ss` / `h:mm:ss` stamps open the watch URL at that time in a new tab. |
| Caching | Per-target session restore with five-minute metadata freshness | The popup restores keyword, metadata, results, and pagination from `chrome.storage.session` keyed by the current page identity (`video:…`, `channel:…`, or `handle:…`) for the browser session. Metadata older than five minutes is refreshed by the background service worker; simultaneous popup, side-panel, and search requests share the same fetch. The Worker does not use Cache, KV, D1, or any comment-data store. |
| Consent | Versioned local privacy-policy acceptance | Search APIs remain inaccessible until the user accepts the policy. Consent version stays in `chrome.storage.local`; popup session state uses `chrome.storage.session`. |
| Abuse protection | Cloudflare Rate Limiting binding keyed by `CF-Connecting-IP` | A coarse 20-request/minute protection for an unauthenticated MVP. It is not authentication or a globally accurate quota ledger. |
| Quota monitoring | Analytics Engine endpoint/status counters | One aggregate event per upstream API call; it records no keyword, video ID, comment, author, or IP. |

No UI framework, YouTube client SDK, server framework, or database is used. The only declared development dependency is the pinned Cloudflare deployment tool, `wrangler`. The parent workspace also has Wrangler installed, but this project declares its own copy so it can be moved and deployed independently.

## Architecture

```text
Chrome MV3
  background service worker → declarativeContent page-URL match → active/inactive toolbar icon
                          └─ commands.open-side-panel (Alt+Shift+C / Option+Shift+C on Mac) → chrome.sidePanel.open or close
  action popup (activeTab)  or  side panel (same UI, full height)
    parses watch, Shorts, /channel/UC…, or @handle URL
    ├─ chrome.storage.session → restore prior state for this video/channel/handle
    ├─ GET /yt/videos?id=VIDEO_ID[,…]     (video metadata or channel source titles)
    ├─ GET /yt/channels?id=…|forHandle=…  (channel pages)
    └─ GET /yt/commentThreads?videoId=…|channelId=…&searchTerms=…&pageToken=…
                   │
                   ▼
Cloudflare Worker
  exact chrome-extension://<id> CORS gate
  strict parameter allow-list + 20/min edge rate limit
  aggregate endpoint/status telemetry only
                   │
                   ▼
YouTube Data API v3
  server-side YOUTUBE_API_KEY secret
```

The Worker returns the upstream YouTube JSON body and status unchanged, while adding exact-origin CORS and `Cache-Control: no-store`. It accepts only selection values from the extension and forces `part=snippet,replies`, `maxResults=100`, `order=time`, and `textFormat=plainText` itself. This deliberately avoids `order=relevance`, which can return `400 processingFailure` on some videos. Matching replies bundled with search results are shown expanded; non-matching replies are ignored. When the thread has more replies than came with search, a YouTube “See full thread” link is offered.

## Scope

Implemented now:

- Video ID detection from the current `youtube.com/watch?v=…` or `/shorts/…` tab.
- Channel ID detection from `/channel/UC…` and handle resolution from `@handle` via `channels.list?forHandle=…`.
- Active (red) / inactive (gray) toolbar icons based on whether the current tab is a supported page.
- Popup and side-panel search, a privacy-consent gate, full comment display, and pagination.
- Side panel toggled from the popup header button or Alt+Shift+C (Option+Shift+C on Mac), rebindable in chrome://extensions/shortcuts.
- Inline matching replies from search, shown expanded, plus a YouTube “See full thread” link.
- Per-video, per-channel, and per-handle popup state restore for the current browser session.
- Video title and uploader channel title display; channel title (and handle when available) for channel pages.
- Source video title links on channel search results.
- Individual `watch?v={videoId}&lc={commentId}` links.
- Secure Worker proxy, exact CORS, edge rate limiting, aggregate quota telemetry, and no server-side cache.

Deferred:

- Legacy `/c/*` custom-URL search.
- Share links and permanent offline storage.

## Project layout

```text
comment-finder/
├── extension/
│   ├── manifest.template.json    # Build-time API-origin substitution
│   ├── popup.html / popup.css
│   ├── privacy.html
│   ├── assets/                   # Toolbar icons + YouTube attribution PNGs
│   ├── scripts/build.mjs
│   ├── src/                      # popup.js, background.js (icon state), shared helpers
│   └── test/
├── proxy/
│   ├── .dev.vars.example
│   ├── wrangler.jsonc
│   ├── src/index.ts
│   └── test/
└── package.json
```

`extension/dist/` is generated and ignored. It is the only folder to load as an unpacked extension or zip for the Web Store.

## Prerequisites

1. [Bun](https://bun.com/) 1.1 or later.
2. A Cloudflare account with Workers enabled.
3. A **dedicated Google Cloud project for this extension only**, with YouTube Data API v3 enabled.
4. A Google API key restricted to **YouTube Data API v3**. Do not put it in the extension, in a committed environment file, or in a `wrangler.jsonc` variable.

Install the sole tooling dependency:

```bash
cd comment-finder
bun install
```

## Local development

1. Create an initial local build. This uses only a public local URL and contains no secret:

   ```bash
   EXTENSION_API_BASE_URL=http://127.0.0.1:8787 bun run build:extension
   ```

2. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`. Copy its generated extension ID.

3. Create the ignored local Worker environment file and set that ID:

   ```bash
   cp proxy/.dev.vars.example proxy/.dev.vars
   ```

   Set `YOUTUBE_API_KEY` and set `ALLOWED_EXTENSION_ORIGIN` to exactly:

   ```text
   chrome-extension://YOUR_UNPACKED_EXTENSION_ID
   ```

4. Start the proxy:

   ```bash
   bun run dev:proxy
   ```

5. Reload the unpacked extension after each build. Test a comment-enabled video, a channel or @handle page, a disabled-comments video, a blank keyword, an unsupported page, and pagination.

Local and production extension IDs differ. Use a separate local Worker or separate local origin configuration; never add a wildcard origin.

## Production deployment

Cloudflare Workers is a good free MVP host. Its request allowance is above the YouTube default quota in this design, so the YouTube quota is the resource that needs active monitoring first. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [YouTube quota costs](https://developers.google.com/youtube/v3/determine_quota_cost).

1. Deploy the Worker once to obtain its `workers.dev` URL. It will safely reject all requests until its allowed extension origin is set.

   ```bash
   bunx wrangler secret put YOUTUBE_API_KEY --config proxy/wrangler.jsonc
   bun run deploy:proxy
   ```

2. Build the production extension with the public Worker origin:

   ```bash
   EXTENSION_API_BASE_URL=https://comment-finder-proxy.YOUR_SUBDOMAIN.workers.dev bun run build:extension
   ```

   The build writes that exact host into the MV3 `host_permissions` list. It is public configuration, not a credential.

3. Upload a draft to the Chrome Web Store (or otherwise obtain its stable production extension ID), then configure the exact origin:

   ```bash
   bunx wrangler secret put ALLOWED_EXTENSION_ORIGIN --config proxy/wrangler.jsonc
   # Value: chrome-extension://YOUR_CHROME_WEB_STORE_EXTENSION_ID
   ```

   Although this value is not sensitive, storing it as a Worker secret keeps deployment configuration out of source control. The secret update deploys a new Worker version.

4. Rebuild and package `extension/dist` if the Worker origin changed. The API key must never appear in the generated directory. Inspect the bundle before releasing it.

The rate-limit binding uses namespace `1001`. Cloudflare requires this to be a positive integer unique to the desired counter namespace in your account; change it if another Worker already uses that namespace. Cloudflare documents that this binding is local to a data center and eventually consistent, so it is an abuse control—not a hard global daily quota cap. For public scale, add real, revocable user authentication and a server-side global budget model.

## Proxy contract

| Route | Accepted client query | Forced upstream parameters |
| --- | --- | --- |
| `GET /yt/commentThreads` | exactly one of `videoId` or `channelId`, plus `searchTerms`, optional `pageToken` | `part=snippet,replies`, `maxResults=100`, `order=time`, `textFormat=plainText`; `channelId` maps to `allThreadsRelatedToChannelId` |
| `GET /yt/channels` | exactly one of `id` or `forHandle` | `part=snippet,statistics` |
| `GET /yt/videos` | `id` (one ID, or comma-separated list up to 50) | `part=snippet,statistics` |

All routes reject duplicate, unknown, malformed, and client-controlled API parameters. All `GET` and `OPTIONS` requests must have the exact configured `Origin`. CORS is a browser control rather than authentication—non-browser callers can forge an Origin header—so do not treat a static extension token as a secret. A token bundled in an extension is extractable.

Analytics Engine writes only two dimensions: route (`commentThreads`, `channels`, `videos`, or `rate_limited`) and HTTP status, plus a numeric count. It creates the configured dataset on its first write. The Google Cloud quota dashboard remains the authoritative daily quota view.

## Validation

These checks use Bun and make no real YouTube API request:

```bash
bun test
EXTENSION_API_BASE_URL=https://proxy.example.invalid bun run build:extension
bun run check:proxy
```

The test suite covers URL parsing, XSS-safe comment data mapping, privacy/manifest contracts, forced upstream parameters, parameter rejection, exact CORS, pagination token forwarding, rate-limit rejection, metadata proxying, upstream error passthrough, and secret non-disclosure.

## Compliance before launch

- [ ] Use one GCP project only for this extension, with YouTube Data API v3 enabled.
- [ ] Keep `YOUTUBE_API_KEY` only in the Worker secret store; restrict it to the YouTube Data API.
- [ ] Replace `REPLACE_WITH_PRIVACY_CONTACT` in `extension/privacy.html` and publish the same policy at a stable public URL before public use.
- [ ] Keep the privacy-consent gate, YouTube Terms link, and Google Privacy Policy link accessible.
- [ ] Do not add page injection, DOM scraping, Innertube calls, or a broad host permission.
- [ ] Do not keep a permanent offline comment cache. Session restore may hold recent per-video, per-channel, and per-handle results in `chrome.storage.session` until the browser closes; the Worker must not cache comment data.
- [ ] Monitor the Google Cloud quota dashboard and aggregate Worker usage. A restored popup avoids repeating metadata and comment fetches; a fresh video's first search generally costs two units (metadata + first comment page). A fresh channel/@handle search also needs channel resolution and may add batched source-video title lookups (one unit per up to 50 IDs).
- [ ] Apply for a YouTube API compliance audit and quota extension before a public-scale launch. The default quota is 10,000 units/day and additional quota requires an audit. See [quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).
- [ ] Confirm the final Chrome Web Store listing, privacy policy, attribution asset, and popup behavior against the current [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality), and [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/).
