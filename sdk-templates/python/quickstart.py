#!/usr/bin/env python3
"""
Quick start script for Botoraptor SDK.
Run this to see basic usage examples.
"""

import asyncio
from botoraptor_sdk import Botoraptor, Message


async def quickstart():
    print("Botoraptor SDK Quickstart")
    print("=" * 60)
    print("\nThis example shows basic SDK usage.")
    print("Replace 'your-api-key' with your actual API key to run with real data.\n")

    # Initialize client
    client = Botoraptor(api_key="your-api-key", base_url="https://api.example.com")

    try:
        # Example 1: Send a message
        print("1. Sending a message...")
        message = await client.add_message(
            Message.model_construct(
                botId="my-bot",
                roomId="room-123",
                userId="user-456",
                text="Hello from Python SDK!",
            )
        )
        print(f"   ✓ Message sent! ID: {message.id}")

        # Example 2: Get messages
        print("\n2. Fetching messages...")
        messages = await client.get_messages(bot_id="my-bot", room_id="room-123", limit=5)
        print(f"   ✓ Found {len(messages)} messages")

        # Example 3: Get bots
        print("\n3. Listing bots...")
        bots = await client.get_bots()
        print(f"   ✓ Available bots: {bots}")

        print("\n" + "=" * 60)
        print("Quickstart complete! ✓")
        print("\nFor more examples, run: python example.py")

    except Exception as e:
        print(f"\n✗ Error: {e}")
        print("\nNote: This is a quickstart example. Replace 'your-api-key' with")
        print("      your actual API key to run with a live connection.")

    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(quickstart())
