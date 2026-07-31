"""
Pydantic models for ChatLayer SDK.

These models mirror the TypeScript types from the Node.js SDK for type parity.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AttachmentType(str, Enum):
    """Attachment type enumeration."""

    IMAGE = "image"
    VIDEO = "video"
    DOCUMENT = "document"
    FILE = "file"


class MessageType(str, Enum):
    """Message type enumeration."""

    USER_MESSAGE = "user_message"
    USER_MESSAGE_SERVICE = "user_message_service"
    BOT_MESSAGE_SERVICE = "bot_message_service"
    MANAGER_MESSAGE = "manager_message"
    SERVICE_CALL = "service_call"
    ERROR_MESSAGE = "error_message"
    EVENT = "event"


class ListenerType(str, Enum):
    """Listener type for polling."""

    BOT = "bot"
    UI = "ui"


class Attachment(BaseModel):
    """
    Attachment model representing a file attachment in a message.

    Mirrors the TypeScript Attachment type from the SDK.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str | None = None
    type: AttachmentType
    is_external: bool | None = Field(default=None, alias="isExternal")
    url: str | None = None
    filename: str | None = None
    original_name: str | None = Field(default=None, alias="original_name")
    mime_type: str | None = Field(default=None, alias="mime_type")
    size: int | None = None
    created_at: datetime | None = Field(default=None, alias="createdAt")


class Message(BaseModel):
    """
    Message model representing a chat message.

    Mirrors the TypeScript Message type from the SDK.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str | None = None
    bot_id: str = Field(alias="botId")
    room_id: str = Field(alias="roomId")
    user_id: str = Field(alias="userId")
    username: str | None = None
    name: str | None = None
    text: str | None = None
    message_type: MessageType | str | None = Field(default=None, alias="messageType")
    attachments: list[Attachment] | None = None
    meta: dict[str, Any] | None = None
    tags: list[str] | None = None
    created_at: datetime | None = Field(default=None, alias="createdAt")


class User(BaseModel):
    """
    User model representing a chat user.

    Mirrors the TypeScript User type from the SDK.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: int | None = None
    bot_id: str = Field(alias="botId")
    user_id: str = Field(alias="userId")
    username: str
    name: str | None = None
    created_at: datetime | None = Field(default=None, alias="createdAt")
    blocked: bool | None = None


class RoomInfo(BaseModel):
    """
    Room information model.

    Mirrors the TypeScript RoomInfo type from the SDK.
    """

    model_config = ConfigDict(populate_by_name=True)

    bot_id: str = Field(alias="botId")
    room_id: str = Field(alias="roomId")
    users: list[User]
    last_message: Message | None = Field(default=None, alias="lastMessage")


class ChatLayerConfig(BaseModel):
    """
    Configuration for ChatLayer SDK client.

    Mirrors the TypeScript ChatLayerConfig type from the SDK.
    """

    model_config = ConfigDict(populate_by_name=True)

    api_key: str = Field(alias="apiKey")
    base_url: str | None = Field(default="/", alias="baseUrl")
    bot_id: str | None = Field(default=None, alias="botId")
    bot_ids: list[str] | None = Field(default=None, alias="botIds")
    listener_type: ListenerType | None = Field(default=None, alias="listenerType")
    timeout_ms: int | None = Field(default=60000, alias="timeoutMs")
    poll_delay_ms: int | None = Field(default=1000, alias="pollDelayMs")
    on_error: Any | None = Field(default=None, alias="onError")


BotoraptorConfig = ChatLayerConfig


class FileUploadOptions(BaseModel):
    """Options for file upload operations."""

    model_config = ConfigDict(populate_by_name=True)

    type: AttachmentType | None = None
    filename: str | None = None
    mime: str | None = None


class FileUploadByUrlOptions(BaseModel):
    """Options for uploading files by URL."""

    model_config = ConfigDict(populate_by_name=True)

    url: str
    filename: str | None = None
    type: AttachmentType | None = None


class GetMessagesParams(BaseModel):
    """Parameters for get_messages method."""

    model_config = ConfigDict(populate_by_name=True)

    bot_id: str | None = Field(default=None, alias="botId")
    room_id: str | None = Field(default=None, alias="roomId")
    limit: int | None = None
    cursor_id: int | str | None = Field(default=None, alias="cursorId")
    types: str | None = None


class GetRoomsParams(BaseModel):
    """Parameters for get_rooms method."""

    model_config = ConfigDict(populate_by_name=True)

    bot_id: str | None = Field(default=None, alias="botId")
    message_type: MessageType | str | None = Field(default=None, alias="messageType")
    depth: int | None = None
    tags: str | None = None


class ServerResponse(BaseModel):
    """Generic server response wrapper."""

    model_config = ConfigDict(populate_by_name=True)

    success: bool
    error_message: str | None = Field(default=None, alias="errorMessage")
    data: Any | None = None


class RoomsResponse(BaseModel):
    """Response from get_rooms endpoint."""

    model_config = ConfigDict(populate_by_name=True)

    rooms: list[RoomInfo]
