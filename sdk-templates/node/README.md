# Botoraptor SDK

A lightweight, single-file TypeScript SDK for integrating with the Botoraptor server. Designed for **both** main web app integrations and external developer usage.

Legacy `ChatLayer` exports remain supported, but new integrations should import `Botoraptor` from `./botoraptor`.

## 📋 Overview

This SDK provides a minimal client with zero runtime dependencies and uses the global fetch API. It's perfect for:

- **Web applications** - Browser-based chat interfaces
- **Node.js bots** - Server-side automation and message handling
- **Multi-bot management** - Multiple chatbot instances
- **Real-time updates** - Live message streaming via long-polling

**Key Features:**
- Single-file SDK (no bundling required)
- Zero dependencies
- Dual environment support (Browser + Node.js)
- Automatic response normalization
- Support for multiple bots
- Comprehensive file upload support

## 📦 Installation

```bash
npm install chatlayer-sdk
# or
pnpm add chatlayer-sdk
```

Or copy [`chatLayerSDK.ts`](chatLayerSDK.ts:1) directly into your project.

## 🚀 Quick Start

### Browser Integration

```typescript
import Botoraptor from './botoraptor';

const botoraptor = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  botIds: ['bot-1', 'bot-2'],
  listenerType: 'ui', // 'bot' for bots, 'ui' for web apps
});

// Listen for incoming messages
botoraptor.onMessage((msg) => {
  console.log('New message:', msg);
});

// Start real-time updates
botoraptor.start();

// Send a message
await botoraptor.addMessage({
  botId: 'bot-1',
  roomId: 'room-123',
  userId: 'user-456',
  text: 'Hello!',
});
```

### Node.js Bot Integration

```typescript
import Botoraptor from './botoraptor';
import { readFileSync } from 'fs';

const botoraptor = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:3000',
  botId: 'my-bot',
});

// Start polling for messages
botoraptor.start();

// Listen for messages
botoraptor.onMessage(async (msg) => {
  // Process incoming messages
  console.log('Received:', msg.text);

  // Send automated responses
  if (msg.text.toLowerCase().includes('help')) {
    await botoraptor.addMessage({
      ...msg,
      text: 'Here\'s the help information you requested.',
    });
  }
});

// Upload files from disk
const buffer = readFileSync('image.jpg');
const attachments = await botoraptor.uploadFileBuffer(buffer, {
  type: 'image',
  filename: 'uploaded-image.jpg',
  mime: 'image/jpeg',
});
```

## 📚 Type Definitions

### Core Types

```typescript
// Message attachment metadata
interface Attachment {
  id?: string;
  type: "image" | "video" | "document" | "file";
  isExternal?: boolean;
  url?: string | null;
  filename?: string | null;
  original_name?: string | null;
  mime_type?: string;
  size?: number;
  createdAt?: string | null;
}

// Message types
type MessageType =
  | "user_message"
  | "user_message_service"
  | "bot_message_service"
  | "manager_message"
  | "service_call"
  | "error_message"
  | string;

// Complete message structure
interface Message {
  id?: string;
  botId: string;
  roomId: string;
  userId: string;
  username?: string;
  name?: string | null;
  text?: string;
  messageType?: MessageType;
  attachments?: Attachment[] | null;
  meta?: Record<string, any> | null;
  createdAt?: string;
}

// User account information
interface User {
  id?: number;
  botId: string;
  userId: string;
  username: string;
  name?: string | null;
  createdAt?: string;
  blocked?: boolean;
}

// SDK configuration options
interface ChatLayerConfig {
  apiKey: string;                      // Required
  baseUrl?: string;                    // Default: "/"
  botId?: string;                      // Legacy: single bot ID
  botIds?: string[];                   // Current: array of bot IDs
  listenerType?: "bot" | "ui";         // Default: "bot"
  timeoutMs?: number;                  // Default: 60,000ms
  onError?: (err: any) => void;        // Error handler callback
  pollDelayMs?: number;                // Retry delay: 1,000ms
}

// Room and user information
interface RoomInfo {
  botId: string;
  roomId: string;
  users: User[];
  lastMessage?: Message | null;
}
```

## ⚙️ Configuration

### Basic Configuration

```typescript
const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
});
```

### Multiple Bot Support

```typescript
const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  botIds: ['bot-1', 'bot-2', 'bot-3'],
  listenerType: 'bot', // or 'ui'
});
```

### Error Handling

```typescript
const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  onError: (error) => {
    console.error('Botoraptor error:', error);
    // Implement retry logic, alerting, etc.
  },
});
```

## 📡 API Reference

### Message Operations

#### `addMessage(msg)`

Send a text message to the server.

```typescript
const msg = await chatLayer.addMessage({
  botId: 'bot-1',
  roomId: 'room-123',
  userId: 'user-456',
  text: 'Hello!',
});

console.log('Message sent:', msg.id);
```

**Parameters:**
- `msg` (Message): Message object with `botId`, `roomId`, `userId`, and `text`

---

#### `addManagerMessage(msg)`

Convenience method for manager/human operator messages. Automatically sets `messageType: 'manager_message'`.

```typescript
const response = await chatLayer.addManagerMessage({
  botId: 'bot-1',
  roomId: 'room-123',
  userId: 'admin',
  text: 'I\'m here to help you.',
});
```

---

#### `sendServiceAlert(msg)`

Send a system alert or notification. Automatically sets `messageType: 'service_call'`.

```typescript
const alert = await chatLayer.sendServiceAlert({
  botId: 'bot-1',
  roomId: 'room-123',
  userId: 'system',
  text: 'System maintenance scheduled for tonight.',
});
```

---

### File Upload Operations

#### `addMessageSingle(msg, file, options)`

Send a message with a single file in the same request (multipart/form-data).

```typescript
const msg = await chatLayer.addMessageSingle(
  {
    botId: 'bot-1',
    roomId: 'room-123',
    userId: 'user-456',
    text: 'Check out this image',
  },
  file, // File, Blob, Buffer, or Uint8Array
  {
    type: 'image',
    filename: 'photo.jpg',
  }
);
```

**Browser:** Accepts `File` or `Blob` objects  
**Node.js:** Accepts `Buffer` or `Uint8Array` objects

---

#### `uploadFileWeb(fileOrFiles, options)`

Browser-specific file upload. Accepts `File` or `Blob` objects.

```typescript
// Single file
const attachments = await chatLayer.uploadFileWeb(file, {
  type: 'image',
  filename: 'photo.jpg',
});

// Multiple files
const files = Array.from(fileInput.files);
const attachments = await chatLayer.uploadFileWeb(files, [
  { type: 'image', filename: 'photo1.jpg' },
  { type: 'document', filename: 'doc.pdf' },
]);
```

---

#### `uploadFileBuffer(bufferOrBuffers, options)`

Node.js-specific file upload. Accepts `Buffer` or `Uint8Array` objects.

```typescript
import { readFileSync } from 'fs';

// Single buffer
const buffer = readFileSync('image.jpg');
const attachments = await chatLayer.uploadFileBuffer(buffer, {
  type: 'image',
  filename: 'uploaded-image.jpg',
  mime: 'image/jpeg',
});

// Multiple buffers
const buffers = [
  readFileSync('photo1.jpg'),
  readFileSync('document.pdf'),
];
const attachments = await chatLayer.uploadFileBuffer(buffers, [
  { type: 'image', filename: 'photo1.jpg', mime: 'image/jpeg' },
  { type: 'document', filename: 'document.pdf', mime: 'application/pdf' },
]);
```

**Note:** Requires `options.filename` and `options.type` for each file.

---

#### `uploadFileByURL(files)`

Upload files from remote URLs (server downloads and stores them).

```typescript
const attachments = await chatLayer.uploadFileByURL([
  {
    url: 'https://example.com/image.jpg',
    filename: 'downloaded-image.jpg',
    type: 'image',
  },
  {
    url: 'https://example.com/document.pdf',
    type: 'document',
  },
]);
```

---

### Query Operations

#### `getMessages(params)`

Fetch messages with pagination support.

```typescript
// Get last 20 messages
const messages = await chatLayer.getMessages({
  botId: 'bot-1',
  roomId: 'room-123',
  limit: 20,
});

// Paginate (use cursorId from previous response)
const olderMessages = await chatLayer.getMessages({
  botId: 'bot-1',
  roomId: 'room-123',
  cursorId: lastMessageId,
  limit: 20,
});

// Filter by message types
const userMessages = await chatLayer.getMessages({
  botId: 'bot-1',
  roomId: 'room-123',
  types: 'user_message,manager_message',
});
```

**Pagination:**
- Server returns newest-first (descending by `createdAt`)
- Use `cursorId` from the last message you have to fetch older messages

---

#### `getBots()`

List all available bot IDs.

```typescript
const bots = await chatLayer.getBots();
console.log('Available bots:', bots);
// Output: ['bot-1', 'bot-2', 'bot-3']
```

---

#### `getRooms(params)`

Get room information with optional filtering.

```typescript
// Get all rooms
const rooms = await chatLayer.getRooms({
  botId: 'bot-1',
});

// Filter by message type in recent messages
const errorRooms = await chatLayer.getRooms({
  botId: 'bot-1',
  messageType: 'error_message',
  depth: 10, // Check last 10 messages
});
```

---

#### `getClientConfig()`

Retrieve the client configuration object.

```typescript
const config = await chatLayer.getClientConfig();
console.log('Client config:', config);
```

---

### User Management

#### `addUser(user)`

Create or retrieve a user account.

```typescript
const user = await chatLayer.addUser({
  botId: 'bot-1',
  userId: 'user-123',
  username: 'john_doe',
  name: 'John Doe',
});
```

---

### Real-time Operations

#### `onMessage(callback)`

Register a callback for incoming messages.

```typescript
const unsubscribe = chatLayer.onMessage((msg) => {
  console.log('New message:', msg.text);
});

// Later, stop listening
unsubscribe();
```

**Note:** Returns an unsubscribe function that removes the listener.

---

#### `start(opts?)`

Start long-polling for real-time updates.

```typescript
// Start with current configuration
chatLayer.start();

// Override configuration for this session
chatLayer.start({
  botIds: ['bot-1', 'bot-2'], // Listen to specific bots
  listenerType: 'bot', // Set listener role
});
```

**Options:**
- `botIds` (string[] | null): Bot IDs to listen for (null = all bots)
- `listenerType` ('bot' | 'ui'): Listener role ('bot' for bots, 'ui' for web apps)

---

#### `stop()`

Stop the polling loop gracefully.

```typescript
chatLayer.start();

// Later, stop polling
chatLayer.stop();
```

---

## 🎨 Common Patterns

### Pattern 1: Real-time Message Handler with Auto-Response

```typescript
import Botoraptor from './botoraptor';

const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  botIds: ['my-bot'],
  listenerType: 'bot',
});

chatLayer.onMessage(async (msg) => {
  // Handle incoming message
  console.log(`${msg.username}: ${msg.text}`);

  // Send automated response
  if (msg.text.toLowerCase().includes('help')) {
    await chatLayer.addMessage({
      ...msg,
      text: 'Here are the available commands:\n1. /status - Check bot status\n2. /help - Show this help',
    });
  }
});

chatLayer.start();
```

---

### Pattern 2: Web App with File Upload

```typescript
import Botoraptor from './botoraptor';

const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  listenerType: 'ui',
});

// Listen for incoming messages
chatLayer.onMessage((msg) => {
  displayMessage(msg);
});

// Handle file upload
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];

  // Upload file
  const attachments = await chatLayer.uploadFileWeb(file, {
    type: 'image',
    filename: file.name,
  });

  // Send message with attachment
  await chatLayer.addMessage({
    botId: 'chatbot',
    roomId: currentRoomId,
    userId: currentUser.id,
    text: 'Here\'s an image!',
    attachments: attachments.map(a => ({ url: a.url })),
  });
});

chatLayer.start();
```

---

### Pattern 3: Node.js Bot with File Processing

```typescript
import Botoraptor from './botoraptor';
import { readFileSync, createWriteStream } from 'fs';
import { exec } from 'child_process';

const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:3000',
  botId: 'image-bot',
});

chatLayer.onMessage(async (msg) => {
  if (!msg.text?.toLowerCase().includes('process image')) return;

  // Get attachments from message
  if (!msg.attachments?.length) {
    await chatLayer.addMessage({
      ...msg,
      text: 'Please provide an image to process.',
    });
    return;
  }

  // Download and process image
  const imageResponse = await fetch(msg.attachments[0].url);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  // Save to disk
  const outputPath = `processed_${Date.now()}.jpg`;
  createWriteStream(outputPath).write(imageBuffer);

  // Process with external tool
  exec(`magick convert ${outputPath} -resize 200x200 thumbnail_${outputPath}`);

  // Upload processed image
  const processedBuffer = readFileSync(`thumbnail_${outputPath}`);
  const attachments = await chatLayer.uploadFileBuffer(processedBuffer, {
    type: 'image',
    filename: `thumbnail_${outputPath}`,
    mime: 'image/jpeg',
  });

  // Send result
  await chatLayer.addMessage({
    ...msg,
    text: 'Here\'s your processed image!',
    attachments: attachments.map(a => ({ url: a.url })),
  });
});

chatLayer.start();
```

---

### Pattern 4: Multi-Bot Manager

```typescript
import Botoraptor from './botoraptor';

const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  botIds: ['sales-bot', 'support-bot', 'faq-bot'],
  listenerType: 'bot',
});

// Track active conversations per bot
const activeConversations = {
  'sales-bot': 0,
  'support-bot': 0,
  'faq-bot': 0,
};

chatLayer.onMessage((msg) => {
  // Increment active conversation count
  if (activeConversations[msg.botId] !== undefined) {
    activeConversations[msg.botId]++;
  }

  // Route messages based on bot
  if (msg.botId === 'sales-bot') {
    handleSalesMessage(msg);
  } else if (msg.botId === 'support-bot') {
    handleSupportMessage(msg);
  } else if (msg.botId === 'faq-bot') {
    handleFaqMessage(msg);
  }
});

async function handleSalesMessage(msg) {
  // Sales bot logic
  const reply = await generateSalesResponse(msg.text);
  await chatLayer.addMessage({ ...msg, text: reply });
}

async function handleSupportMessage(msg) {
  // Support bot logic
  const reply = await generateSupportResponse(msg.text);
  await chatLayer.addMessage({ ...msg, text: reply });
}

async function handleFaqMessage(msg) {
  // FAQ bot logic
  const reply = await generateFaqResponse(msg.text);
  await chatLayer.addMessage({ ...msg, text: reply });
}

chatLayer.start();
```

---

### Pattern 5: Error Handling and Retry

```typescript
import Botoraptor from './botoraptor';

const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  onError: (error) => {
    console.error('Botoraptor error:', error);

    // Log to monitoring service
    logToMonitoringService(error);

    // Retry failed message
    if (error.message.includes('addMessage failed')) {
      retryFailedMessage();
    }
  },
});

async function retryFailedMessage() {
  // Implement retry logic with exponential backoff
  let retries = 3;
  while (retries > 0) {
    try {
      await chatLayer.addMessage(failedMessage);
      break;
    } catch (error) {
      retries--;
      await sleep(1000 * (3 - retries));
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

### Pattern 6: Message Pagination with Cursor

```typescript
import Botoraptor from './botoraptor';

const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  botId: 'bot-1',
});

async function getAllMessages(roomId: string, batchSize: number = 50) {
  let allMessages: Message[] = [];
  let cursorId: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const batch = await chatLayer.getMessages({
      botId: 'bot-1',
      roomId: roomId,
      limit: batchSize,
      cursorId: cursorId,
    });

    allMessages = [...allMessages, ...batch];

    // Check if there are more messages
    if (batch.length < batchSize) {
      hasMore = false;
    } else {
      // Use the ID of the last message as the cursor
      cursorId = batch[batch.length - 1].id;
    }
  }

  return allMessages;
}

// Usage
const messages = await getAllMessages('room-123');
console.log(`Total messages: ${messages.length}`);
```

---

### Pattern 7: Room Management

```typescript
import Botoraptor from './botoraptor';

const chatLayer = new Botoraptor({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  botId: 'bot-1',
});

// Get all rooms
async function getActiveRooms() {
  const { rooms } = await chatLayer.getRooms({
    botId: 'bot-1',
  });

  return rooms;
}

// Find rooms with recent errors
async function findErrorRooms(depth: number = 10) {
  const { rooms } = await chatLayer.getRooms({
    botId: 'bot-1',
    messageType: 'error_message',
    depth: depth,
  });

  return rooms.filter(room => room.lastMessage?.text?.includes('error'));
}

// Get room users
async function getRoomUsers(roomId: string) {
  const { rooms } = await chatLayer.getRooms({
    botId: 'bot-1',
  });

  const room = rooms.find(r => r.roomId === roomId);
  return room?.users || [];
}

// Usage examples
const activeRooms = await getActiveRooms();
console.log(`Active rooms: ${activeRooms.length}`);

const errorRooms = await findErrorRooms();
console.log(`Rooms with errors: ${errorRooms.map(r => r.roomId)}`);
```

---

## 🌍 Environment Support

| Feature | Node.js | Browser |
|---------|---------|---------|
| Basic API calls | ✅ | ✅ |
| File uploads (File/Blob) | ❌ | ✅ |
| File uploads (Buffer) | ✅ | ❌ |
| Long-polling | ✅ | ✅ |
| Fetch API | Node.js 18+ | All modern browsers |
| Buffer types | ✅ | ❌ |

### Node.js Requirements
- Node.js 18+ (or provide fetch polyfill)
- Install `@types/node` for proper TypeScript support
- Use `Buffer` for file uploads

### Browser Requirements
- All modern browsers with ES6 support
- Native `fetch` API (available in all modern browsers)
- File/Blob objects from `<input type="file">` or drag-and-drop

---

## 🔧 Server Requirements

The Botoraptor server must provide the following API endpoints:

- `POST /api/v1/addMessage` - Send messages
- `POST /api/v1/addMessageSingle` - Send messages with files
- `POST /api/v1/addUser` - Create/retrieve users
- `GET /api/v1/getMessages` - Fetch messages with pagination
- `GET /api/v1/getBots` - List available bots
- `GET /api/v1/getRooms` - Get room information
- `GET /api/v1/getClientConfig` - Get client configuration
- `POST /api/v1/uploadFile` - Upload files (browser/Node.js)
- `POST /api/v1/uploadFileByURL` - Upload files from URLs
- `GET /api/v1/getUpdates` - Long-polling for real-time updates

See the Botoraptor server README for server implementation details.

---

## 📖 Usage Scenarios

### Scenario 1: Main Web Application

```typescript
import Botoraptor from './botoraptor';

class ChatInterface {
  private chatLayer: Botoraptor;
  private currentRoomId: string;
  private currentUser: User;

  constructor(config: BotoraptorConfig) {
    this.chatLayer = new Botoraptor(config);
    this.currentRoomId = '';
  }

  async connect(botId: string, roomId: string) {
    this.currentRoomId = roomId;

    // Listen for incoming messages
    this.chatLayer.onMessage((msg) => {
      this.displayMessage(msg);
    });

    // Start real-time updates
    this.chatLayer.start();

    // Load previous messages
    const messages = await this.chatLayer.getMessages({
      botId,
      roomId,
      limit: 50,
    });

    messages.forEach(msg => this.displayMessage(msg));
  }

  async sendMessage(text: string) {
    const msg = await this.chatLayer.addMessage({
      botId: 'main-bot',
      roomId: this.currentRoomId,
      userId: this.currentUser.id,
      text,
    });

    this.displayMessage(msg);
  }

  async uploadImage(file: File) {
    const attachments = await this.chatLayer.uploadFileWeb(file, {
      type: 'image',
      filename: file.name,
    });

    const msg = await this.chatLayer.addMessage({
      botId: 'main-bot',
      roomId: this.currentRoomId,
      userId: this.currentUser.id,
      text: 'Here\'s an image!',
      attachments: attachments.map(a => ({ url: a.url })),
    });

    this.displayMessage(msg);
  }

  displayMessage(msg: Message) {
    // Render message to UI
    const messageElement = document.createElement('div');
    messageElement.textContent = `${msg.username}: ${msg.text}`;
    document.getElementById('messages').appendChild(messageElement);
  }
}

// Usage
const chat = new ChatInterface({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.chatlayer.com',
  listenerType: 'ui',
});

chat.connect('main-bot', 'room-123');
```

---

### Scenario 2: Third-Party Developer Integration

```typescript
import Botoraptor from './botoraptor';

// Initialize SDK with your API key
const chatLayer = new Botoraptor({
  apiKey: process.env.BOTORAPTOR_API_KEY ?? process.env.CHATLAYER_API_KEY,
  baseUrl: 'https://api.chatlayer.com',
  botIds: ['your-bot-id'],
});

// Set up message handlers
chatLayer.onMessage(async (msg) => {
  console.log('Received from bot:', msg.botId, msg.text);

  // Respond to specific keywords
  if (msg.text.includes('hello')) {
    await chatLayer.addMessage({
      ...msg,
      text: 'Hello! How can I help you today?',
    });
  }

  if (msg.text.includes('status')) {
    const bots = await chatLayer.getBots();
    await chatLayer.addMessage({
      ...msg,
      text: `I have access to ${bots.length} bots.`,
    });
  }
});

// Handle file uploads
chatLayer.onMessage(async (msg) => {
  if (msg.attachments?.length > 0) {
    for (const attachment of msg.attachments) {
      console.log('File uploaded:', attachment.url);
      // Process the file...
    }
  }
});

// Start listening
chatLayer.start();

console.log('Botoraptor bot is running...');
```

---

## 🔒 Error Handling

The SDK throws errors on API failures. Always wrap calls in try/catch:

```typescript
try {
  const msg = await chatLayer.addMessage({
    botId: 'bot-1',
    roomId: 'room-123',
    userId: 'user-456',
    text: 'Hello!',
  });
} catch (error) {
  console.error('Failed to send message:', error.message);
  // Implement retry logic or notify user
}
```

**Common Error Messages:**
- `addMessage failed: 401 Unauthorized` - Invalid API key
- `addMessage failed: 404 Not Found` - Bot ID or room ID doesn't exist
- `addMessage error: "message text is required"` - Missing required fields
- `getUpdates failed: 500 Server Error` - Server-side issue

---

## 📝 Notes

- SDK expects server responses in format: `{ success: boolean, data: any, errorMessage?: string }`
- Relative attachment URLs are automatically normalized to absolute URLs
- Long-polling uses exponential backoff (1s → 1.5s → 2.25s → ... → 30s max)
- Listener callbacks don't throw - errors are caught and logged
- Multiple `onMessage` callbacks can be registered; all will receive messages
- `start()` can be called multiple times (reuses existing listeners)
- `stop()` gracefully aborts ongoing polling requests

---

## 📄 License

MIT

---

## 🤝 Contributing

This SDK is used by both the main web application and external integrators. When contributing:

- Maintain backward compatibility
- Support both browser and Node.js environments
- Include comprehensive type definitions
- Provide clear error messages
- Document all methods and options

---

## 📮 Support

For issues, questions, or contributions:
- Check the API documentation
- Review this README for common patterns
- Report bugs with error messages and stack traces
