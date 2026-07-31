"""Tests for ChatLayer SDK models."""

import pytest
from datetime import datetime

from botoraptor_sdk import Botoraptor, BotoraptorConfig
from chatlayer_sdk import ChatLayer
from chatlayer_sdk.models import (
    Attachment,
    AttachmentType,
    ChatLayerConfig,
    FileUploadOptions,
    ListenerType,
    Message,
    MessageType,
    RoomInfo,
    User,
)


class TestAttachment:
    """Tests for Attachment model."""

    def test_attachment_creation(self):
        """Test creating an attachment."""
        attachment = Attachment(
            id="att-1",
            type=AttachmentType.IMAGE,
            url="https://example.com/image.jpg",
            filename="image.jpg",
        )
        assert attachment.id == "att-1"
        assert attachment.type == AttachmentType.IMAGE
        assert attachment.url == "https://example.com/image.jpg"
        assert attachment.filename == "image.jpg"

    def test_attachment_from_dict(self):
        """Test creating attachment from dict with aliases."""
        data = {
            "id": "att-1",
            "type": "document",
            "url": "/files/doc.pdf",
            "mime_type": "application/pdf",
            "original_name": "document.pdf",
            "isExternal": True,
        }
        attachment = Attachment.model_validate(data)
        assert attachment.type == AttachmentType.DOCUMENT
        assert attachment.mime_type == "application/pdf"
        assert attachment.is_external is True


class TestMessage:
    """Tests for Message model."""

    def test_message_creation(self):
        """Test creating a message."""
        message = Message.model_construct(
            botId="bot-1",
            roomId="room-1",
            userId="user-1",
            text="Hello!",
            messageType=MessageType.USER_MESSAGE,
        )
        assert message.bot_id == "bot-1"
        assert message.room_id == "room-1"
        assert message.user_id == "user-1"
        assert message.text == "Hello!"
        assert message.message_type == MessageType.USER_MESSAGE

    def test_message_with_attachments(self):
        """Test message with attachments."""
        attachment = Attachment(
            type=AttachmentType.IMAGE,
            url="https://example.com/img.jpg",
        )
        attachment_dict = attachment.model_dump(by_alias=True, exclude_none=True)
        message = Message.model_validate(
            {
                "botId": "bot-1",
                "roomId": "room-1",
                "userId": "user-1",
                "text": "Check this out!",
                "attachments": [attachment_dict],
            }
        )
        assert len(message.attachments) == 1
        assert message.attachments[0].type == AttachmentType.IMAGE

    def test_message_from_dict(self):
        """Test creating message from dict with aliases."""
        data = {
            "id": "msg-1",
            "botId": "bot-1",
            "roomId": "room-1",
            "userId": "user-1",
            "text": "Hello",
            "messageType": "bot_message_service",
            "createdAt": "2024-01-15T10:30:00Z",
        }
        message = Message.model_validate(data)
        assert message.bot_id == "bot-1"
        assert message.message_type == MessageType.BOT_MESSAGE_SERVICE


class TestUser:
    """Tests for User model."""

    def test_user_creation(self):
        """Test creating a user."""
        user_data = {
            "botId": "bot-1",
            "userId": "user-1",
            "username": "john_doe",
            "name": "John Doe",
        }
        user = User.model_validate(user_data)
        assert user.bot_id == "bot-1"
        assert user.user_id == "user-1"
        assert user.username == "john_doe"
        assert user.name == "John Doe"


class TestRoomInfo:
    """Tests for RoomInfo model."""

    def test_room_info_creation(self):
        """Test creating room info."""
        user = User.model_validate(
            {
                "botId": "bot-1",
                "userId": "user-1",
                "username": "john",
            }
        )
        user_dict = user.model_dump(by_alias=True)
        message = Message.model_validate(
            {
                "botId": "bot-1",
                "roomId": "room-1",
                "userId": "user-1",
                "text": "Last message",
            }
        )
        message_dict = message.model_dump(by_alias=True)
        room = RoomInfo.model_validate(
            {
                "botId": "bot-1",
                "roomId": "room-1",
                "users": [user_dict],
                "lastMessage": message_dict,
            }
        )
        assert room.bot_id == "bot-1"
        assert len(room.users) == 1
        assert room.last_message.text == "Last message"


class TestChatLayerConfig:
    """Tests for ChatLayerConfig model."""

    def test_config_creation(self):
        """Test creating config."""
        config = ChatLayerConfig.model_validate(
            {
                "apiKey": "test-key",
                "baseUrl": "https://api.example.com",
                "botIds": ["bot-1", "bot-2"],
                "listenerType": ListenerType.BOT,
                "timeoutMs": 30000,
                "pollDelayMs": 500,
            }
        )
        assert config.api_key == "test-key"
        assert config.base_url == "https://api.example.com"
        assert config.bot_ids == ["bot-1", "bot-2"]
        assert config.listener_type == ListenerType.BOT
        assert config.timeout_ms == 30000
        assert config.poll_delay_ms == 500

    def test_config_defaults(self):
        """Test config defaults."""
        config = ChatLayerConfig.model_validate({"apiKey": "test-key"})
        assert config.base_url == "/"
        assert config.timeout_ms == 60000
        assert config.poll_delay_ms == 1000


class TestFileUploadOptions:
    """Tests for FileUploadOptions model."""

    def test_options_creation(self):
        """Test creating upload options."""
        options = FileUploadOptions(
            type=AttachmentType.IMAGE,
            filename="photo.jpg",
            mime="image/jpeg",
        )
        assert options.type == AttachmentType.IMAGE
        assert options.filename == "photo.jpg"
        assert options.mime == "image/jpeg"


class TestBotoraptorAliases:
    """Tests for Botoraptor compatibility aliases."""

    def test_botoraptor_class_alias(self):
        """Test that Botoraptor resolves to the ChatLayer client."""
        assert Botoraptor is ChatLayer

    def test_botoraptor_config_alias(self):
        """Test that BotoraptorConfig reuses ChatLayerConfig."""
        assert BotoraptorConfig is ChatLayerConfig
