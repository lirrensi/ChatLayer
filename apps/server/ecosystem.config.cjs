const fs = require("node:fs");
const path = require("node:path");

// PM2 cannot spawn bare `npm` on Windows (spawn EINVAL) and the npm shim layer
// adds nothing here: run the server with node + the tsx CLI directly, resolved
// the same way tools/botoraptor.mjs resolves it (workspace-local first, then
// the root node_modules where npm workspaces hoist shared binaries).
const root = path.resolve(__dirname, "..", "..");
const tsxCliCandidates = [
    path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
];
const tsxCli = tsxCliCandidates.find(candidate => fs.existsSync(candidate));
if (!tsxCli) {
    throw new Error(
        "Cannot find the tsx CLI needed to run the Botoraptor server. Run `node tools/botoraptor.mjs install` (or `npm install`) at the repository root first.",
    );
}

module.exports = {
    apps: [
        {
            name: "botoraptor", // Friendly name for the process
            script: process.execPath, // The node binary (tsx CLI is a .mjs entry)
            args: [tsxCli, path.join(__dirname, "src", "index.ts")],
            exec_interpreter: "none", // Already invoked directly via node
            exec_mode: "fork", // Suitable for Node.js apps
            instances: 1, // Single instance (SQLite-backed; do not scale beyond one)
            autorestart: true, // Auto-restart on crashes
            watch: false, // Set to true for auto-restart on file changes (dev only)
            max_memory_restart: "1024M", // Restart if memory exceeds 1024M
            cwd: __dirname, // apps/server
            env: {
                NODE_ENV: "production", // Set for production (customize as needed)
            },
        },
    ],
};
