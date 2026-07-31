"""
Example usage of Botoraptor SDK.

This example demonstrates:
1. Sending messages
2. Listening for real-time messages
3. File uploads
4. Query operations
"""

import asyncio
from botoraptor_sdk import (
    Botoraptor,
    Message,
    MessageType,
    AttachmentType,
    FileUploadOptions,
    FileUploadByUrlOptions,
    BotoraptorError,
    BotoraptorAPIError,
)


async def example_basic_message():
    """Example 1: Basic message sending."""
    print("\n=== Example 1: Basic Message ===")

    client = Botoraptor(api_key="your-api-key-here", base_url="https://api.example.com")

    try:
        message = await client.add_message(
            Message.model_construct(
                botId="my-bot",
                roomId="room-123",
                userId="user-456",
                text="Hello, world from Python SDK!",
            )
        )
        print(f"✓ Message sent successfully!")
        print(f"  ID: {message.id}")
        print(f"  Text: {message.text}")
    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def example_message_with_manager():
    """Example 2: Send message as manager."""
    print("\n=== Example 2: Manager Message ===")

    client = Botoraptor(api_key="your-api-key-here", base_url="https://api.example.com")

    try:
        manager_message = await client.add_manager_message(
            bot_id="my-bot",
            room_id="room-123",
            user_id="manager-789",
            text="I've taken over this conversation to help you.",
        )
        print(f"✓ Manager message sent successfully!")
        print(f"  ID: {manager_message.id}")
        print(f"  Type: {manager_message.message_type}")
    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def example_service_alert():
    """Example 3: Send service alert."""
    print("\n=== Example 3: Service Alert ===")

    client = Botoraptor(api_key="your-api-key-here", base_url="https://api.example.com")

    try:
        alert = await client.send_service_alert(
            bot_id="my-bot",
            room_id="room-123",
            user_id="system",
            text="⚠️ System maintenance scheduled for tonight at 2 AM UTC",
        )
        print(f"✓ Service alert sent successfully!")
        print(f"  ID: {alert.id}")
    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def example_message_with_file_upload():
    """Example 4: Send message with file upload."""
    print("\n=== Example 4: Message with File Upload ===")

    client = Botoraptor(api_key="your-api-key-here", base_url="https://api.example.com")

    try:
        # Read file bytes (in real usage, this would come from a file)
        # For demo, we'll create a simple text file
        file_bytes = b"Hello, this is file content!"

        message = await client.add_message_single(
            message=Message.model_construct(
                botId="my-bot",
                roomId="room-123",
                userId="user-456",
                text="Here's a file for you:",
            ),
            file_or_files=file_bytes,
            options=FileUploadOptions(
                type=AttachmentType.DOCUMENT, filename="demo.txt", mime="text/plain"
            ),
        )
        print(f"✓ Message with file uploaded successfully!")
        print(f"  ID: {message.id}")
        if message.attachments:
            print(f"  Attachment: {message.attachments[0].url}")
    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def example_message_with_file_by_url():
    """Example 5: Send message with file uploaded from URL."""
    print("\n=== Example 5: Message with File from URL ===")

    client = Botoraptor(api_key="your-api-key-here", base_url="https://api.example.com")

    try:
        message = await client.add_message_single(
            message=Message.model_construct(
                botId="my-bot",
                roomId="room-123",
                userId="user-456",
                text="Check out this image:",
            ),
            file_or_files=[],  # Empty list since we're using URLs
            options=[FileUploadOptions(type=AttachmentType.IMAGE)],
        )
        print(f"✓ Message with URL upload initiated!")
        print(f"  ID: {message.id}")
    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def example_real_time_listening():
    """Example 6: Real-time message listening."""
    print("\n=== Example 6: Real-time Message Listening ===")
    print("(This example will listen for 10 seconds)")

    client = Botoraptor(
        api_key="your-api-key-here",
        base_url="https://api.example.com",
        bot_ids=["my-bot"],
    )

    message_count = 0

    def on_message(msg):
        nonlocal message_count
        message_count += 1
        print(f"  [{message_count}] [{msg.bot_id}] {msg.username}: {msg.text}")

    try:
        # Register handler
        unsubscribe = client.on_message(on_message)

        # Start listening
        client.start()
        print("✓ Listening started...")

        # Run for 10 seconds
        await asyncio.sleep(10)

        # Cleanup
        unsubscribe()
        client.stop()
        print(f"✓ Received {message_count} messages in 10 seconds")

    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def example_query_operations():
    """Example 7: Query operations."""
    print("\n=== Example 7: Query Operations ===")

    client = Botoraptor(api_key="your-api-key-here", base_url="https://api.example.com")

    try:
        # Get bots
        bots = await client.get_bots()
        print(f"✓ Bots: {bots}")

        # Get rooms
        rooms = await client.get_rooms(bot_id="my-bot")
        print(f"✓ Rooms: {len(rooms)} rooms")

        # Get messages
        messages = await client.get_messages(bot_id="my-bot", room_id="room-123", limit=5)
        print(f"✓ Messages: {len(messages)} messages")

        # Get client config
        config = await client.get_client_config()
        print(f"✓ Client config retrieved")

    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def example_user_management():
    """Example 8: User management."""
    print("\n=== Example 8: User Management ===")

    client = Botoraptor(api_key="your-api-key-here", base_url="https://api.example.com")

    try:
        # Add user
        user = await client.add_user(
            bot_id="my-bot", user_id="new-user-999", username="newuser", name="New User"
        )
        print(f"✓ User added/updated: {user.username}")

        # Get messages for this user
        messages = await client.get_messages(bot_id="my-bot", limit=10)
        print(f"✓ {len(messages)} recent messages fetched for verification")

    except BotoraptorAPIError as e:
        print(f"✗ API error: {e.status_code} - {e.response_text}")
    except BotoraptorError as e:
        print(f"✗ SDK error: {e}")
    finally:
        await client.close()


async def main():
    """Run all examples."""
    print("=" * 60)
    print("Botoraptor SDK - Python Examples")
    print("=" * 60)
    print("\n⚠️  Note: Replace 'your-api-key-here' with your actual API key")
    print("      to run these examples with a real connection.\n")

    examples = [
        example_basic_message,
        example_message_with_manager,
        example_service_alert,
        example_message_with_file_upload,
        example_message_with_file_by_url,
        example_real_time_listening,
        example_query_operations,
        example_user_management,
    ]

    for example in examples:
        try:
            await example()
        except Exception as e:
            print(f"\n✗ Unexpected error in {example.__name__}: {e}")
            import traceback

            traceback.print_exc()

        # Brief pause between examples
        await asyncio.sleep(1)

    print("\n" + "=" * 60)
    print("All examples completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
