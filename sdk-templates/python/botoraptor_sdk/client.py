"""Botoraptor client aliases backed by the legacy chatlayer_sdk package."""

from chatlayer_sdk.client import (
    Botoraptor,
    BotoraptorAPIError,
    BotoraptorError,
    ChatLayer,
    ChatLayerAPIError,
    ChatLayerError,
)

__all__ = [
    "Botoraptor",
    "BotoraptorAPIError",
    "BotoraptorError",
    "ChatLayer",
    "ChatLayerAPIError",
    "ChatLayerError",
]
