"""
ChatLayer SDK - Async Python client for ChatLayer server integration.

This SDK provides a unified async API for:
- Message handling (sending, receiving, and managing)
- File uploads (single and multiple, with various source types)
- Real-time updates via long-polling
- User and bot management

Usage:
    from chatlayer_sdk import ChatLayer

    client = ChatLayer(api_key="your-api-key", base_url="https://api.example.com")

    # Send a message
    message = await client.add_message(
        bot_id="my-bot",
        room_id="room-123",
        user_id="user-456",
        text="Hello, world!"
    )
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from typing import Any

import httpx

from .models import (
    Attachment,
    ChatLayerConfig,
    FileUploadByUrlOptions,
    FileUploadOptions,
    ListenerType,
    Message,
    MessageType,
    RoomInfo,
    User,
)

logger = logging.getLogger(__name__)


class ChatLayerError(Exception):
    """Base exception for ChatLayer SDK errors."""

    pass


class ChatLayerAPIError(ChatLayerError):
    """Exception raised for API errors."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_text: str | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text


class ChatLayer:
    """
    Async ChatLayer SDK client.

    This is the main entry point for interacting with the ChatLayer server.
    All methods are async and use httpx for HTTP requests.

    Example:
        client = ChatLayer(api_key="your-key", base_url="https://api.example.com")

        # Send a message
        msg = await client.add_message(
            bot_id="bot-1",
            room_id="room-1",
            user_id="user-1",
            text="Hello!"
        )

        # Start listening for messages
        client.on_message(lambda m: print(f"Received: {m.text}"))
        client.start()

        # Stop listening
        client.stop()
        await client.close()
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "/",
        bot_id: str | None = None,
        bot_ids: list[str] | None = None,
        listener_type: ListenerType | str | None = None,
        timeout_ms: int = 60000,
        poll_delay_ms: int = 1000,
        on_error: Callable[[Exception], None] | None = None,
    ):
        """
        Initialize the ChatLayer client.

        Args:
            api_key: API key for authentication (required)
            base_url: Base URL for the ChatLayer server (default: "/")
            bot_id: Legacy single bot ID (optional)
            bot_ids: List of bot IDs to listen for (optional)
            listener_type: Listener role - "bot" or "ui" (default: inferred from bot_ids/bot_id)
            timeout_ms: Long-polling server timeout in milliseconds (default: 60000)
            poll_delay_ms: Retry delay on error in milliseconds (default: 1000)
            on_error: Optional error handler callback

        Raises:
            ChatLayerError: If api_key is not provided
        """
        if not api_key:
            raise ChatLayerError("api_key is required")

        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._bot_id = bot_id
        self._bot_ids = bot_ids or ([bot_id] if bot_id else None)
        self._listener_type = (
            ListenerType(listener_type)
            if listener_type
            else (ListenerType.BOT if (bot_ids or bot_id) else ListenerType.UI)
        )
        self._timeout_ms = timeout_ms
        self._poll_delay_ms = poll_delay_ms
        self._on_error = on_error

        # Polling state
        self._listeners: list[Callable[[Message], None]] = []
        self._running = False
        self._abort = False
        self._poll_task: asyncio.Task | None = None

        # HTTP client
        self._client: httpx.AsyncClient | None = None
        self._client_owned = True

    @classmethod
    def from_config(cls, config: ChatLayerConfig) -> ChatLayer:
        """Create a ChatLayer client from a ChatLayerConfig model."""
        return cls(
            api_key=config.api_key,
            base_url=config.base_url or "/",
            bot_id=config.bot_id,
            bot_ids=config.bot_ids,
            listener_type=config.listener_type,
            timeout_ms=config.timeout_ms or 60000,
            poll_delay_ms=config.poll_delay_ms or 1000,
            on_error=config.on_error,
        )

    def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=httpx.Timeout(self._timeout_ms / 1000 + 10),  # Add buffer for long polling
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client and stop any running polling."""
        self.stop()
        if self._poll_task:
            try:
                await asyncio.wait_for(self._poll_task, timeout=5.0)
            except asyncio.TimeoutError:
                self._poll_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._poll_task

        if self._client and self._client_owned:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> ChatLayer:
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit."""
        await self.close()

    def _handle_error(self, err: Exception) -> None:
        """Handle an error by calling the on_error callback and logging."""
        logger.error(f"[Botoraptor SDK] error: {err}")
        if self._on_error:
            with contextlib.suppress(Exception):
                self._on_error(err)

    def _ensure_absolute_url(self, url: str | None) -> str | None:
        """Convert relative URLs to absolute URLs using base_url."""
        if not url:
            return url
        if url.startswith(("http://", "https://")):
            return url
        return f"{self._base_url}{url if url.startswith('/') else f'/{url}'}"

    def _normalize_attachments(self, message: Message | None) -> None:
        """Normalize attachment URLs in a message."""
        if not message or not message.attachments:
            return
        for attachment in message.attachments:
            if attachment and attachment.url:
                attachment.url = self._ensure_absolute_url(attachment.url)

    def _normalize_attachments_list(self, messages: list[Message]) -> None:
        """Normalize attachment URLs in a list of messages."""
        for message in messages:
            self._normalize_attachments(message)

    def _extract_response(self, payload: dict[str, Any]) -> Any:
        """Extract data from server response, handling both legacy and new formats."""
        if payload is None:
            return None
        if "data" in payload:
            return payload["data"]
        # Remove metadata fields and return the rest
        return {k: v for k, v in payload.items() if k not in ("success", "errorMessage")}

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        json_data: dict[str, Any] | None = None,
        content: bytes | None = None,
        data: dict[str, Any] | None = None,
        files: list[tuple] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Make an HTTP request to the API."""
        client = self._get_client()
        url = f"{self._base_url}{path}"

        request_headers = dict(client.headers)
        if headers:
            request_headers.update(headers)

        try:
            if files:
                # Multipart form data
                response = await client.post(
                    url,
                    data=data,
                    files=files,
                    headers={
                        k: v for k, v in request_headers.items() if k.lower() != "content-type"
                    },
                )
            elif content:
                # Raw content
                response = await client.request(
                    method,
                    url,
                    params=params,
                    content=content,
                    headers=request_headers,
                )
            elif data:
                # Form data
                response = await client.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    headers=request_headers,
                )
            else:
                # JSON request
                response = await client.request(
                    method,
                    url,
                    params=params,
                    json=json_data,
                    headers=request_headers,
                )

            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            text = await e.response.aread() if hasattr(e.response, "aread") else str(e)
            err = ChatLayerAPIError(
                f"{method} {path} failed: {e.response.status_code} {text}",
                status_code=e.response.status_code,
                response_text=text.decode() if isinstance(text, bytes) else str(text),
            )
            self._handle_error(err)
            raise err from None
        except httpx.RequestError as e:
            err = ChatLayerAPIError(f"{method} {path} request error: {e}")
            self._handle_error(err)
            raise err from None

    # ==================== Message Methods ====================

    async def add_message(self, message: Message) -> Message:
        """
        Post a message to the server.

        Args:
            message: The message to send

        Returns:
            The created message as returned by the server

        Raises:
            ChatLayerAPIError: If the API request fails
        """
        payload = await self._request(
            "POST",
            "/api/v1/addMessage",
            json_data=message.model_dump(by_alias=True, exclude_none=True),
        )

        if not payload.get("success"):
            err = ChatLayerAPIError(f"add_message error: {payload.get('errorMessage', payload)}")
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        # Handle both new format { message: {...} } and legacy { data: <message> }
        if data and isinstance(data, dict) and "message" in data:
            msg = Message.model_validate(data["message"])
        elif data and isinstance(data, dict):
            msg = Message.model_validate(data)
        else:
            msg = Message.model_validate(payload.get("data", {}))

        self._normalize_attachments(msg)
        return msg

    async def add_manager_message(
        self,
        bot_id: str,
        room_id: str,
        user_id: str,
        text: str,
        **kwargs: Any,
    ) -> Message:
        """
        Send a message from a manager (human operator).

        This is a convenience method that automatically sets the message_type
        to 'manager_message' before sending.

        Args:
            bot_id: The bot ID
            room_id: The room ID
            user_id: The user ID
            text: The message text
            **kwargs: Additional message fields

        Returns:
            The created message
        """
        message = Message.model_construct(
            botId=bot_id,
            roomId=room_id,
            userId=user_id,
            text=text,
            messageType=MessageType.MANAGER_MESSAGE,
            **kwargs,
        )
        return await self.add_message(message)

    async def send_service_alert(
        self,
        bot_id: str,
        room_id: str,
        user_id: str,
        text: str,
        **kwargs: Any,
    ) -> Message:
        """
        Send a service alert or system notification message.

        This method sends a message with message_type set to 'service_call',
        typically used for system notifications and alerts.

        Args:
            bot_id: The bot ID
            room_id: The room ID
            user_id: The user ID
            text: The alert text
            **kwargs: Additional message fields

        Returns:
            The created message
        """
        message = Message.model_construct(
            botId=bot_id,
            roomId=room_id,
            userId=user_id,
            text=text,
            messageType=MessageType.SERVICE_CALL,
            **kwargs,
        )
        return await self.add_message(message)

    async def add_message_single(
        self,
        message: Message,
        file_or_files: bytes | list[bytes],
        options: FileUploadOptions | list[FileUploadOptions] | None = None,
    ) -> Message:
        """
        Create a message and upload file(s) in a single multipart/form-data request.

        Args:
            message: The message (must have bot_id, room_id, user_id)
            file_or_files: Single file bytes or list of file bytes
            options: Upload options for each file

        Returns:
            The created message with attachments

        Raises:
            ChatLayerError: If required fields are missing
            ChatLayerAPIError: If the API request fails
        """
        if not message.bot_id or not message.room_id or not message.user_id:
            err = ChatLayerError(
                "add_message_single: message.bot_id, message.room_id and message.user_id are required"
            )
            self._handle_error(err)
            raise err

        if not file_or_files:
            err = ChatLayerError("add_message_single: file is required")
            self._handle_error(err)
            raise err

        files_list = file_or_files if isinstance(file_or_files, list) else [file_or_files]
        opts_list = (
            options
            if isinstance(options, list)
            else [options or FileUploadOptions() for _ in files_list]
        )

        # Build form data
        data: dict[str, Any] = {
            "botId": message.bot_id,
            "roomId": message.room_id,
            "userId": message.user_id,
        }

        if message.username:
            data["username"] = message.username
        if message.name:
            data["name"] = message.name
        if message.message_type:
            data["messageType"] = str(message.message_type)
        if message.text:
            data["text"] = message.text
        if message.meta is not None:
            data["meta"] = message.meta if isinstance(message.meta, str) else str(message.meta)

        # Build files list for httpx
        httpx_files: list[tuple] = []
        types_list: list[str] = []
        filenames_list: list[str] = []

        for i, (file_bytes, opt) in enumerate(zip(files_list, opts_list)):
            filename = opt.filename or f"file_{i}"
            mime_type = opt.mime or "application/octet-stream"

            httpx_files.append(("file", (filename, file_bytes, mime_type)))
            if opt.type:
                types_list.append(str(opt.type))
            filenames_list.append(filename)

        # Add type and filename arrays
        for t in types_list:
            data.setdefault("type", []).append(t)
        for f in filenames_list:
            data.setdefault("filename", []).append(f)

        payload = await self._request(
            "POST",
            "/api/v1/addMessageSingle",
            data=data,
            files=httpx_files,
        )

        if not payload.get("success"):
            err = ChatLayerAPIError(
                f"add_message_single error: {payload.get('errorMessage', payload)}"
            )
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        if data and isinstance(data, dict) and "message" in data:
            msg = Message.model_validate(data["message"])
        elif data and isinstance(data, dict):
            msg = Message.model_validate(data)
        else:
            msg = Message.model_validate(payload.get("data", {}))

        self._normalize_attachments(msg)
        return msg

    # ==================== User Methods ====================

    async def add_user(
        self,
        bot_id: str,
        user_id: str,
        username: str,
        name: str | None = None,
    ) -> User:
        """
        Add or get a user.

        Args:
            bot_id: The bot ID
            user_id: The user ID
            username: The username
            name: Optional display name

        Returns:
            The created or existing user
        """
        user_data = {
            "botId": bot_id,
            "userId": user_id,
            "username": username,
        }
        if name:
            user_data["name"] = name

        payload = await self._request(
            "POST",
            "/api/v1/addUser",
            json_data=user_data,
        )

        if not payload.get("success"):
            err = ChatLayerAPIError(f"add_user error: {payload.get('errorMessage', payload)}")
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        if data and isinstance(data, dict) and "user" in data:
            return User.model_validate(data["user"])
        elif data and isinstance(data, dict):
            return User.model_validate(data)

        return User.model_validate(payload.get("data", {}))

    # ==================== Query Methods ====================

    async def get_messages(
        self,
        bot_id: str | None = None,
        room_id: str | None = None,
        limit: int | None = None,
        cursor_id: int | str | None = None,
        types: str | None = None,
    ) -> list[Message]:
        """
        Get messages from the server.

        Server returns newest-first (created_at desc). Use cursor_id to paginate
        older messages.

        Args:
            bot_id: Bot ID filter (defaults to constructor bot_id)
            room_id: Room ID filter
            limit: Maximum number of messages (server default is 20)
            cursor_id: Pagination cursor (message.id of last item)
            types: Message types filter

        Returns:
            List of messages
        """
        effective_bot_id = bot_id or self._bot_id
        if not effective_bot_id:
            raise ChatLayerError(
                "bot_id is required for get_messages (provide in params or constructor)"
            )

        params: dict[str, Any] = {"botId": effective_bot_id}
        if room_id:
            params["roomId"] = room_id
        if limit:
            params["limit"] = limit
        if cursor_id is not None:
            params["cursorId"] = cursor_id
        if types:
            params["types"] = types

        payload = await self._request(
            "GET",
            "/api/v1/getMessages",
            params=params,
        )

        if not payload.get("success"):
            err = ChatLayerAPIError(f"get_messages error: {payload.get('errorMessage', payload)}")
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        if isinstance(data, list):
            messages = [Message.model_validate(m) for m in data]
        elif isinstance(data, dict) and "messages" in data:
            messages = [Message.model_validate(m) for m in data["messages"]]
        elif isinstance(payload.get("data"), list):
            messages = [Message.model_validate(m) for m in payload["data"]]
        else:
            err = ChatLayerError("get_messages: unexpected payload shape")
            self._handle_error(err)
            raise err

        self._normalize_attachments_list(messages)
        return messages

    async def get_bots(self) -> list[str]:
        """
        Get list of bot IDs.

        Returns:
            List of bot ID strings
        """
        payload = await self._request("GET", "/api/v1/getBots")

        if not payload.get("success"):
            err = ChatLayerAPIError(f"get_bots error: {payload.get('errorMessage', payload)}")
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        if isinstance(data, list):
            return [str(b) for b in data]
        elif isinstance(data, dict) and "bots" in data:
            return [str(b) for b in data["bots"]]
        elif isinstance(payload.get("data"), dict) and "bots" in payload["data"]:
            return [str(b) for b in payload["data"]["bots"]]

        err = ChatLayerError("get_bots: unexpected payload shape")
        self._handle_error(err)
        raise err

    async def get_rooms(
        self,
        bot_id: str | None = None,
        message_type: MessageType | str | None = None,
        depth: int | None = None,
        tags: str | None = None,
    ) -> list[RoomInfo]:
        """
        Get rooms for a bot.

        Optional filtering by message_type with depth check: only returns rooms
        where the specified message type appears in the last `depth` messages.

        Args:
            bot_id: Bot ID (defaults to constructor bot_id)
            message_type: Filter by message type
            depth: Depth for message type filter
            tags: Comma-separated tags to filter rooms

        Returns:
            List of room information
        """
        effective_bot_id = bot_id or self._bot_id
        if not effective_bot_id:
            raise ChatLayerError(
                "bot_id is required for get_rooms (provide in params or constructor)"
            )

        params: dict[str, Any] = {"botId": effective_bot_id}
        if message_type:
            params["messageType"] = str(message_type)
        if depth is not None and depth > 0:
            params["depth"] = depth
        if tags:
            params["tags"] = tags

        payload = await self._request(
            "GET",
            "/api/v1/getRooms",
            params=params,
        )

        if not payload.get("success"):
            err = ChatLayerAPIError(f"get_rooms error: {payload.get('errorMessage', payload)}")
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        result: dict[str, Any] | None = None
        if isinstance(data, dict) and "rooms" in data:
            result = data
        elif isinstance(payload.get("data"), dict) and "rooms" in payload["data"]:
            result = payload["data"]

        if not result:
            err = ChatLayerError("get_rooms: unexpected payload shape")
            self._handle_error(err)
            raise err

        rooms = [RoomInfo.model_validate(r) for r in result["rooms"]]

        # Normalize attachment URLs in last_message for each room
        for room in rooms:
            if room.last_message:
                self._normalize_attachments(room.last_message)

        return rooms

    async def get_client_config(self) -> dict[str, Any]:
        """
        Get client configuration from the server.

        Returns:
            Client configuration dictionary
        """
        payload = await self._request("GET", "/api/v1/getClientConfig")

        if not payload.get("success"):
            err = ChatLayerAPIError(
                f"get_client_config error: {payload.get('errorMessage', payload)}"
            )
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        if isinstance(data, dict):
            return data

        err = ChatLayerError("get_client_config: unexpected payload shape")
        self._handle_error(err)
        raise err

    # ==================== File Upload Methods ====================

    async def upload_file(
        self,
        file_or_files: bytes | list[bytes],
        options: FileUploadOptions | list[FileUploadOptions] | None = None,
    ) -> list[Attachment]:
        """
        Upload file(s) to the server.

        This is the Python equivalent of uploadFileBuffer - for uploading
        file data as bytes.

        Args:
            file_or_files: Single file bytes or list of file bytes
            options: Upload options for each file

        Returns:
            List of attachment objects
        """
        if not file_or_files:
            err = ChatLayerError("upload_file: file is required")
            self._handle_error(err)
            raise err

        files_list = file_or_files if isinstance(file_or_files, list) else [file_or_files]
        opts_list = (
            options
            if isinstance(options, list)
            else [options or FileUploadOptions() for _ in files_list]
        )

        # Build form data
        data: dict[str, Any] = {}
        httpx_files: list[tuple] = []

        for _i, (file_bytes, opt) in enumerate(zip(files_list, opts_list)):
            if not opt.filename or not opt.type:
                err = ChatLayerError(
                    "upload_file: each file requires options.type and options.filename"
                )
                self._handle_error(err)
                raise err

            filename = opt.filename
            mime_type = opt.mime or "application/octet-stream"

            httpx_files.append(("file", (filename, file_bytes, mime_type)))
            data.setdefault("type", []).append(str(opt.type))
            data.setdefault("filename", []).append(filename)

        payload = await self._request(
            "POST",
            "/api/v1/uploadFile",
            data=data,
            files=httpx_files,
        )

        if not payload.get("success"):
            err = ChatLayerAPIError(f"upload_file error: {payload.get('errorMessage', payload)}")
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        attachments: list[Attachment] = []
        if isinstance(data, list):
            attachments = [Attachment.model_validate(a) for a in data]
        elif isinstance(data, dict) and "attachments" in data:
            attachments = [Attachment.model_validate(a) for a in data["attachments"]]
        elif isinstance(payload.get("data"), dict) and "attachments" in payload["data"]:
            attachments = [Attachment.model_validate(a) for a in payload["data"]["attachments"]]

        # Normalize attachment URLs
        for attachment in attachments:
            if attachment and attachment.url:
                attachment.url = self._ensure_absolute_url(attachment.url)

        return attachments

    async def upload_file_by_url(
        self,
        files: list[FileUploadByUrlOptions],
    ) -> list[Attachment]:
        """
        Upload files by providing their URLs.

        The server will download the files from the provided URLs.

        Args:
            files: List of file objects with url, optional filename and type

        Returns:
            List of attachment objects
        """
        if not files:
            err = ChatLayerError("upload_file_by_url: files list is required")
            self._handle_error(err)
            raise err

        payload = await self._request(
            "POST",
            "/api/v1/uploadFileByURL",
            json_data={"files": [f.model_dump(by_alias=True, exclude_none=True) for f in files]},
        )

        if not payload.get("success"):
            err = ChatLayerAPIError(
                f"upload_file_by_url error: {payload.get('errorMessage', payload)}"
            )
            self._handle_error(err)
            raise err

        data = self._extract_response(payload)

        attachments: list[Attachment] = []
        if isinstance(data, list):
            attachments = [Attachment.model_validate(a) for a in data]
        elif isinstance(data, dict) and "attachments" in data:
            attachments = [Attachment.model_validate(a) for a in data["attachments"]]
        elif isinstance(payload.get("data"), dict) and "attachments" in payload["data"]:
            attachments = [Attachment.model_validate(a) for a in payload["data"]["attachments"]]

        # Normalize attachment URLs
        for attachment in attachments:
            if attachment and attachment.url:
                attachment.url = self._ensure_absolute_url(attachment.url)

        return attachments

    # ==================== Polling Methods ====================

    def on_message(self, callback: Callable[[Message], None]) -> Callable[[], None]:
        """
        Register a callback for incoming messages.

        Args:
            callback: Function to call with each received message

        Returns:
            Unsubscribe function
        """
        self._listeners.append(callback)

        def unsubscribe() -> None:
            self._listeners = [c for c in self._listeners if c != callback]

        return unsubscribe

    def start(
        self,
        bot_ids: list[str] | None = None,
        listener_type: ListenerType | str | None = None,
    ) -> None:
        """
        Start the real-time message polling loop.

        Args:
            bot_ids: List of bot IDs to listen for (None for all bots)
            listener_type: Listener role - "bot" or "ui"

        Raises:
            ChatLayerError: If bot_ids are required but not provided
        """
        if self._running:
            return

        run_bot_ids = bot_ids if bot_ids is not None else self._bot_ids
        run_listener_type = ListenerType(listener_type) if listener_type else self._listener_type

        if run_listener_type == ListenerType.BOT and (not run_bot_ids or len(run_bot_ids) == 0):
            raise ChatLayerError(
                "bot_ids are required to start polling for listener_type=bot. "
                "Provide them in constructor or start()"
            )

        self._bot_ids = run_bot_ids
        self._listener_type = run_listener_type
        self._running = True
        self._abort = False

        # Start polling in background
        self._poll_task = asyncio.create_task(self._poll_loop())

    def stop(self) -> None:
        """Stop the real-time message polling loop."""
        self._abort = True
        self._running = False

    async def _poll_loop(self) -> None:
        """Internal polling loop."""
        backoff = self._poll_delay_ms

        while not self._abort:
            try:
                updates = await self._fetch_updates()
                backoff = self._poll_delay_ms  # Reset backoff on success

                if updates:
                    for message in updates:
                        for callback in self._listeners:
                            with contextlib.suppress(Exception):
                                callback(message)

                # Small pause before polling again
                await asyncio.sleep(0.05)

            except Exception as err:
                self._handle_error(err)
                # Exponential backoff up to 30s
                await asyncio.sleep(backoff / 1000)
                backoff = min(30000, int(backoff * 1.5))

    async def _fetch_updates(self) -> list[Message]:
        """Fetch updates from the server."""
        params: dict[str, Any] = {
            "timeoutMs": self._timeout_ms,
            "listenerType": self._listener_type.value,
        }

        if self._bot_ids and len(self._bot_ids) > 0:
            params["botIds"] = ",".join(self._bot_ids)

        payload = await self._request(
            "GET",
            "/api/v1/getUpdates",
            params=params,
        )

        if not payload.get("success"):
            raise ChatLayerAPIError(f"get_updates error: {payload.get('errorMessage', payload)}")

        data = self._extract_response(payload)

        messages: list[Message] = []
        if isinstance(data, list):
            messages = [Message.model_validate(m) for m in data]
        elif isinstance(data, dict) and "messages" in data:
            messages = [Message.model_validate(m) for m in data["messages"]]
        elif isinstance(payload.get("data"), list):
            messages = [Message.model_validate(m) for m in payload["data"]]

        self._normalize_attachments_list(messages)
        return messages


Botoraptor = ChatLayer
BotoraptorError = ChatLayerError
BotoraptorAPIError = ChatLayerAPIError
