// FILE: apps/server/src/swagger.ts
// PURPOSE: Build the OpenAPI document and expose the Swagger UI integration.
// OWNS: Swagger metadata, server URL, and source annotation discovery.
// EXPORTS: specs and swaggerUi.
// DOCS: docs/core/server.md

import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import path from "path";
import { configDirectory, repositoryRoot } from "./runtimePaths";
import fs from "node:fs";

// Load port from server config (or fall back to env / default).
const configPath = path.join(configDirectory, "server.json");
let config: { port?: number } = {};
try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { port?: number };
} catch (e) {
    // ignore: missing config file will be handled by fallback port below
}
const port = process.env.PORT || config.port || 31000;
const host = `http://localhost:${port}`;

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Botoraptor API",
            version: "4.0.0",
            description: "Simple human-in-the-loop chat middleware API with ChatLayer compatibility",
        },
        servers: [
            {
                url: host,
            },
        ],
    },
    // Resolve a glob that points to the server's source files so swagger-jsdoc
    // finds the JSDoc @openapi annotations. Using a path relative to __dirname
    // avoids issues when the process cwd is the project root.
    apis: [path.join(repositoryRoot, "apps", "server", "src", "**", "*.ts")],
};

const specs = swaggerJsdoc(options);

export { specs, swaggerUi };
