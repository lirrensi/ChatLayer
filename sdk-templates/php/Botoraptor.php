<?php
declare(strict_types=1);

/**
 * Botoraptor PHP SDK.
 *
 * Drop this file into a project and require it directly.
 * It uses cURL only and mirrors the same REST surface as the Node SDK.
 */
class Botoraptor
{
    private string $apiKey;
    private string $baseUrl;
    private ?string $botId;
    private array $botIds;
    private string $listenerType;
    private int $timeoutMs;
    private int $pollDelayMs;
    private $onError;
    private array $listeners = [];
    private bool $running = false;
    private bool $abort = false;

    public function __construct(array $config)
    {
        if (!isset($config['apiKey']) || trim((string)$config['apiKey']) === '') {
            throw new InvalidArgumentException('apiKey is required');
        }

        $baseUrl = isset($config['baseUrl']) ? trim((string)$config['baseUrl']) : '';
        if ($baseUrl === '' || $baseUrl === '/') {
            $baseUrl = 'http://localhost:31000';
        }

        $botId = isset($config['botId']) ? trim((string)$config['botId']) : null;
        $botIds = [];
        if (isset($config['botIds']) && is_array($config['botIds'])) {
            $botIds = array_values(array_filter(array_map('strval', $config['botIds']), static fn($v) => trim($v) !== ''));
        }
        if (!$botIds && $botId !== null && $botId !== '') {
            $botIds = [$botId];
        }

        $listenerType = isset($config['listenerType']) ? (string)$config['listenerType'] : '';
        if ($listenerType === '') {
            $listenerType = $botIds ? 'bot' : 'ui';
        }
        if (!in_array($listenerType, ['bot', 'ui'], true)) {
            throw new InvalidArgumentException('listenerType must be "bot" or "ui"');
        }

        $this->apiKey = (string)$config['apiKey'];
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->botId = $botId ?: null;
        $this->botIds = $botIds;
        $this->listenerType = $listenerType;
        $this->timeoutMs = isset($config['timeoutMs']) && (int)$config['timeoutMs'] > 0 ? (int)$config['timeoutMs'] : 60000;
        $this->pollDelayMs = isset($config['pollDelayMs']) && (int)$config['pollDelayMs'] > 0 ? (int)$config['pollDelayMs'] : 1000;
        $this->onError = $config['onError'] ?? null;
    }

    public function addMessage(array $msg): array
    {
        $payload = $this->requestJson('POST', '/api/v1/addMessage', $msg);
        $message = $this->extractMessage($payload, 'addMessage');
        return $this->normalizeMessage($message);
    }

    public function addManagerMessage(array $msg): array
    {
        $msg['messageType'] = 'manager_message';
        return $this->addMessage($msg);
    }

    public function sendServiceAlert(array $msg): array
    {
        $msg['messageType'] = 'service_call';
        return $this->addMessage($msg);
    }

    public function addMessageSingle(array $msg, $fileOrFiles, ?array $options = null): array
    {
        if (empty($msg['botId']) || empty($msg['roomId']) || empty($msg['userId'])) {
            throw $this->fail(new InvalidArgumentException('addMessageSingle: msg.botId, msg.roomId and msg.userId are required'));
        }

        $files = is_array($fileOrFiles) && isset($fileOrFiles[0]) ? $fileOrFiles : [$fileOrFiles];
        if (!$files) {
            throw $this->fail(new InvalidArgumentException('addMessageSingle: file is required'));
        }

        $fields = [
            ['botId', (string)$msg['botId']],
            ['roomId', (string)$msg['roomId']],
            ['userId', (string)$msg['userId']],
        ];
        foreach (['username', 'name', 'messageType', 'text'] as $key) {
            if (isset($msg[$key]) && $msg[$key] !== '') {
                $fields[] = [$key, (string)$msg[$key]];
            }
        }
        if (array_key_exists('meta', $msg) && $msg['meta'] !== null) {
            $fields[] = ['meta', is_string($msg['meta']) ? $msg['meta'] : json_encode($msg['meta'], JSON_UNESCAPED_SLASHES)];
        }

        $multipartFiles = $this->normalizeFileInputs($files, $options);
        [$body, $boundary] = $this->buildMultipart($fields, $multipartFiles);
        $payload = $this->requestRaw('POST', '/api/v1/addMessageSingle', null, $body, $boundary);
        $message = $this->extractMessage($payload, 'addMessageSingle');
        return $this->normalizeMessage($message);
    }

    public function addUser(array $user): array
    {
        $payload = $this->requestJson('POST', '/api/v1/addUser', $user);
        return $this->extractUser($payload, 'addUser');
    }

    public function getMessages(array $params = []): array
    {
        $botId = isset($params['botId']) && trim((string)$params['botId']) !== '' ? trim((string)$params['botId']) : $this->botId;
        if ($botId === null || $botId === '') {
            throw $this->fail(new InvalidArgumentException('botId is required for getMessages'));
        }

        $query = ['botId' => $botId];
        if (!empty($params['roomId'])) {
            $query['roomId'] = (string)$params['roomId'];
        }
        if (!empty($params['cursorId'])) {
            $query['cursorId'] = (string)$params['cursorId'];
        }
        if (!empty($params['limit'])) {
            $query['limit'] = (string)(int)$params['limit'];
        }
        if (!empty($params['types'])) {
            $query['types'] = is_array($params['types']) ? implode(',', $params['types']) : (string)$params['types'];
        }

        $payload = $this->requestRaw('GET', '/api/v1/getMessages', $query);
        $messages = $this->extractMessageList($payload, 'getMessages');
        return array_map(fn(array $message) => $this->normalizeMessage($message), $messages);
    }

    public function getBots(): array
    {
        $payload = $this->requestRaw('GET', '/api/v1/getBots');
        $bots = $this->extractStringList($payload, 'bots', 'getBots');
        return $bots;
    }

    public function getRooms(array $params = []): array
    {
        $botId = isset($params['botId']) && trim((string)$params['botId']) !== '' ? trim((string)$params['botId']) : $this->botId;
        if ($botId === null || $botId === '') {
            throw $this->fail(new InvalidArgumentException('botId is required for getRooms'));
        }

        $query = ['botId' => $botId];
        if (!empty($params['messageType'])) {
            $query['messageType'] = (string)$params['messageType'];
        }
        if (!empty($params['depth'])) {
            $query['depth'] = (string)(int)$params['depth'];
        }
        if (!empty($params['limit'])) {
            $query['limit'] = (string)(int)$params['limit'];
        }
        if (!empty($params['cursorId'])) {
            $query['cursorId'] = (string)$params['cursorId'];
        }
        if (!empty($params['tags'])) {
            $query['tags'] = (string)$params['tags'];
        }

        $payload = $this->requestRaw('GET', '/api/v1/getRooms', $query);
        $rooms = $this->extractRoomList($payload, 'getRooms');
        foreach ($rooms as &$room) {
            if (isset($room['lastMessage']) && is_array($room['lastMessage'])) {
                $room['lastMessage'] = $this->normalizeMessage($room['lastMessage']);
            }
        }
        unset($room);
        return ['rooms' => $rooms];
    }

    public function getClientConfig(): array
    {
        $payload = $this->requestRaw('GET', '/api/v1/getClientConfig');
        if (isset($payload['data']) && is_array($payload['data'])) {
            return $payload['data'];
        }
        unset($payload['success'], $payload['errorMessage']);
        return $payload;
    }

    public function uploadFile(array $files, ?array $options = null): array
    {
        if (!$files) {
            throw $this->fail(new InvalidArgumentException('uploadFile: file is required'));
        }

        [$body, $boundary] = $this->buildMultipart([], $this->normalizeFileInputs($files, $options, false));
        $payload = $this->requestRaw('POST', '/api/v1/uploadFile', null, $body, $boundary);
        $attachments = $this->extractAttachmentList($payload, 'uploadFile');
        return $this->normalizeAttachments($attachments);
    }

    public function uploadFileByURL(array $files): array
    {
        if (!$files) {
            throw $this->fail(new InvalidArgumentException('uploadFileByURL: files array is required'));
        }

        $payload = $this->requestJson('POST', '/api/v1/uploadFileByURL', ['files' => array_values($files)]);
        $attachments = $this->extractAttachmentList($payload, 'uploadFileByURL');
        return $this->normalizeAttachments($attachments);
    }

    public function onMessage(callable $callback): callable
    {
        $this->listeners[] = $callback;
        return function () use ($callback): void {
            $this->listeners = array_values(array_filter(
                $this->listeners,
                static fn($existing) => $existing !== $callback
            ));
        };
    }

    public function start(?array $opts = null): void
    {
        if ($this->running) {
            return;
        }

        $botIds = $opts['botIds'] ?? $this->botIds;
        $listenerType = $opts['listenerType'] ?? $this->listenerType;
        if ($listenerType === 'bot' && !$botIds) {
            throw $this->fail(new RuntimeException('botIds are required to start longpolling for listenerType=bot'));
        }

        $this->botIds = $botIds ?: [];
        $this->listenerType = $listenerType;
        $this->abort = false;
        $this->running = true;

        if (function_exists('pcntl_async_signals')) {
            @pcntl_async_signals(true);
        }

        $backoff = $this->pollDelayMs;
        while (!$this->abort) {
            try {
                $updates = $this->fetchUpdates();
                foreach ($updates as $message) {
                    $this->dispatch($message);
                }
                $this->sleepMs(50);
                $backoff = $this->pollDelayMs;
            } catch (Throwable $e) {
                $this->handleError($e);
                $this->sleepMs($backoff);
                $backoff = (int)min(30000, max(1000, (int)round($backoff * 1.5)));
            }
        }

        $this->running = false;
    }

    public function stop(): void
    {
        $this->abort = true;
        $this->running = false;
    }

    private function fetchUpdates(): array
    {
        $query = ['timeoutMs' => (string)$this->timeoutMs, 'listenerType' => $this->listenerType];
        if ($this->botIds) {
            $query['botIds'] = implode(',', $this->botIds);
        }

        $payload = $this->requestRaw('GET', '/api/v1/getUpdates', $query, null, null, $this->timeoutMs + 5000);
        return $this->extractMessageList($payload, 'getUpdates');
    }

    private function dispatch(array $message): void
    {
        foreach ($this->listeners as $listener) {
            try {
                $listener($message);
            } catch (Throwable $e) {
                $this->handleError($e);
            }
        }
    }

    private function requestJson(string $method, string $path, array $jsonBody): array
    {
        $body = json_encode($jsonBody, JSON_UNESCAPED_SLASHES);
        if ($body === false) {
            throw $this->fail(new RuntimeException($path . ': failed to encode request body'));
        }
        return $this->requestRaw($method, $path, null, $body, null, 0, 'application/json');
    }

    private function requestRaw(string $method, string $path, ?array $query = null, ?string $body = null, ?string $boundary = null, int $timeoutMs = 0, ?string $contentType = null): array
    {
        $url = $this->baseUrl . $path;
        if ($query) {
            $url .= '?' . http_build_query($query);
        }

        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
        ];
        if ($contentType !== null) {
            $headers[] = 'Content-Type: ' . $contentType;
        } elseif ($boundary !== null) {
            $headers[] = 'Content-Type: multipart/form-data; boundary=' . $boundary;
        }

        $ch = curl_init($url);
        if ($ch === false) {
            throw $this->fail(new RuntimeException($path . ': failed to initialize cURL'));
        }

        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADER => false,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = $body;
        }
        if ($timeoutMs > 0) {
            $opts[CURLOPT_TIMEOUT_MS] = $timeoutMs;
        }

        curl_setopt_array($ch, $opts);
        $response = curl_exec($ch);
        if ($response === false) {
            $error = curl_error($ch) ?: 'unknown cURL error';
            curl_close($ch);
            throw $this->fail(new RuntimeException($path . ': ' . $error));
        }

        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode((string)$response, true);
        if (!is_array($decoded)) {
            throw $this->fail(new RuntimeException($path . ': invalid json response'));
        }
        if ($status < 200 || $status >= 300) {
            $message = $decoded['errorMessage'] ?? trim((string)$response);
            throw $this->fail(new RuntimeException($path . ' failed: ' . $status . ' ' . $message));
        }
        if (!($decoded['success'] ?? false)) {
            $message = $decoded['errorMessage'] ?? json_encode($decoded, JSON_UNESCAPED_SLASHES);
            throw $this->fail(new RuntimeException($path . ' error: ' . $message));
        }

        return $decoded;
    }

    private function extractMessage(array $payload, string $op): array
    {
        $candidates = [];
        if (isset($payload['message']) && is_array($payload['message'])) {
            $candidates[] = $payload['message'];
        }
        if (isset($payload['data']) && is_array($payload['data'])) {
            $candidates[] = $payload['data'];
        }
        foreach ($candidates as $candidate) {
            if ($this->looksLikeMessage($candidate)) {
                return $candidate;
            }
            if (isset($candidate['message']) && is_array($candidate['message'])) {
                return $candidate['message'];
            }
        }
        if ($this->looksLikeMessage($payload)) {
            return $payload;
        }
        throw new RuntimeException($op . ': unexpected payload shape');
    }

    private function extractUser(array $payload, string $op): array
    {
        foreach (['user', 'data'] as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                return $payload[$key];
            }
        }
        if ($this->looksLikeUser($payload)) {
            return $payload;
        }
        throw new RuntimeException($op . ': unexpected payload shape');
    }

    private function extractMessageList(array $payload, string $op): array
    {
        foreach (['messages', 'data'] as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                $value = $payload[$key];
                if ($this->isList($value)) {
                    return $value;
                }
                if (isset($value['messages']) && is_array($value['messages'])) {
                    return $value['messages'];
                }
            }
        }
        if ($this->isList($payload)) {
            return $payload;
        }
        throw new RuntimeException($op . ': unexpected payload shape');
    }

    private function extractRoomList(array $payload, string $op): array
    {
        foreach (['rooms', 'data'] as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                $value = $payload[$key];
                if ($this->isList($value)) {
                    return $value;
                }
                if (isset($value['rooms']) && is_array($value['rooms'])) {
                    return $value['rooms'];
                }
            }
        }
        if ($this->isList($payload)) {
            return $payload;
        }
        throw new RuntimeException($op . ': unexpected payload shape');
    }

    private function extractAttachmentList(array $payload, string $op): array
    {
        foreach (['attachments', 'data'] as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                $value = $payload[$key];
                if ($this->isList($value)) {
                    return $value;
                }
                if (isset($value['attachments']) && is_array($value['attachments'])) {
                    return $value['attachments'];
                }
            }
        }
        if ($this->isList($payload)) {
            return $payload;
        }
        throw new RuntimeException($op . ': unexpected payload shape');
    }

    private function extractStringList(array $payload, string $field, string $op): array
    {
        if (isset($payload[$field]) && is_array($payload[$field])) {
            return array_values(array_map('strval', $payload[$field]));
        }
        if (isset($payload['data']) && is_array($payload['data'])) {
            return array_values(array_map('strval', $payload['data']));
        }
        if ($this->isList($payload)) {
            return array_values(array_map('strval', $payload));
        }
        throw new RuntimeException($op . ': unexpected payload shape');
    }

    private function normalizeMessage(array $message): array
    {
        if (isset($message['attachments']) && is_array($message['attachments'])) {
            foreach ($message['attachments'] as &$attachment) {
                if (is_array($attachment) && isset($attachment['url']) && is_string($attachment['url'])) {
                    $attachment['url'] = $this->ensureAbsoluteUrl($attachment['url']);
                }
            }
            unset($attachment);
        }
        return $message;
    }

    private function normalizeAttachments(array $attachments): array
    {
        foreach ($attachments as &$attachment) {
            if (is_array($attachment) && isset($attachment['url']) && is_string($attachment['url'])) {
                $attachment['url'] = $this->ensureAbsoluteUrl($attachment['url']);
            }
        }
        unset($attachment);
        return $attachments;
    }

    private function ensureAbsoluteUrl(string $url): string
    {
        if ($url === '' || preg_match('#^https?://#i', $url) === 1) {
            return $url;
        }
        if (str_starts_with($url, '/')) {
            return $this->baseUrl . $url;
        }
        return $this->baseUrl . '/' . $url;
    }

    private function buildMultipart(array $fields, array $files): array
    {
        $boundary = '----Botoraptor' . bin2hex(random_bytes(12));
        $body = '';

        foreach ($fields as $field) {
            [$name, $value] = $field;
            $body .= "--{$boundary}\r\n";
            $body .= 'Content-Disposition: form-data; name="' . $this->escapeHeader($name) . "\"\r\n\r\n";
            $body .= $value . "\r\n";
        }

        foreach ($files as $index => $file) {
            $filename = isset($file['filename']) && trim((string)$file['filename']) !== '' ? (string)$file['filename'] : 'file_' . $index;
            $type = isset($file['type']) ? (string)$file['type'] : '';
            $data = isset($file['bytes']) ? (string)$file['bytes'] : (string)$file;

            if ($type !== '') {
                $body .= "--{$boundary}\r\n";
                $body .= 'Content-Disposition: form-data; name="type"' . "\r\n\r\n";
                $body .= $type . "\r\n";
            }

            $body .= "--{$boundary}\r\n";
            $body .= 'Content-Disposition: form-data; name="filename"' . "\r\n\r\n";
            $body .= $filename . "\r\n";

            $body .= "--{$boundary}\r\n";
            $body .= 'Content-Disposition: form-data; name="file"; filename="' . $this->escapeHeader($filename) . "\"\r\n";
            $body .= "Content-Type: " . (isset($file['mime']) && $file['mime'] !== '' ? (string)$file['mime'] : 'application/octet-stream') . "\r\n\r\n";
            $body .= $data . "\r\n";
        }

        $body .= "--{$boundary}--\r\n";
        return [$body, $boundary];
    }

    private function normalizeFileInputs(array $files, ?array $options = null, bool $requireBytes = true): array
    {
        $normalized = [];
        foreach ($files as $index => $file) {
            $opt = $options[$index] ?? [];
            $normalized[] = [
                'bytes' => is_array($file) && array_key_exists('bytes', $file) ? (string)$file['bytes'] : (string)$file,
                'filename' => is_array($file) && array_key_exists('filename', $file) ? (string)$file['filename'] : ($opt['filename'] ?? ''),
                'type' => is_array($file) && array_key_exists('type', $file) ? (string)$file['type'] : ($opt['type'] ?? ''),
                'mime' => is_array($file) && array_key_exists('mime', $file) ? (string)$file['mime'] : ($opt['mime'] ?? ''),
            ];
            if ($requireBytes && $normalized[$index]['bytes'] === '') {
                throw $this->fail(new InvalidArgumentException('file bytes are required'));
            }
        }
        return $normalized;
    }

    private function looksLikeMessage(array $payload): bool
    {
        return isset($payload['botId'], $payload['roomId'], $payload['userId']);
    }

    private function looksLikeUser(array $payload): bool
    {
        return isset($payload['botId'], $payload['userId']);
    }

    private function isList(array $value): bool
    {
        return array_keys($value) === range(0, count($value) - 1);
    }

    private function escapeHeader(string $value): string
    {
        return str_replace(['\\', '"'], ['\\\\', '\\"'], $value);
    }

    private function sleepMs(int $ms): void
    {
        if ($ms <= 0) {
            return;
        }
        usleep($ms * 1000);
    }

    private function handleError(Throwable $error): void
    {
        if (is_callable($this->onError)) {
            try {
                ($this->onError)($error);
            } catch (Throwable $ignored) {
            }
        }
        error_log('[Botoraptor SDK] error: ' . $error->getMessage());
    }

    private function fail(Throwable $error): Throwable
    {
        $this->handleError($error);
        return $error;
    }
}
