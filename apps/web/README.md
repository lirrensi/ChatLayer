# Botoraptor Web UI

This is a minimal Ionic + Vue frontend for Botoraptor. It provides:
- API key authentication (stored in localStorage as `botoraptor_api_key`, with fallback to legacy `chatlayer_api_key`)
- Two-column responsive layout (desktop) and mobile-adaptive views
- Chat list (left) and chat view (right)
- Message sending via POST /addMessage
- Message loading via GET /getMessages

Quick start

1. Install dependencies (from the project root):
   cd apps/web
   pnpm install

2. Start dev server:
   cd apps/web
   pnpm dev

Configuration

- API base URL
  - The UI uses `http://localhost:3000` by default.
   - To override, create an `.env` file in `apps/web/` with:
    VITE_API_BASE=http://your-server:3000

- API key (authentication)
  - On first load the app will prompt for `API key`.
  - The key is validated by calling `GET /getMessages?botId=test-bot&limit=1`.
  - If accepted, the key is stored in localStorage under `botoraptor_api_key` and mirrored to legacy `chatlayer_api_key` during the transition period.
  - Requests use `Authorization: Bearer <api key>`.

Files of interest

- [`apps/web/src/services/api.ts`](src/services/api.ts:1) — axios wrapper; reads/stores API key and exposes `getMessages`, `addMessage`, `getUpdates`.
- [`apps/web/src/components/AuthModal.vue`](src/components/AuthModal.vue:1) — API key prompt/validation.
- [`apps/web/src/components/ChatList.vue`](src/components/ChatList.vue:1) — chat list UI.
- [`apps/web/src/components/ChatView.vue`](src/components/ChatView.vue:1) — chat messages, filters and composer.
- [`apps/web/src/views/HomePage.vue`](src/views/HomePage.vue:1) — layout and wiring.

## Search functionality

Client-side search is implemented and persisted locally. It requires no server calls.

- Store state
  - The UI store holds `ui.search.query` and derived flags/tokens (`isSearchActive`, `searchTokens`). See [src/stores/uiStore.ts](src/stores/uiStore.ts) for implementation and persistence in the cache.
- Chat list (left column)
  - A compact search bar appears above the list. See [src/components/ChatList.vue](src/components/ChatList.vue):
    - Search icon on the left, clear action on the right.
    - Input debounced (~150ms) and case-insensitive matching against username and last message text, with roomId fallback when username is missing.
    - Esc clears the query.
    - Strings from i18n: `search.placeholder` and `search.clear` in [src/locales/en.json](src/locales/en.json) and [src/locales/ru.json](src/locales/ru.json).
- Chat view (right column)
  - Messages are not filtered. Instead, occurrences of the typed tokens are highlighted in currently loaded messages using vue-highlight-words. See [src/components/ChatView.vue](src/components/ChatView.vue).
  - Highlight styling uses a `.hl` class with a subtle background for readability.
- Dependencies
  - The project already includes Fuse.js and vue-highlight-words. See [package.json](package.json) for versions.
- Behavior
  - The search query persists via the store’s cache. Clearing the query restores the full list and removes highlights.

Notes and next steps

- Attachments are currently omitted.
- Live updates: currently uses manual refresh; can be upgraded to longpoll (`/getUpdates`) or WebSocket later.
- Time formatting uses `timeago.js`.

Filename length safeguard

- IMPORTANT: Filenames longer than 128 characters can break the UI (layout overflow). Enforce a maximum filename length of 128 characters.
  - Server-side: sanitize and return a cleaned filename in the attachment metadata (e.g. `attachment.filename`). If an incoming filename is >128 chars, truncate while preserving the file extension (for example `very-long-name... .pdf`) or generate a short stable name (UUID + original ext).
  - Client-side: display a truncated filename and keep the full value only in the link title/tooltip. The UI uses [`src/components/ChatView.vue`](src/components/ChatView.vue:103) — see `getAttachmentFileName` usage for display and `:title` usage for the full value.
  - Uploads: when sending file metadata in FormData (`filename`), send the sanitized/trimmed filename to avoid the server echoing extremely long names/URLs back into the UI.

Rationale: long filenames (or signed URLs containing long query strings) may overflow message bubbles and push layouts beyond expected widths. Enforcing/sanitizing names prevents UI derailment and keeps message layout stable.
