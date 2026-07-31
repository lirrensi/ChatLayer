# ChatLayer SDK Python - Agent Guidelines

## Build, Test & Lint Commands

### Installation
```bash
# Install with dev dependencies
pip install -e ".[dev]"
```

### Running Tests
```bash
# Run all tests
pytest

# Run a single test file
pytest tests/test_models.py

# Run a specific test
pytest tests/test_models.py::TestAttachment::test_attachment_creation

# Run with verbose output
pytest -v

# Run with coverage
pytest --cov=chatlayer_sdk --cov-report=html
```

### Linting & Formatting
```bash
# Check code quality
ruff check chatlayer_sdk

# Format code
ruff format chatlayer_sdk

# Apply formatting automatically
ruff format --check chatlayer_sdk
```

### Type Checking
```bash
# Type check the SDK code
mypy chatlayer_sdk

# Type check tests
mypy tests
```

## Code Style Guidelines

### Imports
- **Organization**: Standard library → Third-party → Local imports
- **Order**: `from __future__ import annotations` first, then imports
- **Example**:
  ```python
  from __future__ import annotations

  import asyncio
  import logging
  from typing import Any, Callable, Dict, List, Optional, Union

  import httpx

  from .models import (
      Attachment,
      Message,
      # ... other imports
  )
  ```

### Formatting
- **Line Length**: 100 characters (PEP 8 compatible)
- **Docstrings**: Use Google-style format with Args, Returns, and Raises sections
- **Blank Lines**: 2 blank lines between top-level functions/classes, 1 blank line within methods
- **Spacing**: No trailing whitespace, 4-space indentation

### Type Hints
- **Always** provide type hints for all parameters and return values
- Use `Optional[T]` for nullable fields
- Use `Union[X, Y]` or `X | Y` (Python 3.10+) for unions
- Use `List[T]` for lists, `Dict[K, V]` for dictionaries
- Use `Callable[[...], R]` for callbacks
- Use `Literal["value"]` for enum-like strings
- Enable `from __future__ import annotations` to avoid forward references

### Naming Conventions
- **Classes**: `PascalCase` (e.g., `ChatLayer`, `Message`)
- **Functions/Methods**: `snake_case` (e.g., `add_message`, `_handle_error`)
- **Private members**: `_leading_underscore` (e.g., `_client`, `_poll_loop`)
- **Constants**: `UPPER_SNAKE_CASE`
- **Variables**: `snake_case`
- **Enums**: `PascalCase` with `X = "value"` (strings for JSON compatibility)

### Error Handling
- **Custom Exceptions**: Define `ChatLayerError` (base) and `ChatLayerAPIError` (with status_code, response_text)
- **Always** catch and handle API errors in calling code
- **Never** let unhandled exceptions propagate from message callbacks (swallow errors in `_poll_loop`)
- **Log errors**: Use `logger.error()` and call `on_error` callback if provided
- **Document** exceptions in method docstrings using Raises section

### Pydantic Models
- **Use `populate_by_name=True`** for ConfigDict to support camelCase aliases
- **Use `by_alias=True`** when dumping models for API requests
- **Use `exclude_none=True`** to omit None values in API payloads
- **Always** use `model_validate()` for parsing dict input
- **Use `model_construct()`** for constructing models without validation
- **Define enums** for type-safe string values

### Async/Await Patterns
- **All public API methods must be async** (use `async def`)
- **Context managers**: Support `async with client:` for cleanup
- **Background tasks**: Use `asyncio.create_task()` for long-running operations
- **Event loops**: Use `asyncio.run()` for top-level async functions
- **Never block**: Avoid synchronous I/O in async code

### Method Documentation
- **Docstring format**: Google-style with sections
- **Required sections**: Summary, Args, Returns, Raises
- **Return type**: Always specify return type annotation
- **Example code**: Include usage examples in docstrings

### HTTP Client Handling
- **Reuse client**: Check `self._client` before creating new one
- **Own client**: Set `_client_owned = True` for automatic cleanup
- **Timeouts**: Use `httpx.Timeout()` with buffer for long polling
- **Error handling**: Catch `httpx.HTTPStatusError` and `httpx.RequestError`

### File Uploads
- **Support both single and multiple files**: Accept `Union[bytes, List[bytes]]`
- **Options**: Accept `Union[FileUploadOptions, List[FileUploadOptions]]`
- **Validation**: Check for required `filename` and `type` in options
- **Multipart**: Use httpx's file tuple format: `("field", (filename, bytes, mime_type))`

### Real-time Polling
- **Exponential backoff**: Start at `poll_delay_ms`, multiply by 1.5, cap at 30s
- **Graceful shutdown**: Set `_abort` flag to stop polling loop
- **Task cleanup**: Wait for `_poll_task` with timeout before closing
- **Multiple listeners**: Append callbacks to `_listeners`, return unsubscribe function

### URL Handling
- **Normalize relative URLs**: Convert to absolute using `base_url`
- **Support absolute URLs**: Check for `http://` or `https://` prefix first
- **Trailing slashes**: Strip trailing slashes from `base_url`

### Code Organization
- **Module structure**: Keep related models together in `models.py`
- **Client methods**: Group by category (Message, User, Query, File, Polling)
- **Private methods**: Prefix with `_`, keep internal logic encapsulated
- **Constants**: Use module-level constants for magic values (e.g., `logger`)

## Common Patterns

### Creating a Model from Dict
```python
# Using model_validate() with camelCase aliases
data = {"botId": "bot-1", "roomId": "room-1", "userId": "user-1"}
message = Message.model_validate(data)
```

### Making an API Request
```python
try:
    payload = await self._request("GET", "/api/v1/endpoint", params=params)
    if not payload.get("success"):
        raise ChatLayerAPIError(...)
    data = self._extract_response(payload)
except ChatLayerAPIError as e:
    self._handle_error(e)
    raise
```

### Handling File Uploads
```python
# Single file
attachments = await client.upload_file(file_bytes, options={
    "type": AttachmentType.IMAGE,
    "filename": "photo.jpg",
    "mime": "image/jpeg"
})

# Multiple files
attachments = await client.upload_file(file_bytes_list, options_list)
```

### Setting Up Message Listener
```python
async def on_message(msg: Message):
    # Process message
    pass

unsubscribe = client.on_message(on_message)
client.start()

# Later...
client.stop()
await client.close()
```

### Using Context Manager
```python
async with ChatLayer(api_key="key", base_url="https://api.example.com") as client:
    message = await client.add_message(...)
    # Automatic cleanup on exit
```

## Testing Guidelines

- **Test models** with `pytest`
- **Test validation** with invalid data (should raise)
- **Test camelCase alias** support
- **Test optional fields**
- **Test edge cases** (empty lists, None values, etc.)
- **Use `model_validate()`** for parsing in tests

## Python Version Requirements

- **Minimum**: Python 3.10
- **Type hints**: Use modern syntax (`list[T]`, `dict[str, str]`, etc.)
- **Future imports**: Always include `from __future__ import annotations`
