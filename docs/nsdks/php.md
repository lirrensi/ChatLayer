---
node_type: reference
title: PHP SDK Reference
status: active
updated: 2026-07-16 (code-synced)
tags: [sdk, nsdk, php]
links:
  depends_on: [/core/server.md]
  documents: [/sdk-templates/php/]
  relates_to: [/nsdks/node.md, /nsdks/python.md, /nsdks/go.md]
---

# PHP SDK Reference

The PHP SDK is a single-file drop-in client for Botoraptor. It uses cURL and standard PHP arrays.

---

## Quick Start

```php
require_once __DIR__ . '/../sdk-templates/php/Botoraptor.php';

$client = new Botoraptor([
    'apiKey' => 'your-api-key',
    'baseUrl' => 'http://localhost:31000',
    'botId' => 'my-bot',
]);

$message = $client->addMessage([
    'botId' => 'my-bot',
    'roomId' => 'room-123',
    'userId' => 'user-456',
    'text' => 'Hello!',
]);
```

---

## Configuration

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `apiKey` | Yes | — | API key for authentication |
| `baseUrl` | No | `http://localhost:31000` | Server base URL |
| `botId` | No | — | Single bot ID |
| `botIds` | No | `[]` | Bot IDs to listen for |
| `listenerType` | No | `"bot"` if `botIds` set, else `"ui"` | `"bot"` or `"ui"` |
| `timeoutMs` | No | `60000` | Long-poll timeout |
| `pollDelayMs` | No | `1000` | Poll interval between retries |
| `onError` | No | `null` | Callback for errors |

---

## Core Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `addMessage` | `(array $msg): array` | Send a message |
| `addManagerMessage` | `(array $msg): array` | Send a manager message |
| `sendServiceAlert` | `(array $msg): array` | Send a service call message |
| `addMessageSingle` | `(array $msg, $fileOrFiles, ?array $options = null): array` | Send a message with one or more files |
| `addUser` | `(array $user): array` | Create or return a user |
| `getMessages` | `(array $params = []): array` | Fetch messages |
| `getBots` | `(): array` | List bot IDs |
| `getRooms` | `(array $params = []): array` | Fetch room summaries |
| `getClientConfig` | `(): array` | Get client configuration |
| `uploadFile` | `(array $files, ?array $options): array` | Upload raw file bytes (takes array of files) |
| `uploadFileByURL` | `(array $files): array` | Upload files from remote URLs |
| `onMessage` | `(callable $callback): callable` | Register a message listener |
| `start` | `(?array $opts = null): void` | Run the long-poll loop |
| `stop` | `(): void` | Stop polling |

---

## Long-Polling Behavior

> **⚠️ Important:** Unlike the Node (async), Python (async), and Go (goroutine) SDKs, the PHP SDK's `start()` method runs a **synchronous blocking loop**. It prevents any other code from executing until `stop()` is called or an error occurs.

```php
// Register listener
$client->onMessage(function ($msg) {
    echo "New message: " . $msg['text'] . "\n";
});

// Start blocking loop
$client->start();

// This code only runs after start() returns
```

**Considerations:**
- Run `start()` in a separate process or CLI script
- Use `pcntl_fork()` or a process manager for concurrent operations
- The loop uses cURL with timeout for HTTP requests
- On error, it waits `pollDelayMs` before retrying

---

## Notes

- The PHP client defaults to `http://localhost:31000` when `baseUrl` is omitted.
- The SDK is self-contained and does not require Composer.
- `uploadFile` accepts an array of files, not a single file.
- `addMessageSingle` accepts either a single file or an array of files.
