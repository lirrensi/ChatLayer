module.exports = {
    apps: [
        {
            name: "chatLayer", // Friendly name for the process
            script: "npm", // Run npm directly
            args: "run start:prod", // Execute the "start" script from package.json (exactly as 'npm run start' works)
            exec_interpreter: "none", // N/A for npm
            exec_mode: "fork", // Suitable for Node.js apps
            instances: 1, // Single instance for a bot
            autorestart: true, // Auto-restart on crashes
            watch: false, // Set to true for auto-restart on file changes (dev only)
            max_memory_restart: "1024M", // Restart if memory exceeds 500MB
            env: {
                NODE_ENV: "production", // Set for production (customize as needed)
            },
            cwd: process.cwd(), // Ensures PM2 runs from the correct directory
        },
    ],
};
