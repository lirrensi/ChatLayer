---
node_type: architecture
title: Web UI Architecture
status: active
updated: 2026-07-31
tags: [web-ui, architecture, typescript, vue]
links:
  depends_on: [/overview/product.md, /core/server.md]
  documents: [/apps/web/src/]
  relates_to: [/nsdks/node.md]
---

# Web UI Architecture

Manager-facing web interface for Botoraptor — Vue 3 + Ionic.

---

## Overview

The Web UI is a single-page application (SPA) that allows managers to view conversations, send messages, and manage users. It's served as static files by the Botoraptor server.

The UI uses `botoraptor_api_key` as its primary localStorage key and still reads the legacy `chatlayer_api_key` value for compatibility.

**Scope Boundary:**

- **This component owns**: UI rendering, state management, user interactions, real-time updates via long-polling
- **This component does NOT own**: Data persistence, authentication (delegated to server), message delivery to end users
- **Boundary interfaces**: Communicates with server via REST API and long-polling

---

## Project Structure

```
apps/web/
├── src/
│   ├── main.ts               # Application bootstrap
│   ├── App.vue               # Root component
│   ├── i18n.ts               # Internationalization configuration
│   ├── components/
│   │   ├── AuthModal.vue     # API key authentication + logout
│   │   ├── ChatList.vue      # Conversation list with search
│   │   ├── ChatView.vue      # Message view, composer, file uploads
│   │   ├── LanguagePicker.vue
│   │   └── SettingsModal.vue # Theme, notifications, font size, opacity
│   ├── views/
│   │   └── HomePage.vue      # Main layout with deeplink handling
│   ├── stores/
│   │   └── uiStore.ts        # Pinia state management
│   ├── services/
│   │   └── api.ts            # HTTP client + API key management
│   ├── helpers/
│   │   ├── notificationManager.ts  # Browser notification system
│   │   └── hashParser.ts           # Hash URL parsing/building
│   ├── router/
│   │   └── index.ts          # Vue Router configuration
│   ├── locales/
│   │   ├── en.json           # English
│   │   ├── ru.json           # Russian
│   │   ├── zh.json           # Chinese
│   │   ├── es.json           # Spanish
│   │   ├── fr.json           # French
│   │   ├── ar.json           # Arabic (RTL)
│   │   ├── pt.json           # Portuguese
│   │   └── ja.json           # Japanese
│   └── theme/
│       └── variables.css     # Ionic theme variables (customized via CSS vars)
├── public/
├── tests/
└── package.json
```

---

## Technology Stack

| Technology | Version (range) | Purpose |
|------------|----------------|---------|
| Vue.js | ^3.5 | UI framework |
| Ionic | ^8.8 | Mobile-first UI components |
| Pinia | ^4.0 | State management |
| Vue Router | ^5.2 | Routing (@ionic/vue-router) |
| Axios | ^1.18 | HTTP client |
| Vue i18n | ^11.4 | Internationalization |
| Luxon | ^3.7 | Date/time handling |
| Vite | ~8.1 | Build tool |
| timeago.js | ^4.0 | Relative timestamps |
| vue-highlight-words | ^3.0 | Text highlighting in search results |
| localforage | ^1.10 | Offline cache persistence |
| ionicons | ^8.0 | Icon library |

---

## Core Components

### HomePage.vue

Main layout with two-column design:
- Left: Chat list (conversation selector)
- Right: Chat view (messages and composer)

**Responsibilities:**
- Route handling for deeplinks
- Bot and room selection
- Layout coordination
- Deeplink processing with loading spinner and error toasts
- Navigation history (back/forward with keyboard shortcuts)

### ChatList.vue

Displays list of conversations with search and pagination.

**Features:**
- Search by username or last message text (client-side via `fuse.js`)
- Shows last message preview
- Unread indicator (per-room counts)
- Relative timestamps via `timeago.js`
- Responsive design (collapses on mobile)
- Infinite scroll pagination (loads more rooms on scroll)

### ChatView.vue

Message display and composition.

**Features:**
- Message history with pagination (scroll up to load older)
- Message type filtering
- File attachment support (batch upload via `fetch`)
- Quick replies (from server config)
- Message composer with text input
- Dangerous file extension warnings
- Service call handling (toast/alert when `service_call` received)

### AuthModal.vue

API key authentication modal with logout button.

**Flow:**
1. User enters API key
2. Key validated via `GET /apiKeyCheck` endpoint
3. Key stored in localStorage under `botoraptor_api_key` (with legacy `chatlayer_api_key` fallback)
4. Modal dismissed on success
5. Logout clears key and shows modal again

### SettingsModal.vue

User preferences panel with:

- **Notification Level**: `"All"`, `"ManagerCalls"`, `"None"` — controls toast + browser notifications
- **Theme**: `"light"`, `"dark"`, `"system"` — controls dark mode
- **Bot Message Transparency**: 50–100% slider
- **Font Size**: 14–24px slider

### LanguagePicker.vue

Language selection dropdown. Renders available locales.

---

## State Management

### uiStore.ts

Central Pinia store for application state.

**State Shape:**

```typescript
interface UIState {
  selectedBotId: string | undefined;
  selectedRoomId: string | undefined;

  bots: string[];
  rooms: RoomInfo[];
  messages: Message[];
  localSettings: {
    notificationLevel: 'All' | 'ManagerCalls' | 'None';
    theme: 'light' | 'dark' | 'system';
    botMessageOpacity: number;
    fontSize: number;
  };
  unread: Record<string, number>;
  search: { query: string };
  roomFilter: { messageTypes: string[]; tags: string[]; depth: number };
  filterOptions: { messageTypes: string[]; tags: string[] };
  quickAnswers: string[];
}
```

**Key Actions:**

| Action | Description |
|--------|-------------|
| `init()` | Cache restore, listener start, bot loading, client config fetch |
| `selectBot(botId)` | Bot selection + room auto-load |
| `selectRoom(roomId)` | Room selection + message load + unread clear |
| `loadBots()` | Fetch bot list using Botoraptor SDK |
| `loadRooms(botId)` | Fetch rooms using Botoraptor SDK; sends selected arrays as comma-separated query values |
| `loadFilterOptions()` | Fetch complete-database message-type and tag options and prune stale selections after a successful response |
| `loadMessages(roomId)` | Fetch messages via SDK |
| `loadOlderMessages(roomId, cursorId, types?)` | Pagination support |
| `startListener()` | Begin long-polling using Botoraptor SDK |
| `stopListener()` | Stop long-polling |
| `loadClientConfig()` | Fetch `quickAnswers` from server |
| `refresh()` | Context-aware reload |
| `saveStateToCache()` / `restoreStateFromCache()` | localforage offline persistence |

**Offline Cache (localforage):**
- Bot list, rooms, messages cached locally
- Selected bot/room remembered
- Local settings, unread counts, search state, room filter persisted
- Room filter selections and complete-database filter options persisted
- 24-hour cache TTL
- Debounced save (5s) on state change
- Cache restored in `init()` before network calls

---

## Routing

### Route Configuration

```typescript
const routes = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'Home', component: HomePage },
  { path: '/:botId/:userId?', name: 'Chat', component: HomePage, props: true },
  { path: '/home/:botId/:userId?', name: 'HomeChat', component: HomePage, props: true },
];
```

Uses hash history (`createWebHashHistory` via `@ionic/vue-router`) for maximum compatibility.

**Navigation guard:** Before entering chat routes, stores `intendedRoute` in sessionStorage if unauthenticated, then redirects to `/home`.

### Deeplinking

URL format: `/#/home/{botId}/{userId}` (built by `hashParser.ts`)

**Behavior:**
1. Parse botId and userId from hash URL
2. Check authentication (show auth modal if needed, then retry)
3. Load specified bot
4. If userId provided, find and open corresponding room
5. Show loading spinner during navigation
6. Update URL when user navigates manually
7. Bot existence validated before navigation

**Features:**
- Shareable links for conversations
- Bookmarking support
- Keyboard navigation (Alt+ArrowLeft/ArrowRight for history)
- `hasProcessedInitialDeeplink` guard prevents re-processing

---

## API Integration

### api.ts

Axios wrapper with authentication.

**Configuration:**
```typescript
const api = axios.create({
  baseURL: '/',    // Relative to current origin (not hardcoded localhost)
  timeout: 15000,
});
```

**Authentication:**
- API key read from localStorage (`botoraptor_api_key`, with legacy `chatlayer_api_key` fallback)
- Added as `Authorization: Bearer <api key>` header to all requests
- On 401/403: key cleared, `authRequired` event dispatched

**Methods:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getMessages(params)` | GET /getMessages | Fetch messages |
| `getFilterOptions()` | GET /getFilterOptions | Distinct message types and normalized tags across all persisted messages |
| `addMessage(data)` | POST /addMessage | Send message |
| `getUpdates(params)` | GET /getUpdates | Long-polling |
| `validateApiKey()` | GET /apiKeyCheck | Validate stored API key |
| `setApiKey(key)` | — | Persist API key to localStorage |
| `getApiKey()` | — | Read API key from localStorage |
| `clearApiKey()` | — | Remove API key from localStorage |

> **Note:** The UI's `api.ts` uses bare paths like `/getMessages` (without `/api/v1/` prefix). The Node SDK template is also used directly for `getBots()`, `getRooms()`, and long-polling operations. File uploads use raw `fetch('/api/v1/uploadFile', ...)` in `ChatView.vue`.

### Inbox Room Filters

`ChatList.vue` offers checkbox multi-selects for message types and tags plus a recent-message `depth`. Selected message types match with OR semantics, selected tags match with OR semantics, and selecting both groups requires both conditions (AND across groups). The server discovers the option lists from all persisted messages, while `getRooms` applies those choices only within the selected bot's room list. Message tags remain a ChatView concern and are not rendered in conversation rows.

---

## Real-time Updates

### Long-Polling Implementation

The UI uses the Botoraptor Node SDK for long-polling:

```typescript
// In uiStore.ts
const cl = new Botoraptor({ apiKey, listenerType: 'ui', botIds: null });

cl.onMessage((msg) => {
  // Update store with new message
  // Handle service_call notifications
  // Show toast/alert if service_call received while hidden
});
```

**Behavior:**
- Listens on all bots (`botIds: null`)
- Reconnects automatically on error
- Stops when `stopListener()` called
- Service call messages trigger browser notification via `notificationManager.ts`

### Notification Manager

`notificationManager.ts` handles debounced browser `Notification` API calls:
- Configurable notification level (All, ManagerCalls, None)
- Debounced to prevent spam
- Uses `window.alert()` fallback when hidden

---

## Internationalization

### Supported Languages

| Language | File | RTL |
|----------|------|-----|
| English | `en.json` | No |
| Russian | `ru.json` | No |
| Chinese | `zh.json` | No |
| Spanish | `es.json` | No |
| French | `fr.json` | No |
| Arabic | `ar.json` | Yes |
| Portuguese | `pt.json` | No |
| Japanese | `ja.json` | No |

### Usage

```vue
<template>
  <p>{{ $t('search.placeholder') }}</p>
</template>
```

---

## Styling

### Theming

CSS custom properties are applied dynamically via JavaScript:
- `--ion-color-primary`, `--ion-color-secondary` etc. from Ionic defaults
- `--app-font-size` controlled by settings slider
- `--bot-message-opacity` controlled by settings slider
- `ion-palette-dark` class toggled for dark mode
- `--ion-color-scheme` set to `light`/`dark`/`system`

### Responsive Design

- Two-column layout on desktop (>768px)
- Single column on mobile
- Ionic components adapt to platform

---

## Build Process

### Development

```bash
cd apps/web
pnpm install
pnpm run dev    # Starts Vite dev server
```

### Production

```bash
pnpm run build  # Builds to apps/web/dist/, served directly by apps/server
```

**Postbuild:** The build validates `dist/index.html`; no mutable `data/uploads` or other runtime-state copy is made.

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE` | No | API base URL (default: relative `/`, overrides to `http://localhost:31000` in dev) |

---

## Security Considerations

### API Key Storage

- Stored in localStorage (`botoraptor_api_key`, with legacy `chatlayer_api_key` fallback)
- Cleared on 401/403 responses via axios interceptor
- `authRequired` event triggers AuthModal when key missing/invalid

### File Uploads

- Filename length limited to 128 characters
- Files uploaded via multipart form to `/api/v1/uploadFile`
- Supports batch upload (multiple files in one request)
- Dangerous extensions fetched from server config

### Dangerous File Warning

Messages containing attachments with executable extensions display a warning badge. Extension list is loaded dynamically from `/api/v1/getClientConfig` at app startup.

### Trusted Network

The Web UI is designed for trusted networks:
- No built-in user authentication
- API key provides access to all data
- Consider additional auth layer for production

---

## Contracts / Invariants

| Invariant | Description |
|-----------|-------------|
| API key required | UI MUST NOT function without valid API key |
| URL sync | URL MUST reflect current bot and room selection |
| Graceful degradation | UI MUST handle API errors gracefully |
| Offline support | UI SHOULD persist state for offline access (localforage cache) |
