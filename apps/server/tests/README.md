# Botoraptor Server Tests

⚠️ **WARNING: These tests use the database directly!**

Tests write random user IDs and data to the database. Each test uses unique random IDs (with a test run prefix) to avoid conflicts. Data is NOT cleaned up after tests.

## Prerequisites

1. Server must be running (`pnpm dev`)
2. Database must be accessible (SQLite via Prisma)
3. `config.json` must have valid `apiKeys`

## Running Tests

### Option 1: Direct with tsx (recommended for development)
```bash
pnpm test:dev
```

### Option 2: With compiled JavaScript
```bash
pnpm build
pnpm test
```

### Option 3: Using the test runner
```bash
npx tsx tests/run-tests.ts --dev
```

## Test Coverage

### API Endpoints
- ✅ Health check (`GET /api/v1/health`)
- ✅ Client config (`GET /api/v1/getClientConfig`)
- ✅ OpenAPI spec (`GET /api/v1/openapi.json`)
- ✅ API key validation (`GET /apiKeyCheck`)
- ✅ User management (`POST /api/v1/addUser`)
- ✅ Message management (`POST /api/v1/addMessage`, `GET /api/v1/getMessages`)
- ✅ Bots & rooms (`GET /api/v1/getBots`, `GET /api/v1/getRooms`)
- ✅ File upload (`POST /api/v1/uploadFile`, `POST /api/v1/uploadFileByURL`)
- ✅ Combined message+file (`POST /api/v1/addMessageSingle`)
- ✅ Long polling (`GET /api/v1/getUpdates`)
- ✅ File serving with signatures (`GET /uploads/:file`)

### Controller Functions
- ✅ `addMessage()` - Create messages
- ✅ `getMessages()` - Query with pagination/filters
- ✅ `addUser()` / `createOrGetUser()` - User management
- ✅ `getBots()` - Get distinct bot IDs
- ✅ `getRooms()` - Get rooms with users and last message

### LongPoll Manager
- ✅ `waitForMessages()` - Timeout behavior
- ✅ `notifyListeners()` - Message routing
- ✅ Bot/UI listener types
- ✅ Multi-botId filtering

### Database (Prisma)
- ✅ Direct queries
- ✅ Create/delete operations
- ✅ Relationship queries

## Test Data Pattern

Each test generates unique IDs using:
```typescript
const testRunId = crypto.randomUUID().slice(0, 8);
const genId = (prefix: string) => `${prefix}_${testRunId}_${Date.now()}`;
```

This ensures:
- No conflicts between test runs
- No conflicts between parallel tests
- Traceable test data in database

## Cleaning Up Test Data

Test data is not automatically cleaned up. To clean up manually:

```sql
-- SQLite example
DELETE FROM "User" WHERE botId LIKE '%_testRunId_%';
DELETE FROM "Message" WHERE botId LIKE '%_testRunId_%';
```

Or use Prisma:
```typescript
await prisma.user.deleteMany({ where: { botId: { contains: testRunId } } });
await prisma.message.deleteMany({ where: { botId: { contains: testRunId } } });
```
