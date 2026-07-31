# Botoraptor SDK (Python)

Async Python SDK for Botoraptor. Uses httpx + pydantic.

Legacy `chatlayer_sdk` imports remain supported, but new integrations should import `Botoraptor` from `botoraptor_sdk`.

## Installation

```bash
pip install chatlayer-sdk
```

## Quick Start

```python
import asyncio
from botoraptor_sdk import Botoraptor

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
    await client.add_message({
        "bot_id": "my-bot",
        "room_id": "room-123",
        "user_id": "user-456",
        "text": "Hello!",
    })

    await asyncio.sleep(60)
    client.stop()
    await client.close()

asyncio.run(main())
```

## Configuration

```python
client = Botoraptor(
    api_key="your-api-key",
    base_url="https://api.example.com",
    bot_ids=["bot-1"],
    listener_type="bot",  # or "ui"
    timeout_ms=60000,
)
```

## Core Methods

| Method | Description |
|--------|-------------|
| `add_message(msg)` | Send a message |
| `add_manager_message(msg)` | Send as manager |
| `get_messages(params)` | Fetch messages |
| `get_bots()` | List bot IDs |
| `get_rooms(params)` | Get room info |
| `upload_file(bytes, opts)` | Upload file |
| `on_message(cb)` | Register handler |
| `start()` | Start polling |
| `stop()` | Stop polling |

## Context Manager

```python
async with Botoraptor(api_key="key", base_url="...") as client:
    await client.add_message({...})
```

## Requirements

- Python 3.10+
- `httpx`
- `pydantic`

## Documentation

- **API Reference**: [docs/arch_server.md](../docs/arch_server.md)
- **SDK Architecture**: [docs/arch_sdk-python.md](../docs/arch_sdk-python.md)

## License

ISC
