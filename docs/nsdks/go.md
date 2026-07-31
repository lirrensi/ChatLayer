---
node_type: reference
title: Go SDK Reference
status: active
updated: 2026-07-16 (code-synced)
tags: [sdk, nsdk, go]
links:
  depends_on: [/core/server.md]
  documents: [/sdk-templates/go/]
  relates_to: [/nsdks/node.md, /nsdks/python.md, /nsdks/php.md]
---

# Go SDK Reference

The Go SDK is a thin HTTP client for Botoraptor. It mirrors the same REST surface as the Node SDK, using plain Go types and `net/http`.

---

## Package

Import the module:

```go
import "github.com/lirrensi/Botoraptor/sdk-templates/go"
```

The package name is `botoraptor`.

---

## Quick Start

```go
package main

import (
    "context"
    "log"

    botoraptor "github.com/lirrensi/Botoraptor/sdk-templates/go"
)

func main() {
    client, err := botoraptor.New(botoraptor.Config{
        APIKey:  "your-api-key",
        BaseURL: "http://localhost:31000",
        BotID:   "my-bot",
    })
    if err != nil {
        log.Fatal(err)
    }

    msg, err := client.AddMessage(context.Background(), botoraptor.AddMessageInput{
        BotID:  "my-bot",
        RoomID: "room-123",
        UserID: "user-456",
        Text:   "Hello!",
    })
}
```

---

## Configuration

```go
type Config struct {
    APIKey       string         // Required
    BaseURL      string         // Default: "http://localhost:31000"
    BotID        string         // Single bot ID (legacy)
    BotIDs       []string       // Bot IDs to listen for
    ListenerType string         // "bot" or "ui" (default: "bot" if BotIDs/BotID set, otherwise "ui")
    TimeoutMs    int            // Default: 60000
    PollDelayMs  int            // Default: 1000
    OnError      func(error)   // Error handler
    HTTPClient   *http.Client  // Custom HTTP client
}
```

---

## Core Methods

All methods accept `context.Context` as the first parameter (Go standard pattern).

| Method | Description |
|--------|-------------|
| `AddMessage(ctx, msg)` | Send a message |
| `AddManagerMessage(ctx, msg)` | Send a manager message |
| `SendServiceAlert(ctx, msg)` | Send a service call message |
| `AddMessageSingle(ctx, msg, files...)` | Send a message with one or more files |
| `AddUser(ctx, user)` | Create or return a user |
| `GetMessages(ctx, opts)` | Fetch messages |
| `GetBots(ctx)` | List bot IDs |
| `GetRooms(ctx, opts)` | Fetch room summaries |
| `GetClientConfig(ctx)` | Get client configuration |
| `UploadFile(ctx, files...)` | Upload raw file bytes |
| `UploadFileByURL(ctx, files...)` | Upload files from remote URLs |
| `OnMessage(cb)` | Register a message listener (returns cleanup function) |
| `Start()` / `Stop()` | Run the long-poll loop |

---

## Types

```go
// Message represents a chat message
type Message struct {
    ID          string         `json:"id,omitempty"`
    BotID       string         `json:"botId"`
    RoomID      string         `json:"roomId"`
    UserID      string         `json:"userId"`
    Username    string         `json:"username"`
    Name        string         `json:"name,omitempty"`
    Text        string         `json:"text"`
    MessageType string         `json:"messageType"`
    Attachments []Attachment   `json:"attachments,omitempty"`
    Meta        map[string]any `json:"meta,omitempty"`
    CreatedAt   string         `json:"createdAt"`
}

// Attachment represents a file attachment
type Attachment struct {
	ID           string `json:"id,omitempty"`
	Type         string `json:"type"`
	IsExternal   bool   `json:"isExternal"`
	URL          string `json:"url,omitempty"`
	Filename     string `json:"filename,omitempty"`
	OriginalName string `json:"original_name,omitempty"`
	MimeType     string `json:"mime_type,omitempty"`
	Size         int64  `json:"size,omitempty"`
	CreatedAt    string `json:"createdAt,omitempty"`
}

// User represents a chat user
type User struct {
	ID        int    `json:"id,omitempty"`
	BotID     string `json:"botId"`
	UserID    string `json:"userId"`
	Username  string `json:"username"`
	Name      string `json:"name,omitempty"`
	Blocked   bool   `json:"blocked,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// RoomInfo represents a room summary
type RoomInfo struct {
    BotID       string    `json:"botId"`
    RoomID      string    `json:"roomId"`
    Users       []User    `json:"users"`
    LastMessage *Message  `json:"lastMessage"`
}

// RoomsResponse wraps the paginated room response
type RoomsResponse struct {
    Success bool       `json:"success"`
    Rooms   []RoomInfo `json:"rooms"`
}

// Input types for API calls
type AddMessageInput struct { ... }
type AddUserInput struct { ... }
type UploadFileInput struct { ... }
type UploadURLInput struct { ... }
type GetMessagesOptions struct { ... }
type GetRoomsOptions struct { ... }
```

---

## Notes

- Go is server-side, so the client defaults to `http://localhost:31000` when `BaseURL` is omitted.
- `Start()` runs the long-poll loop in a goroutine.
- `OnMessage` returns a cleanup function to unregister the listener.
- `go.mod` lives in `sdk-templates/go/go.mod`. Go has no normal package-version field; use the repository v4 release when copying this template.
