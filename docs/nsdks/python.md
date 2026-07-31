---
node_type: reference
title: Python SDK Reference
status: active
updated: 2026-07-16 (code-synced)
tags: [sdk, nsdk, python]
links:
  depends_on: [/core/server.md]
  documents: [/sdk-templates/python/]
  relates_to: [/nsdks/node.md, /nsdks/go.md, /nsdks/php.md]
---

# Python SDK Reference

Async Python SDK for Botoraptor — httpx + pydantic.

---

## Overview

An async-first Python client for integrating bots with Botoraptor. Uses `httpx` for HTTP and `pydantic` for type validation.

The SDK exports both `Botoraptor` (preferred) and `ChatLayer` (legacy compatibility alias). The package `chatlayer_sdk` remains available during transition.

**Scope Boundary:**

- **This component owns**: HTTP communication, response parsing, async polling loop
- **This component does NOT own**: Message storage, bot logic
- **Boundary interfaces**: Calls Botoraptor server REST API

---

## Installation

```bash
pip install chatlayer-sdk
```

---

## Quick Start

```python
import asyncio
from botoraptor_sdk import Botoraptor, Message

async def main():
    client = Botoraptor(
        api_key="your-api-key",
        base_url="http://localhost:31000",
        bot_ids=["my-bot"],
        listener_type="bot",
    )

    # Listen for messages
    async def on_message(msg):
        print(f"Received: {msg.text}")

    client.on_message(on_message)
    client.start()

    # Send a message
    msg = Message(
        bot_id="my-bot",
        room_id="room-123",
        user_id="user-456",
        text="Hello!",
    )
    await client.add_message(msg)

    # Run for a while
    await asyncio.sleep(60)

    client.stop()
    await client.close()

asyncio.run(main())
```

---

## Configuration

```python
from botoraptor_sdk import Botoraptor, ChatLayerConfig  # or BotoraptorConfig (alias)

config = ChatLayerConfig(
    api_key="your-api-key",
    base_url="https://api.example.com",
    bot_ids=["bot-1", "bot-2"],
    listener_type="bot",
    timeout_ms=60000,
    poll_delay_ms=1000,
)

client = Botoraptor(**config.model_dump())
```

---

## Core Methods

### Message Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `add_message` | `(message: Message)` | Send a message (takes a `Message` object) |
| `add_manager_message` | `(bot_id, room_id, user_id, text, **kwargs)` | Send as manager |
| `send_service_alert` | `(bot_id, room_id, user_id, text, **kwargs)` | Send system alert |
| `get_messages` | `(bot_id=None, room_id=None, limit=None, cursor_id=None, types=None)` | Fetch messages with pagination |

### File Operations

| Method | Description |
|--------|-------------|
| `upload_file(bytes, options)` | Upload file bytes |
| `upload_file_by_url(files)` | Upload from URLs |
| `add_message_single(msg, file, options)` | Send message with file |

### Query Operations

| Method | Description |
|--------|-------------|
| `get_bots()` | List all bot IDs |
| `get_rooms(bot_id=None, message_type=None, depth=None)` | Get room information |
| `get_client_config()` | Get client configuration |

### User Operations

| Method | Description |
|--------|-------------|
| `add_user(bot_id, user_id, username, name)` | Create or return a user |

### Real-time

| Method | Description |
|--------|-------------|
| `on_message(callback)` | Register async message handler |
| `start(bot_ids=None, listener_type=None)` | Start long-polling |
| `stop()` | Stop polling |
| `close()` | Close HTTP session |

### Class Methods

| Method | Description |
|--------|-------------|
| `from_config(cls, config)` | Create client from `ChatLayerConfig` object |

---

## Types

```python
from botoraptor_sdk import (
    Message, MessageType, Attachment, AttachmentType,
    User, RoomInfo, BotoraptorError, BotoraptorAPIError,
)

# Message type enum
class MessageType(str, Enum):
    USER_MESSAGE = "user_message"
    USER_MESSAGE_SERVICE = "user_message_service"
    BOT_MESSAGE_SERVICE = "bot_message_service"
    MANAGER_MESSAGE = "manager_message"
    SERVICE_CALL = "service_call"
    ERROR_MESSAGE = "error_message"

# Attachment type enum
class AttachmentType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    DOCUMENT = "document"
    FILE = "file"

# Listener type enum
class ListenerType(str, Enum):
    BOT = "bot"
    UI = "ui"

# Message model
message = Message(
    bot_id="bot-1",
    room_id="room-1",
    user_id="user-1",
    username="john_doe",
    text="Hello world",
    message_type=MessageType.USER_MESSAGE,
)

# Attachment model
attachment = Attachment(
    type=AttachmentType.IMAGE,
    url="https://example.com/image.jpg",
    filename="photo.jpg",
)
```

**Additional Models:**
- `User` — User data (botId, userId, username, name, blocked, createdAt)
- `RoomInfo` — Room summary (botId, roomId, users, lastMessage)
- `FileUploadOptions` — File upload options
- `FileUploadByUrlOptions` — URL upload options
- `GetMessagesParams` — Message query parameters
- `GetRoomsParams` — Room query parameters
- `ServerResponse` — Generic API response wrapper
- `RoomsResponse` — GetRooms response

---

## Context Manager

Recommended for proper resource cleanup:

```python
async with Botoraptor(api_key="key", base_url="...") as client:
    msg = Message(bot_id="bot-1", room_id="room-1", user_id="user-1", text="Hello")
    message = await client.add_message(msg)
    # Automatic cleanup on exit (close() called)
```

---

## Long-Polling

```python
async def handle_message(msg):
    print(f"New message: {msg.text}")

client.on_message(handle_message)
client.start()

# Later...
client.stop()
await client.close()
```

**Behavior:**
- Async polling loop runs in background
- Exponential backoff on errors
- Graceful shutdown on `stop()`

---

## Error Handling

```python
from botoraptor_sdk import BotoraptorError, BotoraptorAPIError

try:
    await client.add_message(...)
except BotoraptorAPIError as e:
    print(f"API error {e.status_code}: {e.response_text}")
except BotoraptorError as e:
    print(f"SDK error: {e}")
```

---

## Requirements

- Python 3.10+
- `httpx` — HTTP client
- `pydantic` — Data validation

---

## Implementation Pointers

- **SDK package**: `sdk-templates/python/chatlayer_sdk/`
- **Models**: `chatlayer_sdk/models.py`
- **Client**: `chatlayer_sdk/client.py`
