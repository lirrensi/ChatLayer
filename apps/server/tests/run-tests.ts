/**
 * Test Runner for ChatLayer Server
 * 
 * ⚠️ WARNING: These tests use the database directly!
 * - Tests write random user IDs and data to the database
 * - Each test uses unique random IDs to avoid conflicts
 * - Database is NOT cleaned up after tests (data persists)
 * 
 * Usage:
 *   pnpm test        - Run tests against running server
 *   pnpm test:dev    - Run tests with tsx (development)
 * 
 * Prerequisites:
 *   - Server must be running (pnpm dev)
 *   - Database must be accessible
 *   - config/server.json must have valid apiKeys
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🧪 ChatLayer Server Test Runner");
console.log("================================\n");

console.log("⚠️  WARNING: Tests will write to the database directly!");
console.log("   - Random test IDs are used to avoid conflicts");
console.log("   - Test data persists after tests complete");
console.log("   - Clean up manually if needed\n");

const args = process.argv.slice(2);
const useTsx = args.includes("--dev") || args.includes("-d");

const testFile = path.join(__dirname, "server.test.ts");

if (useTsx) {
    console.log("Running tests with tsx (development mode)...\n");
    const child = spawn("npx", ["tsx", "--test", testFile], {
        stdio: "inherit",
        shell: true,
    });

    child.on("exit", (code) => {
        process.exit(code || 0);
    });
} else {
    console.log("Running tests with node (requires compiled dist)...\n");
    const child = spawn("node", ["--test", path.join(__dirname, "../dist/tests/server.test.js")], {
        stdio: "inherit",
        shell: true,
    });

    child.on("exit", (code) => {
        process.exit(code || 0);
    });
}
