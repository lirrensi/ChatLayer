"""
ChatLayer SDK - Async Python client for ChatLayer server integration.

This SDK provides a unified async API for:
- Message handling (sending, receiving, and managing)
- File uploads (single and multiple, with various source types)
- Real-time updates via long-polling
- User and bot management

Example:
    import asyncio
    from chatlayer_sdk import ChatLayer, Message

    async def main():
        client = ChatLayer(api_key="your-api-key", base_url="https://api.example.com")

        # Send a message
        message = await client.add_message(
            bot_id="my-bot",
            room_id="room-123",
            user_id="user-456",
            text="Hello, world!"
        )
        print(f"Sent message: {message.id}")

        # Listen for messages
        def on_message(msg):
            print(f"Received: {msg.text}")

        unsubscribe = client.on_message(on_message)
        client.start()

        # Run for a while...
        await asyncio.sleep(60)

        # Cleanup
        client.stop()
        await client.close()

    asyncio.run(main())
"""

from .client import (
    Botoraptor,
    BotoraptorAPIError,
    BotoraptorError,
    ChatLayer,
    ChatLayerAPIError,
    ChatLayerError,
)
from .models import (
    Attachment,
    AttachmentType,
    BotoraptorConfig,
    ChatLayerConfig,
    FileUploadByUrlOptions,
    FileUploadOptions,
    GetMessagesParams,
    GetRoomsParams,
    ListenerType,
    Message,
    MessageType,
    RoomInfo,
    RoomsResponse,
    ServerResponse,
    User,
)

__version__ = "1.4.0"
__all__ = [
    # Client
    "Botoraptor",
    "BotoraptorError",
    "BotoraptorAPIError",
    "ChatLayer",
    "ChatLayerError",
    "ChatLayerAPIError",
    # Models
    "Attachment",
    "AttachmentType",
    "BotoraptorConfig",
    "ChatLayerConfig",
    "FileUploadByUrlOptions",
    "FileUploadOptions",
    "GetMessagesParams",
    "GetRoomsParams",
    "ListenerType",
    "Message",
    "MessageType",
    "RoomInfo",
    "RoomsResponse",
    "ServerResponse",
    "User",
]
