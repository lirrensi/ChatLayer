// FILE: tools/build-policy.mjs
// PURPOSE: Decide, from artifact freshness, whether the launcher must regenerate the Prisma client and rebuild the server.
// OWNS: Freshness-based server build decisions for the lifecycle launcher.
// EXPORTS: isMissingOrNewer(probe, reference), buildDecisions({ force, schemaFile, generatedClient, compiledServer, compiledClient }).
// DOCS: .agents/reports/plan_launcher-prisma-freshness_2026-08-11.md, docs/core/server.md

import fs from "node:fs";

/**
 * True when the probe file exists and the reference is either missing or older
 * (strictly, by mtimeMs). A missing probe is never "newer" than anything.
 */
export function isMissingOrNewer(probe, reference) {
    if (!fs.existsSync(probe)) return false;
    if (!fs.existsSync(reference)) return true;
    return fs.statSync(probe).mtimeMs > fs.statSync(reference).mtimeMs;
}

/**
 * Freshness-driven build decisions for the server application.
 *
 * - regenerateClient: force, or the generated client is missing, or the schema
 *   is newer than the generated client.
 * - rebuildServer: force, or the compiled server entry is missing, or a client
 *   regeneration was triggered (its output must be compiled), or the generated
 *   client is newer than the compiled client under dist/generated.
 */
export function buildDecisions({ force, schemaFile, generatedClient, compiledServer, compiledClient }) {
    const regenerateClient = force || isMissingOrNewer(schemaFile, generatedClient);
    const rebuildServer =
        force
        || !fs.existsSync(compiledServer)
        || regenerateClient
        || isMissingOrNewer(generatedClient, compiledClient);
    return { regenerateClient, rebuildServer };
}
