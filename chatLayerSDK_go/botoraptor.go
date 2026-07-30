// Package botoraptor provides a small Go client for the Botoraptor API.
package botoraptor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Attachment mirrors the server attachment payload.
type Attachment struct {
	ID           string `json:"id,omitempty"`
	Type         string `json:"type"`
	IsExternal   bool   `json:"isExternal,omitempty"`
	URL          string `json:"url,omitempty"`
	Filename     string `json:"filename,omitempty"`
	OriginalName string `json:"original_name,omitempty"`
	MimeType     string `json:"mime_type,omitempty"`
	Size         int64  `json:"size,omitempty"`
	CreatedAt    string `json:"createdAt,omitempty"`
}

// Message mirrors the server message payload.
type Message struct {
	ID          string         `json:"id,omitempty"`
	BotID       string         `json:"botId"`
	RoomID      string         `json:"roomId"`
	UserID      string         `json:"userId"`
	Username    string         `json:"username,omitempty"`
	Name        string         `json:"name,omitempty"`
	Text        string         `json:"text,omitempty"`
	MessageType string         `json:"messageType,omitempty"`
	Attachments []Attachment   `json:"attachments,omitempty"`
	Meta        map[string]any `json:"meta,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
	CreatedAt   string         `json:"createdAt,omitempty"`
}

// User mirrors the server user payload.
type User struct {
	ID        int    `json:"id,omitempty"`
	BotID     string `json:"botId"`
	UserID    string `json:"userId"`
	Username  string `json:"username"`
	Name      string `json:"name,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	Blocked   bool   `json:"blocked,omitempty"`
}

// RoomInfo mirrors the room payload returned by getRooms.
type RoomInfo struct {
	BotID       string   `json:"botId"`
	RoomID      string   `json:"roomId"`
	Users       []User   `json:"users"`
	LastMessage *Message `json:"lastMessage,omitempty"`
}

// RoomsResponse matches the getRooms payload.
type RoomsResponse struct {
	Rooms []RoomInfo `json:"rooms"`
}

// Config controls client behavior.
type Config struct {
	APIKey       string
	BaseURL      string
	BotID        string
	BotIDs       []string
	ListenerType string
	TimeoutMs    int
	PollDelayMs  int
	OnError      func(error)
	HTTPClient   *http.Client
}

// AddMessageInput is the request body for addMessage.
type AddMessageInput struct {
	BotID       string         `json:"botId"`
	RoomID      string         `json:"roomId"`
	UserID      string         `json:"userId"`
	Username    string         `json:"username,omitempty"`
	Name        string         `json:"name,omitempty"`
	Text        string         `json:"text,omitempty"`
	MessageType string         `json:"messageType,omitempty"`
	Attachments []Attachment   `json:"attachments,omitempty"`
	Meta        map[string]any `json:"meta,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
}

// AddUserInput is the request body for addUser.
type AddUserInput struct {
	BotID    string `json:"botId"`
	UserID   string `json:"userId"`
	Username string `json:"username,omitempty"`
	Name     string `json:"name,omitempty"`
}

// UploadFileInput is a raw file payload for upload endpoints.
type UploadFileInput struct {
	Data     []byte
	Filename string
	Type     string
	MIME     string
}

// UploadURLInput is a remote file descriptor for uploadFileByURL.
type UploadURLInput struct {
	URL      string `json:"url"`
	Filename string `json:"filename,omitempty"`
	Type     string `json:"type,omitempty"`
}

// GetMessagesOptions controls getMessages.
type GetMessagesOptions struct {
	BotID    string
	RoomID   string
	CursorID string
	Limit    int
	Types    []string
}

// GetRoomsOptions controls getRooms.
type GetRoomsOptions struct {
	BotID       string
	MessageType string
	Depth       int
	Limit       int
	CursorID    string
	Tags        string
}

// Client is a small Botoraptor API client.
type Client struct {
	apiKey       string
	baseURL      string
	botID        string
	botIDs       []string
	listenerType string
	timeoutMs    int
	pollDelayMs  int
	onError      func(error)
	httpClient   *http.Client
	listenersMu  sync.RWMutex
	listeners    []func(Message)
	running      uint32
	abort        uint32
}

type apiEnvelope struct {
	Success      bool            `json:"success"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	Data         json.RawMessage `json:"data,omitempty"`
	Message      json.RawMessage `json:"message,omitempty"`
	Messages     json.RawMessage `json:"messages,omitempty"`
	Bots         json.RawMessage `json:"bots,omitempty"`
	User         json.RawMessage `json:"user,omitempty"`
	Attachments  json.RawMessage `json:"attachments,omitempty"`
	Rooms        json.RawMessage `json:"rooms,omitempty"`
}

type formField struct {
	Name  string
	Value string
}

// New creates a client.
func New(cfg Config) (*Client, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("apiKey is required")
	}

	baseURL := strings.TrimSpace(cfg.BaseURL)
	if baseURL == "" || baseURL == "/" {
		baseURL = "http://localhost:31000"
	}
	baseURL = strings.TrimRight(baseURL, "/")

	botIDs := append([]string(nil), cfg.BotIDs...)
	if len(botIDs) == 0 && strings.TrimSpace(cfg.BotID) != "" {
		botIDs = []string{strings.TrimSpace(cfg.BotID)}
	}

	listenerType := cfg.ListenerType
	if listenerType == "" {
		if len(botIDs) > 0 {
			listenerType = "bot"
		} else {
			listenerType = "ui"
		}
	}
	if listenerType != "bot" && listenerType != "ui" {
		return nil, fmt.Errorf("invalid listenerType %q", listenerType)
	}

	timeoutMs := cfg.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 60000
	}
	pollDelayMs := cfg.PollDelayMs
	if pollDelayMs <= 0 {
		pollDelayMs = 1000
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{}
	}

	return &Client{
		apiKey:       cfg.APIKey,
		baseURL:      baseURL,
		botID:        strings.TrimSpace(cfg.BotID),
		botIDs:       botIDs,
		listenerType: listenerType,
		timeoutMs:    timeoutMs,
		pollDelayMs:  pollDelayMs,
		onError:      cfg.OnError,
		httpClient:   client,
	}, nil
}

// AddMessage sends a message to the API.
func (c *Client) AddMessage(ctx context.Context, msg AddMessageInput) (Message, error) {
	raw, err := c.requestJSON(ctx, http.MethodPost, "/api/v1/addMessage", msg)
	if err != nil {
		return Message{}, c.fail(err)
	}

	msgOut, err := parseMessagePayload(raw)
	if err != nil {
		return Message{}, c.fail(fmt.Errorf("addMessage: %w", err))
	}
	c.normalizeMessage(&msgOut)
	return msgOut, nil
}

// AddManagerMessage sends a message tagged as manager_message.
func (c *Client) AddManagerMessage(ctx context.Context, msg AddMessageInput) (Message, error) {
	msg.MessageType = "manager_message"
	return c.AddMessage(ctx, msg)
}

// SendServiceAlert sends a message tagged as service_call.
func (c *Client) SendServiceAlert(ctx context.Context, msg AddMessageInput) (Message, error) {
	msg.MessageType = "service_call"
	return c.AddMessage(ctx, msg)
}

// AddMessageSingle sends a message and one or more files in a single multipart request.
func (c *Client) AddMessageSingle(ctx context.Context, msg AddMessageInput, files ...UploadFileInput) (Message, error) {
	if strings.TrimSpace(msg.BotID) == "" || strings.TrimSpace(msg.RoomID) == "" || strings.TrimSpace(msg.UserID) == "" {
		return Message{}, c.fail(errors.New("addMessageSingle: msg.botId, msg.roomId and msg.userId are required"))
	}
	if len(files) == 0 {
		return Message{}, c.fail(errors.New("addMessageSingle: file is required"))
	}

	fields := []formField{
		{Name: "botId", Value: msg.BotID},
		{Name: "roomId", Value: msg.RoomID},
		{Name: "userId", Value: msg.UserID},
	}
	if msg.Username != "" {
		fields = append(fields, formField{Name: "username", Value: msg.Username})
	}
	if msg.Name != "" {
		fields = append(fields, formField{Name: "name", Value: msg.Name})
	}
	if msg.MessageType != "" {
		fields = append(fields, formField{Name: "messageType", Value: msg.MessageType})
	}
	if msg.Text != "" {
		fields = append(fields, formField{Name: "text", Value: msg.Text})
	}
	if msg.Meta != nil {
		metaJSON, err := json.Marshal(msg.Meta)
		if err != nil {
			return Message{}, c.fail(fmt.Errorf("addMessageSingle: failed to marshal meta: %w", err))
		}
		fields = append(fields, formField{Name: "meta", Value: string(metaJSON)})
	}

	body, contentType, err := buildMultipart(fields, files)
	if err != nil {
		return Message{}, c.fail(err)
	}

	raw, err := c.requestRaw(ctx, http.MethodPost, "/api/v1/addMessageSingle", body, contentType, 0)
	if err != nil {
		return Message{}, c.fail(err)
	}

	msgOut, err := parseMessagePayload(raw)
	if err != nil {
		return Message{}, c.fail(fmt.Errorf("addMessageSingle: %w", err))
	}
	c.normalizeMessage(&msgOut)
	return msgOut, nil
}

// AddUser creates or returns a user.
func (c *Client) AddUser(ctx context.Context, user AddUserInput) (User, error) {
	raw, err := c.requestJSON(ctx, http.MethodPost, "/api/v1/addUser", user)
	if err != nil {
		return User{}, c.fail(err)
	}

	out, err := parseUserPayload(raw)
	if err != nil {
		return User{}, c.fail(fmt.Errorf("addUser: %w", err))
	}
	return out, nil
}

// GetMessages fetches messages for a bot and optional room.
func (c *Client) GetMessages(ctx context.Context, opts GetMessagesOptions) ([]Message, error) {
	botID := strings.TrimSpace(opts.BotID)
	if botID == "" {
		botID = c.botID
	}
	if botID == "" {
		return nil, c.fail(errors.New("botId is required for getMessages"))
	}

	query := url.Values{}
	query.Set("botId", botID)
	if strings.TrimSpace(opts.RoomID) != "" {
		query.Set("roomId", opts.RoomID)
	}
	if strings.TrimSpace(opts.CursorID) != "" {
		query.Set("cursorId", opts.CursorID)
	}
	if opts.Limit > 0 {
		query.Set("limit", fmt.Sprintf("%d", opts.Limit))
	}
	if len(opts.Types) > 0 {
		query.Set("types", strings.Join(opts.Types, ","))
	}

	raw, err := c.requestRaw(ctx, http.MethodGet, "/api/v1/getMessages?"+query.Encode(), nil, "", 0)
	if err != nil {
		return nil, c.fail(err)
	}

	msgs, err := parseMessageList(raw)
	if err != nil {
		return nil, c.fail(fmt.Errorf("getMessages: %w", err))
	}
	c.normalizeMessages(msgs)
	return msgs, nil
}

// GetBots returns all bot IDs.
func (c *Client) GetBots(ctx context.Context) ([]string, error) {
	raw, err := c.requestRaw(ctx, http.MethodGet, "/api/v1/getBots", nil, "", 0)
	if err != nil {
		return nil, c.fail(err)
	}

	bots, err := parseStringList(raw, "bots")
	if err != nil {
		return nil, c.fail(fmt.Errorf("getBots: %w", err))
	}
	return bots, nil
}

// GetRooms fetches room summaries.
func (c *Client) GetRooms(ctx context.Context, opts GetRoomsOptions) (RoomsResponse, error) {
	botID := strings.TrimSpace(opts.BotID)
	if botID == "" {
		botID = c.botID
	}
	if botID == "" {
		return RoomsResponse{}, c.fail(errors.New("botId is required for getRooms"))
	}

	query := url.Values{}
	query.Set("botId", botID)
	if strings.TrimSpace(opts.MessageType) != "" {
		query.Set("messageType", opts.MessageType)
	}
	if opts.Depth > 0 {
		query.Set("depth", fmt.Sprintf("%d", opts.Depth))
	}
	if opts.Limit > 0 {
		query.Set("limit", fmt.Sprintf("%d", opts.Limit))
	}
	if strings.TrimSpace(opts.CursorID) != "" {
		query.Set("cursorId", opts.CursorID)
	}
	if strings.TrimSpace(opts.Tags) != "" {
		query.Set("tags", opts.Tags)
	}

	raw, err := c.requestRaw(ctx, http.MethodGet, "/api/v1/getRooms?"+query.Encode(), nil, "", 0)
	if err != nil {
		return RoomsResponse{}, c.fail(err)
	}

	rooms, err := parseRoomList(raw)
	if err != nil {
		return RoomsResponse{}, c.fail(fmt.Errorf("getRooms: %w", err))
	}
	for i := range rooms {
		if rooms[i].LastMessage != nil {
			c.normalizeMessage(rooms[i].LastMessage)
		}
	}
	return RoomsResponse{Rooms: rooms}, nil
}

// GetClientConfig returns the client config payload.
func (c *Client) GetClientConfig(ctx context.Context) (map[string]any, error) {
	raw, err := c.requestRaw(ctx, http.MethodGet, "/api/v1/getClientConfig", nil, "", 0)
	if err != nil {
		return nil, c.fail(err)
	}

	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, c.fail(fmt.Errorf("getClientConfig: invalid json response: %w", err))
	}
	delete(out, "success")
	delete(out, "errorMessage")
	if data, ok := out["data"].(map[string]any); ok {
		return data, nil
	}
	return out, nil
}

// UploadFile uploads one or more files.
func (c *Client) UploadFile(ctx context.Context, files ...UploadFileInput) ([]Attachment, error) {
	if len(files) == 0 {
		return nil, c.fail(errors.New("uploadFile: file is required"))
	}

	body, contentType, err := buildMultipart(nil, files)
	if err != nil {
		return nil, c.fail(err)
	}

	raw, err := c.requestRaw(ctx, http.MethodPost, "/api/v1/uploadFile", body, contentType, 0)
	if err != nil {
		return nil, c.fail(err)
	}

	atts, err := parseAttachmentList(raw)
	if err != nil {
		return nil, c.fail(fmt.Errorf("uploadFile: %w", err))
	}
	c.normalizeAttachments(atts)
	return atts, nil
}

// UploadFileByURL uploads remote files by URL.
func (c *Client) UploadFileByURL(ctx context.Context, files ...UploadURLInput) ([]Attachment, error) {
	if len(files) == 0 {
		return nil, c.fail(errors.New("uploadFileByURL: files array is required"))
	}

	raw, err := c.requestJSON(ctx, http.MethodPost, "/api/v1/uploadFileByURL", map[string]any{"files": files})
	if err != nil {
		return nil, c.fail(err)
	}

	atts, err := parseAttachmentList(raw)
	if err != nil {
		return nil, c.fail(fmt.Errorf("uploadFileByURL: %w", err))
	}
	c.normalizeAttachments(atts)
	return atts, nil
}

// OnMessage registers a listener and returns an unsubscribe function.
func (c *Client) OnMessage(cb func(Message)) func() {
	c.listenersMu.Lock()
	defer c.listenersMu.Unlock()
	c.listeners = append(c.listeners, cb)

	return func() {
		c.listenersMu.Lock()
		defer c.listenersMu.Unlock()
		next := c.listeners[:0]
		for _, existing := range c.listeners {
			if fmt.Sprintf("%p", existing) != fmt.Sprintf("%p", cb) {
				next = append(next, existing)
			}
		}
		c.listeners = append([]func(Message){}, next...)
	}
}

// Start launches the long-poll loop in a goroutine.
func (c *Client) Start() error {
	if atomic.LoadUint32(&c.running) == 1 {
		return nil
	}

	botIDs := c.botIDs
	if len(botIDs) == 0 && strings.TrimSpace(c.botID) != "" {
		botIDs = []string{c.botID}
	}
	listenerType := c.listenerType
	if listenerType == "" {
		listenerType = "bot"
	}
	if listenerType == "bot" && len(botIDs) == 0 {
		return c.fail(errors.New("botIds are required to start longpolling for listenerType=bot"))
	}

	c.botIDs = append([]string(nil), botIDs...)
	c.listenerType = listenerType
	atomic.StoreUint32(&c.abort, 0)
	atomic.StoreUint32(&c.running, 1)
	go c.pollLoop()
	return nil
}

// Stop stops the long-poll loop.
func (c *Client) Stop() {
	atomic.StoreUint32(&c.abort, 1)
	atomic.StoreUint32(&c.running, 0)
}

func (c *Client) pollLoop() {
	backoff := time.Duration(c.pollDelayMs) * time.Millisecond
	if backoff <= 0 {
		backoff = time.Second
	}

	for atomic.LoadUint32(&c.abort) == 0 {
		msgs, err := c.fetchUpdates(context.Background())
		if err != nil {
			c.handleError(err)
			c.sleep(backoff)
			backoff = time.Duration(float64(backoff) * 1.5)
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
			continue
		}

		backoff = time.Duration(c.pollDelayMs) * time.Millisecond
		for _, msg := range msgs {
			c.dispatch(msg)
		}
		c.sleep(50 * time.Millisecond)
	}
	atomic.StoreUint32(&c.running, 0)
}

func (c *Client) fetchUpdates(ctx context.Context) ([]Message, error) {
	query := url.Values{}
	if len(c.botIDs) > 0 {
		query.Set("botIds", strings.Join(c.botIDs, ","))
	}
	query.Set("timeoutMs", fmt.Sprintf("%d", c.timeoutMs))
	query.Set("listenerType", c.listenerType)

	deadline := time.Duration(c.timeoutMs+5000) * time.Millisecond
	if deadline <= 0 {
		deadline = 65 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()

	raw, err := c.requestRaw(reqCtx, http.MethodGet, "/api/v1/getUpdates?"+query.Encode(), nil, "", 0)
	if err != nil {
		return nil, err
	}

	msgs, err := parseMessageList(raw)
	if err != nil {
		return nil, err
	}
	c.normalizeMessages(msgs)
	return msgs, nil
}

func (c *Client) dispatch(msg Message) {
	c.listenersMu.RLock()
	listeners := append([]func(Message){}, c.listeners...)
	c.listenersMu.RUnlock()

	for _, cb := range listeners {
		func() {
			defer func() {
				if r := recover(); r != nil {
					c.handleError(fmt.Errorf("listener panic: %v", r))
				}
			}()
			cb(msg)
		}()
	}
}

func (c *Client) requestJSON(ctx context.Context, method, path string, payload any) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return c.requestRaw(ctx, method, path, bytes.NewReader(body), "application/json", 0)
}

func (c *Client) requestRaw(ctx context.Context, method, path string, body io.Reader, contentType string, timeoutMs int) ([]byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("%s failed: %s", pathName(path), strings.TrimSpace(string(raw)))
	}
	if timeoutMs > 0 && len(raw) == 0 {
		return nil, errors.New("empty response body")
	}
	var env apiEnvelope
	if err := json.Unmarshal(raw, &env); err == nil && !env.Success {
		if env.ErrorMessage != "" {
			return nil, errors.New(env.ErrorMessage)
		}
		return nil, errors.New("request failed")
	}
	return raw, nil
}

func (c *Client) handleError(err error) {
	if err == nil {
		return
	}
	if c.onError != nil {
		func() {
			defer func() {
				_ = recover()
			}()
			c.onError(err)
		}()
	}
	fmt.Fprintln(os.Stderr, "[Botoraptor SDK] error:", err)
}

func (c *Client) fail(err error) error {
	c.handleError(err)
	return err
}

func (c *Client) sleep(d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	<-timer.C
}

func (c *Client) normalizeMessage(msg *Message) {
	if msg == nil {
		return
	}
	for i := range msg.Attachments {
		msg.Attachments[i].URL = c.ensureAbsoluteURL(msg.Attachments[i].URL)
	}
}

func (c *Client) normalizeMessages(msgs []Message) {
	for i := range msgs {
		c.normalizeMessage(&msgs[i])
	}
}

func (c *Client) normalizeAttachments(atts []Attachment) {
	for i := range atts {
		atts[i].URL = c.ensureAbsoluteURL(atts[i].URL)
	}
}

func (c *Client) ensureAbsoluteURL(u string) string {
	if u == "" || strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") {
		return u
	}
	if strings.HasPrefix(u, "/") {
		return c.baseURL + u
	}
	return c.baseURL + "/" + u
}

func buildMultipart(fields []formField, files []UploadFileInput) (*bytes.Buffer, string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	for _, field := range fields {
		if field.Name == "" {
			continue
		}
		if err := writer.WriteField(field.Name, field.Value); err != nil {
			_ = writer.Close()
			return nil, "", err
		}
	}

	for i, file := range files {
		filename := strings.TrimSpace(file.Filename)
		if filename == "" {
			filename = fmt.Sprintf("file_%d", i)
		}
		part, err := writer.CreateFormFile("file", filename)
		if err != nil {
			_ = writer.Close()
			return nil, "", err
		}
		if _, err := part.Write(file.Data); err != nil {
			_ = writer.Close()
			return nil, "", err
		}
		if file.Type != "" {
			if err := writer.WriteField("type", file.Type); err != nil {
				_ = writer.Close()
				return nil, "", err
			}
		}
		if err := writer.WriteField("filename", filename); err != nil {
			_ = writer.Close()
			return nil, "", err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return &buf, writer.FormDataContentType(), nil
}

func parseMessagePayload(raw []byte) (Message, error) {
	var msg Message
	if err := json.Unmarshal(raw, &msg); err == nil && (msg.BotID != "" || msg.RoomID != "" || msg.UserID != "") {
		return msg, nil
	}

	var wrapper struct {
		Message Message `json:"message"`
		Data    Message `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return Message{}, err
	}
	if wrapper.Message.BotID != "" || wrapper.Message.RoomID != "" || wrapper.Message.UserID != "" {
		return wrapper.Message, nil
	}
	if wrapper.Data.BotID != "" || wrapper.Data.RoomID != "" || wrapper.Data.UserID != "" {
		return wrapper.Data, nil
	}
	return Message{}, errors.New("unexpected payload shape")
}

func parseUserPayload(raw []byte) (User, error) {
	var user User
	if err := json.Unmarshal(raw, &user); err == nil && (user.BotID != "" || user.UserID != "") {
		return user, nil
	}

	var wrapper struct {
		User User `json:"user"`
		Data User `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return User{}, err
	}
	if wrapper.User.BotID != "" || wrapper.User.UserID != "" {
		return wrapper.User, nil
	}
	if wrapper.Data.BotID != "" || wrapper.Data.UserID != "" {
		return wrapper.Data, nil
	}
	return User{}, errors.New("unexpected payload shape")
}

func parseMessageList(raw []byte) ([]Message, error) {
	var msgs []Message
	if err := json.Unmarshal(raw, &msgs); err == nil {
		return msgs, nil
	}

	var wrapper struct {
		Messages []Message `json:"messages"`
		Data     []Message `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	if wrapper.Messages != nil {
		return wrapper.Messages, nil
	}
	if wrapper.Data != nil {
		return wrapper.Data, nil
	}
	return nil, errors.New("unexpected payload shape")
}

func parseRoomList(raw []byte) ([]RoomInfo, error) {
	var rooms []RoomInfo
	if err := json.Unmarshal(raw, &rooms); err == nil {
		return rooms, nil
	}

	var wrapper struct {
		Rooms []RoomInfo `json:"rooms"`
		Data  []RoomInfo `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	if wrapper.Rooms != nil {
		return wrapper.Rooms, nil
	}
	if wrapper.Data != nil {
		return wrapper.Data, nil
	}
	return nil, errors.New("unexpected payload shape")
}

func parseAttachmentList(raw []byte) ([]Attachment, error) {
	var attachments []Attachment
	if err := json.Unmarshal(raw, &attachments); err == nil {
		return attachments, nil
	}

	var wrapper struct {
		Attachments []Attachment `json:"attachments"`
		Data        []Attachment `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	if wrapper.Attachments != nil {
		return wrapper.Attachments, nil
	}
	if wrapper.Data != nil {
		return wrapper.Data, nil
	}
	return nil, errors.New("unexpected payload shape")
}

func parseStringList(raw []byte, field string) ([]string, error) {
	var list []string
	if err := json.Unmarshal(raw, &list); err == nil {
		return list, nil
	}

	var wrapper map[string]any
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	if v, ok := wrapper[field].([]any); ok {
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, fmt.Sprint(item))
		}
		return out, nil
	}
	if v, ok := wrapper["data"].([]any); ok {
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, fmt.Sprint(item))
		}
		return out, nil
	}
	return nil, errors.New("unexpected payload shape")
}

func pathName(path string) string {
	if idx := strings.Index(path, "?"); idx >= 0 {
		return path[:idx]
	}
	return path
}
