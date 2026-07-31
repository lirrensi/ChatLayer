# Agent Guide for ChatLayer Server

This guide helps agentic coding agents work effectively in the ChatLayer codebase.

## Build, Lint, and Test Commands

### Development
- `pnpm run dev` - Start development server with hot reload (tsx)
- `pnpm run build` - Compile TypeScript to `dist/` directory
- `pnpm run typecheck` - Type check without emitting files

### Testing
- `pnpm test:dev` - Run tests directly with tsx (recommended during development)
- `pnpm test` - Run compiled tests from `dist/` directory
- `pnpm test:timeout_safe` - Run tests with 30s hard timeout (Windows batch wrapper)

### Running a Single Test
The project uses Node.js built-in test runner. To run a specific test:
```bash
# Run tests matching a pattern (use describe block name or test name)
tsx --test tests/server.test.ts --test-name-pattern="should create a message"

# Or run all tests and look at the output - tests are organized by describe blocks
tsx --test tests/server.test.ts
```

### Database Operations
- `pnpm run generate` - Generate Prisma client from schema
- `pnpm run migrate` / `pnpm run migrate:dev` - Run database migrations
- `pnpm run db:push` - Push schema changes to database (dev)
- `pnpm run db:reset` - Reset database (dev only - destroys data)
- `pnpm run db:studio` - Open Prisma Studio for database inspection

## Code Style Guidelines

### Imports
- Use ES module syntax (no `require`)
- Third-party imports first, then local imports
- Use double quotes for import paths
- Group related imports together

```typescript
// ✅ Good
import express from "express";
import cors from "cors";
import { addMessage, getMessages } from "./controllers/messageController";
import { longPoll } from "./helpers/logpollManager";
```

### Formatting
- **Indentation:** 4 spaces (no tabs)
- **Quotes:** Double quotes for strings and object keys
- **Semicolons:** Required
- **Trailing commas:** Omit in function calls/objects, include in arrays/objects when multiline
- **Line length:** Aim for ~100-120 characters, soft limit at 150

### Types and Type Safety
- **Strict mode:** Enabled in tsconfig - always type functions and variables
- **Local types:** Define types in controllers to avoid Prisma import issues (see `messageController.ts`)
- **Type assertions:** Use `as any` sparingly, only for Prisma JSON fields or unavoidable cases
- **Interfaces:** Use for object shapes, type aliases for unions/primitives

```typescript
// ✅ Good - Define local types to avoid Prisma import issues
export type Attachment = {
    id: string;
    type: "image" | "video" | "document" | "file";
    isExternal: boolean;
    url?: string | null;
};

// ✅ Good - Use type assertions only when necessary
attachments: attachments ? (attachments as any) : null,
```

### Naming Conventions
- **Variables/Functions:** `camelCase` (e.g., `sendMessage`, `userId`)
- **Classes/Interfaces:** `PascalCase` (e.g., `LongPollManager`, `Message`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `FILE_SIGNING_SECRET`, `DEFAULT_TIMEOUT`)
- **Private members:** Use `private` keyword or underscore prefix (`_helper`)
- **API routes:** `kebab-case` (e.g., `/api/v1/get-messages`)
- **Files:** `camelCase.ts` (e.g., `messageController.ts`, `logpollManager.ts`)

### Error Handling
- **Response helpers:** Use `sendSuccess()` and `sendError()` for consistent API responses
- **Error format:** `{ success: boolean, errorMessage?: string, details?: any }`
- **Logging:** Use `console.error()` for errors, include context
- **Try-catch:** Wrap async operations, especially database and external API calls
- **Graceful degradation:** Optional features (e.g., webhooks) should not fail the main request

```typescript
// ✅ Good error handling
try {
    const msg = await addMessage(payload);
    return sendSuccess(res, { message: msg }, 201);
} catch (e) {
    console.error("addMessage error", e);
    return sendError(res, 500, "internal_error", { details: String(e) });
}

// ✅ Good - Graceful degradation for optional features
try {
    void sendToWebhooks({ success: true, messages: [msg] });
} catch (e) {
    console.error("sendToWebhooks scheduling error", e);
    // Continue - webhook failure doesn't block the response
}
```

### File Organization
```
src/
├── index.ts              # Main entry point, Express app setup, route definitions
├── prismaClient.ts       # Prisma client singleton
├── swagger.ts            # OpenAPI/Swagger configuration
├── controllers/          # Business logic and data access
│   └── messageController.ts
└── helpers/              # Utility functions and managers
    └── logpollManager.ts
```

### Database (Prisma)
- **Schema:** Defined in `prisma/schema.prisma`
- **Client:** Import from `src/prismaClient.ts` (singleton instance)
- **JSON fields:** Cast as `any` when querying/mutating
- **Migrations:** Run `pnpm run migrate` after schema changes
- **Generated types:** Output to `src/generated/` - avoid importing in controllers

```typescript
// ✅ Good - Import prisma client from singleton
import prisma from "../prismaClient";

// ✅ Good - Query with proper error handling
const messages = await prisma.message.findMany({
    where: { botId },
    orderBy: { createdAt: "desc" },
});
```

### API Response Format
All API endpoints should return consistent responses:

**Success:**
```json
{
  "success": true,
  "data": { ... }  // or flattened keys for objects
}
```

**Error:**
```json
{
  "success": false,
  "errorMessage": "Human-readable error message",
  "details": { ... }  // optional additional context
}
```

### Testing Guidelines
- Tests are in `tests/` directory using Node.js built-in test runner
- Each test generates unique IDs using `crypto.randomUUID()` to avoid conflicts
- Test data persists in database (not cleaned up) - note the warning in test output
- Use `assert` from `node:assert` for assertions
- Organize tests with `describe()` blocks by feature/endpoint

```typescript
// ✅ Good test structure
import { describe, it } from "node:test";
import assert from "node:assert";

describe("Message Management", () => {
    it("should create a message", async () => {
        const { status, data } = await request("/api/v1/addMessage", {
            method: "POST",
            body: { botId, roomId, userId, text: "Hello" },
        });
        assert.strictEqual(status, 201);
        assert.strictEqual(data.success, true);
    });
});
```

### Security Notes
- **API keys:** Required for most endpoints (except `/health`, `/getClientConfig`)
- **File uploads:** Protected with HMAC signatures or API key auth
- **Environment:** Never commit `.env` files or secrets
- **Validation:** Always validate required fields and sanitize user input

### Common Patterns

**Route definition:**
```typescript
app.post("/api/v1/endpoint", apiKeyMiddleware, async (req, res) => {
    try {
        // Validate input
        if (!body.requiredField) {
            return sendError(res, 400, "requiredField is required");
        }
        // Process
        const result = await doSomething(body);
        return sendSuccess(res, { result }, 201);
    } catch (e) {
        console.error("endpoint error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});
```

**Controller function:**
```typescript
export async function doSomething(input: InputType): Promise<ReturnType> {
    // Business logic
    // Database operations
    return result;
}
```

## Architecture Notes
- **Framework:** Express.js with TypeScript
- **Database:** SQLite via Prisma ORM
- **File storage:** Local filesystem in `data/uploads/`
- **Long-polling:** Custom implementation in `logpollManager.ts` with role-based routing
- **Webhooks:** Configured in `data/config/server.json`, dispatched asynchronously
- **API docs:** Swagger/OpenAPI available at `/api-docs` when server is running

## Getting Started
1. Install dependencies: `pnpm install`
2. Set up database: `pnpm run db:push` (or `pnpm run migrate`)
3. Configure API keys in `data/config/server.json`
4. Start dev server: `pnpm run dev`
5. Run tests: `pnpm test:dev`
