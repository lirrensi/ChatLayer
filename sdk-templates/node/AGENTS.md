# Agent Guidelines for ChatLayer SDK

## Build, Lint, and Test Commands

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage

# Run a single test file
pnpm test <test-file-name>

# Run a specific test within a file
pnpm test -- -t "test name"

# Type-check (via TypeScript compiler)
npx tsc --noEmit
```

## Code Style Guidelines

### TypeScript Configuration
- **Target**: ES2020
- **Module**: CommonJS
- **Strict Mode**: Enabled
- **Module Resolution**: Node
- **Declaration**: Enabled (generates .d.ts files)

### Imports and Modules
- Primary codebase is a single self-contained file (`chatLayerSDK.ts`)
- No external imports in the SDK code
- Test files import from `tests/mocks/fetchMock`
- Use `import { ... } from '...'` for test utilities

### Naming Conventions
- **Classes**: PascalCase (`ChatLayer`, `Message`, `User`)
- **Types/Interfaces**: PascalCase (`ChatLayerConfig`, `Attachment`)
- **Variables/Methods**: camelCase (`addMessage`, `botId`, `getMessages`)
- **Private fields**: camelCase with underscore prefix (`_listeners`, `_running`)
- **Constants**: UPPER_SNAKE_CASE (no explicit constants in current codebase)

### Type System
- Always use TypeScript types; avoid `any` when possible
- Use union types for explicit options (e.g., `"bot" | "ui"`)
- Use `?` for optional properties
- Provide clear, descriptive type names
- Mirror server Prisma schema types where applicable (see `chatLayerSDK.ts` types)

### Documentation (JSDoc)
- Always document public methods with JSDoc comments
- Include:
  - Brief description of what the method does
  - @param tags for all parameters
  - @returns tag for return types
  - @example showing usage (required for complex methods)
- Use JSDoc for inline comments when needed (especially for complex logic)

### Error Handling
- **Pattern**: Create error → call `this.handleError(err)` → throw error
- Always catch and handle response text failures (`await res.text().catch(() => "")`)
- Use specific error messages including status code and response text
- Errors are logged via `onError` callback and console.error
- Never throw errors without calling `handleError` first

### Formatting
- **Indentation**: 2 spaces (consistent with existing code)
- **Quotes**: Single quotes preferred (`'botId'` not `"botId"`)
- **Trailing Commas**: Not used (consistent with existing code)
- **Semicolons**: Required (consistent with TypeScript strict mode)
- **Line Length**: Keep lines under 100 characters when possible
- **Spacing**: No spaces after function names, spaces around operators

### Code Structure
- Public API: Class methods and exported types at top of file
- Private methods grouped together at bottom of file
- Use `//` for single-line comments
- Group related functionality (e.g., all upload methods together)
- Use `try/catch` blocks for external API calls
- Always use `await` with Promise-based operations

### Testing Guidelines
- Test files must end with `.test.ts` in `tests/` directory
- Use Jest with ts-jest preset
- Mock `fetch` API in tests using `tests/mocks/fetchMock` utilities
- Maintain 80%+ coverage for all metrics (branches, functions, lines, statements)
- Test both success and error paths
- Use `beforeEach` to reset mocks and global.fetch
- Verify API calls using `verifyFetchCall` utility

### Error Message Style
```typescript
const err = new Error(`operation failed: ${status} ${statusText} ${responseText}`);
this.handleError(err);
throw err;
```

### FormData Handling
- Use type assertions (`as any`) when working with FormData in fetch calls
- This is necessary due to TypeScript's lack of built-in FormData types
- Ensure filename and type are appended correctly for multipart uploads

### Async Patterns
- Always use `async`/`await` instead of Promise chains
- Handle errors in async functions with try/catch
- Never reject unhandled promises (throw errors instead)
- Use `void` for fire-and-forget async operations

### Response Normalization
- SDK normalizes server responses (legacy vs. new format)
- Always check for multiple response shapes:
  - `payload.data` (legacy)
  - `payload.message` (new format)
  - Direct object payload
- Normalize attachment URLs to absolute paths
