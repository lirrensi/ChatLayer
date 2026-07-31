// FILE: apps/server/src/index.ts
// PURPOSE: Configure the authenticated Botoraptor HTTP API and serve the manager SPA.
// OWNS: Express middleware, API routes, file access, OpenAPI exposure, and server startup.
// EXPORTS: Default Express application instance.
// DOCS: docs/core/server.md, docs/overview/product.md

import { clientConfigFile, serverConfigFile, uploadsDirectory, webDistributionDirectory } from "./runtimePaths";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { specs, swaggerUi } from "./swagger";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
// File upload utilities
import multer from "multer";
import fs from "fs";
import prisma from "./prismaClient";
import util from "util";
import crypto from "crypto";
import { fileTypeFromBuffer } from "file-type";

import {
    addMessage,
    getMessages,
    addUser,
    getBots,
    getRooms,
    getFilterOptions,
} from "./controllers/messageController";
import { longPoll } from "./helpers/logpollManager";
import { validateUrlForFetch } from "./helpers/ssrfProtection";

// HMAC signing for file URLs
const FILE_SIGNING_SECRET = process.env.FILE_SIGNING_SECRET;
if (!FILE_SIGNING_SECRET) {
    console.warn(
        "WARNING: FILE_SIGNING_SECRET environment variable not set. File signing disabled - uploads will fail.",
    );
}
const DEFAULT_FILE_URL_TTL_SECONDS = 60 * 60; // 1 hour

// Generate HMAC signature for file path + expiry timestamp
function generateSignature(filePath: string, expTs: number): string {
    if (!FILE_SIGNING_SECRET) throw new Error("FILE_SIGNING_SECRET not configured");
    const payload = `${filePath}:${expTs}`;
    return crypto.createHmac("sha256", FILE_SIGNING_SECRET).update(payload).digest("hex");
}

// Generate signed URL for file access
function generateSignedUrl(
    storedFilename: string,
    expiresSec: number = DEFAULT_FILE_URL_TTL_SECONDS,
    filename?: string,
): string {
    if (!FILE_SIGNING_SECRET) throw new Error("FILE_SIGNING_SECRET not configured");
    const expTs = Math.floor(Date.now() / 1000) + expiresSec;
    const sig = generateSignature(`/uploads/${storedFilename}`, expTs);
    let url = `/uploads/${storedFilename}?exp=${expTs}&sig=${sig}`;
    if (filename) {
        // URL-encode filename and sanitize (remove path separators)
        const safeFilename = encodeURIComponent(filename.replace(/[/\\]/g, "_"));
        url += `&filename=${safeFilename}`;
    }
    return url;
}

// Verify HMAC signature for file access
function verifySignature(filePath: string, expTs: number, sig: string): boolean {
    if (!FILE_SIGNING_SECRET) return false;
    const expected = generateSignature(filePath, expTs);
    let providedBuf: Buffer;
    let expectedBuf: Buffer;
    try {
        // Ensure sig is a valid hex string and create buffers safely
        providedBuf = Buffer.from(String(sig), "hex");
        expectedBuf = Buffer.from(expected, "hex");
    } catch (e) {
        // invalid hex or other error -> treat as invalid signature
        return false;
    }
    // timingSafeEqual requires same-length buffers
    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

// Populate signed URLs for internal attachments in messages
function populateSignedUrlsInMessages(messages: any[]): void {
    if (!messages || !Array.isArray(messages)) return;
    for (const msg of messages) {
        if (msg.attachments && Array.isArray(msg.attachments)) {
            for (const att of msg.attachments) {
                if (!att || att.isExternal) continue;
                // If URL already present, skip
                if (att.url) continue;

                // Prefer an internal stored filename if available (private metadata produced at upload time).
                // Otherwise attempt to reconstruct stored filename from id + filename extension.
                let storedFilename: string | null = null;
                if (att._storedFilename && typeof att._storedFilename === "string") {
                    storedFilename = att._storedFilename;
                } else if (att.id && typeof att.id === "string") {
                    const ext = att.filename && typeof att.filename === "string" ? path.extname(att.filename) : "";
                    storedFilename = `${String(att.id)}${ext}`;
                }

                if (storedFilename) {
                    try {
                        att.url = generateSignedUrl(storedFilename, undefined, att.filename);
                    } catch (e) {
                        // If signing not configured, keep url undefined/empty string as per spec
                        att.url = "";
                    }
                } else {
                    // No stored filename information available; leave url empty string so populate step
                    // does not leak signed URL or incorrect path.
                    att.url = "";
                }

                // Remove internal-only metadata before sending to clients
                if (att._storedFilename) {
                    try {
                        delete att._storedFilename;
                    } catch { }
                }
            }
        }
    }
}

// Safe Content-Disposition header helper
// Produces an RFC5987-style header value and strips dangerous characters.
function safeContentDispositionHeader(filename: string): string {
    const cleaned = String(filename)
        .replace(/[\r\n"]/g, "")
        .replace(/[/\\]/g, "_");
    // Use RFC5987 encoding for broad compatibility with non-ASCII names
    const encoded = encodeURIComponent(cleaned);
    return `attachment; filename*=UTF-8''${encoded}`;
}

// Configuration and mutable files are always below the shared data contract.
const configPath = serverConfigFile;
const clientConfigPath = clientConfigFile;

const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
    port?: number;
    apiKeys?: string[];
    corsOrigins?: string[];
    maxFileSize?: number;
    fileTTLSeconds?: number;
    // raw webhooks from config.json (validated below into typed WebhookSupport[])
    webhooks?: any[];
};

const clientConfig = JSON.parse(fs.readFileSync(clientConfigPath, "utf-8"));

const app: express.Application = express();

// Security headers
// CSP disabled intentionally — this is an internal admin panel behind Apache auth.
// Helmet v8 default CSP blocks Vue SPA inline scripts; not needed here.
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiters
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, errorMessage: "Too many requests, please try again later." }
});

const longPollLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, errorMessage: "Too many long-poll connections." }
});

const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, errorMessage: "Too many file uploads, please try again later." }
});

// CORS configuration from config file
const corsOrigins = config.corsOrigins ?? [];
app.use(cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true
}));

app.use(bodyParser.json());

// Apply general rate limiter to all API routes
app.use("/api/", generalLimiter);

// --- Webhook support -------------------------------------------------------
// Load webhooks from config.webhooks (optional). Validate entries against the
// runtime WebhookSupport shape. Invalid entries are skipped with a clear log.
const rawWebhooks = (config as any).webhooks ?? [];
const webhooks: WebhookSupport[] = [];

function isValidStringMap(obj: any): obj is Record<string, string> {
    if (!obj || typeof obj !== "object") return false;
    return Object.keys(obj).every(k => typeof k === "string" && typeof obj[k] === "string");
}

if (!Array.isArray(rawWebhooks)) {
    if ((config as any).webhooks !== undefined) {
        console.error("CONFIG ERROR: config.webhooks is present but not an array - webhook support disabled");
    }
} else {
    for (const [i, w] of rawWebhooks.entries()) {
        if (!w || typeof w !== "object" || typeof w.url !== "string") {
            console.error(`Invalid webhook config at index ${i} - missing/invalid url. Skipping. Entry:`, w);
            continue;
        }

        const headers = isValidStringMap(w.headers) ? w.headers : {};
        const query = isValidStringMap(w.query) ? w.query : {};
        const retry =
            w && typeof w === "object" && typeof w.retry === "object"
                ? {
                    attempts: typeof w.retry.attempts === "number" ? w.retry.attempts : 3,
                    delay_ms: typeof w.retry.delay_ms === "number" ? w.retry.delay_ms : 3000,
                }
                : { attempts: 3, delay_ms: 3000 };

        webhooks.push({
            url: w.url,
            headers,
            query,
            retry,
        });
    }
}

// Async POST to configured webhooks with retry logic.
// Payload uses the same signature produced by getUpdates: { success: true, messages: [...] }
async function sendToWebhooks(payload: any) {
    if (!Array.isArray(webhooks) || webhooks.length === 0) return;

    for (const hw of webhooks) {
        // run each webhook dispatch independently (don't block the main request flow)
        (async () => {
            try {
                const baseUrl = hw.url;
                // Build URL with provided query params
                let urlStr = baseUrl;
                try {
                    const urlObj = new URL(baseUrl);
                    if (hw.query && typeof hw.query === "object") {
                        for (const [k, v] of Object.entries(hw.query)) {
                            urlObj.searchParams.append(k, String(v));
                        }
                    }
                    urlStr = urlObj.toString();
                } catch (e) {
                    // If hw.url is not a full URL, attempt to use it as-is and append query manually
                    if (hw.query && typeof hw.query === "object") {
                        const qs = new URLSearchParams(hw.query as any).toString();
                        urlStr = qs ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${qs}` : baseUrl;
                    }
                }

                const headers = Object.assign({ "Content-Type": "application/json" }, hw.headers || {});

                // choose fetch implementation (Node may not have global fetch)
                const fetchFn: any = (globalThis as any).fetch ? (globalThis as any).fetch : null;

                const attempts = hw.retry?.attempts ?? 3;
                const delayMs = hw.retry?.delay_ms ?? 3000;

                for (let attempt = 1; attempt <= attempts; attempt++) {
                    try {
                        let res: any;
                        if (fetchFn) {
                            res = await fetchFn(urlStr, {
                                method: "POST",
                                headers,
                                body: JSON.stringify(payload),
                            });
                        } else {
                            // dynamic import of node-fetch as fallback
                            // @ts-ignore - optional runtime fallback import; node-fetch may not be installed in all environments
                            const nf = await import("node-fetch").then(m => m.default || m);
                            res = await nf(urlStr, {
                                method: "POST",
                                headers,
                                body: JSON.stringify(payload),
                            });
                        }

                        const ok = res && (res.status === 200 || res.status === 204);
                        if (ok) {
                            // success - no further action for this webhook
                            break;
                        } else {
                            let bodyText = "";
                            try {
                                bodyText = await (res.text ? res.text() : Promise.resolve(String(res)));
                            } catch (e) {
                                bodyText = `unable to read response body: ${String(e)}`;
                            }
                            console.error(
                                `Webhook POST to ${hw.url} attempt ${attempt} returned status ${res?.status}. Response: ${bodyText}`,
                            );
                            if (attempt < attempts) {
                                await new Promise(r => setTimeout(r, delayMs));
                                continue;
                            }
                        }
                    } catch (err) {
                        console.error(`Webhook POST to ${hw.url} attempt ${attempt} failed:`, err);
                        if (attempt < attempts) {
                            await new Promise(r => setTimeout(r, delayMs));
                            continue;
                        }
                    }
                }
            } catch (innerErr) {
                console.error("sendToWebhooks internal error for webhook", hw, innerErr);
            }
        })();
    }
}

// Use process.cwd() for ES module compatibility (tsx runs from project root)
const distPath = webDistributionDirectory;
const uploadsPath = uploadsDirectory;
// ensure uploads dir exists
if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
}

// Serve uploads behind signature or API key middleware (protect access)
// Add custom 404 handler for missing files to prevent falling through to SPA catch-all
app.use("/uploads", (req, res, next) => {
    console.log(`[UPLOADS] Request: ${req.method} ${req.path}`);
    return verifySignedOrApiKey(req, res, next);
}, (req, res, next) => {
    console.log(`[UPLOADS] Auth passed, serving static: ${req.path}`);
    return express.static(uploadsPath)(req, res, next);
}, (req, res) => {
    console.log(`[UPLOADS 404] File not found: ${req.path}`);
    return res.status(404).json({ success: false, errorMessage: "File not found" });
});
// Serve SPA and other public assets
app.use(express.static(distPath));

/**
 * Standard response helpers
 * Response signature:
 * {
 *   success: boolean,
 *   errorMessage?: string,
 *   data: any
 * }
 */
function sendSuccess(res: express.Response, data: any, status = 200) {
    // Flatten response: if caller passed an object, spread its keys at top-level
    // so clients receive: { success: true, ...customKeys }
    // If data is not an object (e.g. array or primitive) keep it under `data`
    if (data && typeof data === "object" && !Array.isArray(data)) {
        return res.status(status).json(Object.assign({ success: true }, data));
    }
    return res.status(status).json({ success: true, data });
}

function sendError(res: express.Response, status: number, message: string, data: any = null) {
    // Flatten error response similarly: spread any object data onto the top-level response
    const base: any = { success: false, errorMessage: message };
    if (data && typeof data === "object" && !Array.isArray(data)) {
        return res.status(status).json(Object.assign(base, data));
    }
    if (data !== null && data !== undefined) {
        base.details = data;
    }
    return res.status(status).json(base);
}

function parseQueryList(value: unknown): string[] {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return values
        .flatMap(item => String(item).split(","))
        .map(item => item.trim())
        .filter(Boolean);
}

// API key middleware
function apiKeyMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    // Accept token via:
    //  - Authorization: Bearer <token>
    //  - x-api-key header
    //  - ?api_key= or ?apiKey= query parameter
    let key = req.header("authorization") as string | undefined;

    // If Authorization header with Bearer scheme was provided, extract the token
    if (typeof key === "string") {
        const m = key.match(/^Bearer\s+(.+)$/i);
        if (m) key = m[1];
    }

    // Fall back to x-api-key header or query params (matching verifySignedOrApiKey pattern)
    if (!key) {
        key = (req.header("x-api-key") || req.query.api_key || req.query.apiKey) as string;
    }

    const keys = (config.apiKeys || []) as string[];
    if (!key || !keys.includes(String(key))) {
        return sendError(res, 401, "Unauthorized - invalid api key");
    }
    return next();
}

// Middleware to verify signed URL OR API key for file access
function verifySignedOrApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
    const { exp, sig, filename } = req.query as any;

    // Check for valid API key first (allows admin access)
    let apiKey = req.header("authorization") as string | undefined;
    if (typeof apiKey === "string") {
        const m = apiKey.match(/^Bearer\s+(.+)$/i);
        if (m) apiKey = m[1];
    }
    if (!apiKey) {
        apiKey = (req.header("x-api-key") || req.query.api_key || req.query.apiKey) as string;
    }
    const keys = (config.apiKeys || []) as string[];
    const hasValidApiKey = apiKey && keys.includes(String(apiKey));

    if (hasValidApiKey) {
        // API key access - set filename header if provided
        if (filename && typeof filename === "string") {
            const decodedFilename = decodeURIComponent(filename);
            res.setHeader("Content-Disposition", safeContentDispositionHeader(decodedFilename));
        }
        return next();
    }

    // Check for valid signature
    if (!exp || !sig || !FILE_SIGNING_SECRET) {
        return sendError(res, 403, "Forbidden - valid signature or API key required");
    }

    const expTs = parseInt(exp, 10);
    if (isNaN(expTs) || expTs < Math.floor(Date.now() / 1000)) {
        return sendError(res, 403, "Forbidden - signature expired");
    }

    // Construct the full request path including the mount point so it matches
    // the path used when generating signatures (e.g. "/uploads/<file>").
    // In Express middleware mounted at "/uploads", `req.path` is relative
    // (e.g. "/<file>") while `req.baseUrl` contains the mount ("/uploads").
    const filePath = `${req.baseUrl || ""}${req.path}`; // e.g. /uploads/filename.ext
    if (!verifySignature(filePath, expTs, sig)) {
        return sendError(res, 403, "Forbidden - invalid signature");
    }

    // Valid signature - set filename header if provided
    if (filename && typeof filename === "string") {
        const decodedFilename = decodeURIComponent(filename);
        res.setHeader("Content-Disposition", safeContentDispositionHeader(decodedFilename));
    }

    next();
}


/**
 * File upload endpoints
 */

// multer setup - store files in uploadsPath and always generate our own UUID for the stored filename.
// IMPORTANT: FILENAME IS NOT ID provided by client — we always generate a server-side UUID and use that as the stored filename/id.
// Preserve original extension when possible by storing as "<uuid><original_ext>"
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: (config.maxFileSize as number) || 10 * 1024 * 1024 },
});

/**
 * Helper - process uploaded files from multer (memoryStorage).
 * - Writes each buffer to disk using server-generated id + inferred extension.
 * - Infers mime/ext via file-type when possible.
 * - Falls back to multipart originalname or generated id for filename metadata.
 * - Accepts body.filename[] and body.type[] as optional fallbacks.
 */
async function processUploadedFiles(files: Express.Multer.File[] | undefined, body: any) {
    if (!files || !Array.isArray(files) || files.length === 0) return [];

    const providedFilenames = Array.isArray(body.filename) ? body.filename : body.filename ? [body.filename] : [];
    const providedTypes = Array.isArray(body.type) ? body.type : body.type ? [body.type] : [];

    const attachments: any[] = [];

    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        // multer memoryStorage places buffer on the file object
        const buf = (f as any).buffer as Buffer;
        // Try to detect type/extension from buffer
        let ft: { ext: string; mime: string } | undefined;
        try {
            ft = await fileTypeFromBuffer(buf);
        } catch {
            ft = undefined;
        }
        const detectedMime = ft?.mime || f.mimetype || "application/octet-stream";
        const detectedExt = ft?.ext ? `.${ft.ext}` : path.extname(f.originalname || "") || "";

        // Generate server-side id (UUID only - no extension in id)
        const id =
            typeof crypto?.randomUUID === "function"
                ? (crypto as any).randomUUID()
                : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const storedFilename = `${id}${detectedExt}`;

        // Write buffer to disk (overwrite if exists - unlikely)
        try {
            await fs.promises.writeFile(path.join(uploadsPath, storedFilename), buf);
        } catch (e) {
            // bubble up error to caller
            throw e;
        }

        // Determine category type (image|video|document|file)
        let type: "image" | "video" | "document" | "file" = "file";
        const allowed = new Set(["image", "video", "document", "file"]);
        const providedType = providedTypes[i];
        if (providedType && allowed.has(providedType)) {
            type = providedType as any;
        } else {
            const category = detectedMime ? detectedMime.split("/")[0] : "";
            if (category === "image") type = "image";
            else if (category === "video") type = "video";
            else if (
                detectedMime &&
                (detectedMime.includes("pdf") ||
                    detectedMime.includes("msword") ||
                    detectedMime.includes("officedocument") ||
                    detectedMime.includes("text"))
            )
                type = "document";
        }

        // Prefer client-provided filename, otherwise originalname, otherwise server id.
        // Sanitize and strip query strings or embedded signed URLs that may have been passed accidentally.
        let rawProvided = providedFilenames[i] || f.originalname || id;
        let filenameMetadata = String(rawProvided || "");
        try {
            // decode any percent-encoding (best-effort)
            filenameMetadata = decodeURIComponent(filenameMetadata);
        } catch {
            // ignore decode errors and keep raw string
        }

        // If client accidentally passed a signed URL or URL-like string, try to extract a sensible filename:
        // - If "filename=" parameter present, prefer its value
        const filenameParamMatch = filenameMetadata.match(/(?:\b|_)filename=([^&]+)/i);
        if (filenameParamMatch && filenameParamMatch[1]) {
            filenameMetadata = decodeURIComponent(filenameParamMatch[1]);
        } else {
            // strip any query string (e.g. "?exp=...&sig=...") and common signed-url suffixes
            filenameMetadata = filenameMetadata.split("?")[0];
            // remove patterns like _exp=... or _sig=... that sometimes appear when clients paste signed urls
            filenameMetadata = filenameMetadata.replace(/[_&](exp|sig|token|expires?)=[^_&]*/gi, "");
        }

        // replace path separators to avoid accidental directories
        filenameMetadata = filenameMetadata.replace(/[/\\]/g, "_");
        // Trim any accidental leftover url-encoding artifacts (=3D etc)
        filenameMetadata = filenameMetadata.replace(/=3D/g, "=").replace(/=26/g, "&");
        // Fallback
        if (!filenameMetadata) filenameMetadata = f.originalname || id;

        // Do NOT store signed URLs in the DB. Attachments should contain only metadata
        // (id = uuid, filename metadata, etc.). Signed URLs are populated dynamically
        // when messages are returned via populateSignedUrlsInMessages.
        attachments.push({
            id: id, // UUID only, no extension
            type,
            isExternal: false,
            filename: filenameMetadata,
            original_name: f.originalname ? String(f.originalname).split("?")[0].replace(/[/\\]/g, "_") : null,
            mime_type: detectedMime,
            size: buf ? buf.length : f.size,
            createdAt: new Date(),
            // Internal server-only helper so future populate/sweep logic can resolve stored file on disk.
            // This will be removed from the object when returning attachments to clients.
            _storedFilename: storedFilename,
        });
    }

    return attachments;
}

/**
 * @openapi
 * /api/v1/uploadFile:
 *   post:
 *     summary: Upload one or more files
 *     tags: [Upload]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       description: Multipart file upload. Clients can send one or more files
 *         under the `file` form field and optionally provide a `type` and
 *         `filename` array. The `type` array must match the number of files
 *         and contain one of `image`, `video`, `document`, or `file`.
 *         The `filename` array is used only for metadata; the server generates
 *         its own storage ID.
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               type:
 *                 type: array
 *                 items:
 *                   type: string
 *               filename:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Files stored and attachment metadata returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attachments:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Attachment'
 *       400:
 *         description: Bad request (e.g., no files uploaded)
 *       500:
 *         description: Internal server error
 */
// POST upload API - accepts a single file under field name "file"
app.post("/api/v1/uploadFile", apiKeyMiddleware, uploadLimiter, upload.array("file"), async (req, res) => {
    try {
        const files = (req as any).files as Express.Multer.File[] | undefined;
        const body = req.body || {};

        if (!files || files.length === 0) {
            return sendError(res, 400, "no files uploaded");
        }

        // If client provided a required type/filename array, we accept them; otherwise we infer per-file.
        // Note: This endpoint previously required type+filename for single upload. We allow those as fallbacks.
        let attachments;
        try {
            attachments = await processUploadedFiles(files, body);
        } catch (e) {
            console.error("uploadFile write error", e);
            return sendError(res, 500, "failed_to_store_files", { details: String(e) });
        }

        // Remove internal-only helpers and ensure url is empty for internal attachments before returning to client.
        if (Array.isArray(attachments)) {
            for (const a of attachments) {
                if (a && a._storedFilename) {
                    try {
                        delete a._storedFilename;
                    } catch { }
                }
                if (a && a.isExternal === false) {
                    // Clients expect url present but empty for internal attachments until messages are fetched.
                    a.url = "";
                }
            }
        }

        return sendSuccess(res, { attachments }, 201);
    } catch (e) {
        console.error("uploadFile error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

/**
 * POST /api/v1/uploadFileByURL
 * - Accepts JSON body: { files: [{ url: string, filename?: string, type?: "image"|"video"|"document"|"file" }] }
 * - Fetches each URL, infers mime/extension, writes files to disk using server-generated id + extension,
 *   and returns attachments[] similar to uploadFile endpoint (internal attachments have url = "" and no _storedFilename).
 */
app.post("/api/v1/uploadFileByURL", apiKeyMiddleware, uploadLimiter, async (req, res) => {
    try {
        const body = req.body || {};
        const inputFiles = Array.isArray(body.files) ? body.files : null;

        if (!inputFiles || inputFiles.length === 0) {
            return sendError(res, 400, "no files provided");
        }

        // SSRF protection: validate all URLs before fetching
        for (const file of inputFiles) {
            if (!file || typeof file.url !== "string") {
                return sendError(res, 400, "each file must include a url");
            }
            const validation = validateUrlForFetch(file.url);
            if (!validation.valid) {
                return sendError(res, 400, "invalid_url", { 
                    url: file.url, 
                    reason: validation.reason 
                });
            }
        }

        const attachments: any[] = [];

        // choose fetch implementation (Node may not have global fetch)
        const fetchFn: any = (globalThis as any).fetch ? (globalThis as any).fetch : null;

        for (const f of inputFiles) {
            if (!f || typeof f.url !== "string" || !f.url) {
                return sendError(res, 400, "each file must include a url");
            }
            const fileUrl = String(f.url);

            // fetch remote resource
            let resp: any;
            try {
                if (fetchFn) {
                    resp = await fetchFn(fileUrl);
                } else {
                    // @ts-ignore optional runtime fallback
                    const nf = await import("node-fetch").then(m => m.default || m);
                    resp = await nf(fileUrl);
                }
            } catch (e) {
                console.error("fetch error for url", fileUrl, e);
                return sendError(res, 500, "failed_to_fetch_remote_file", { details: String(e) });
            }

            if (!resp || (resp.status !== undefined && !(resp.status >= 200 && resp.status < 300))) {
                const status = resp?.status ?? "unknown";
                return sendError(res, 502, "failed_to_fetch_remote_file", {
                    details: `status ${status} for ${fileUrl}`,
                });
            }

            // read as ArrayBuffer -> Buffer
            let buf: Buffer;
            try {
                const ab = await resp.arrayBuffer();
                buf = Buffer.from(ab);
            } catch (e) {
                console.error("failed to read fetched body for", fileUrl, e);
                return sendError(res, 500, "failed_to_read_remote_body", { details: String(e) });
            }

            // Try to detect type/extension from buffer
            let ft: { ext: string; mime: string } | undefined;
            try {
                ft = await fileTypeFromBuffer(buf);
            } catch {
                ft = undefined;
            }

            const detectedMime =
                ft?.mime ||
                (resp.headers && typeof resp.headers.get === "function"
                    ? resp.headers.get("content-type") || "application/octet-stream"
                    : "application/octet-stream");
            const detectedExt = ft?.ext ? `.${ft.ext}` : path.extname((fileUrl || "").split("?")[0]) || "";

            // Generate server-side id (UUID only - no extension in id)
            const id =
                typeof crypto?.randomUUID === "function"
                    ? (crypto as any).randomUUID()
                    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const storedFilename = `${id}${detectedExt}`;

            // Write buffer to disk
            try {
                await fs.promises.writeFile(path.join(uploadsPath, storedFilename), buf);
            } catch (e) {
                console.error("writeFile error for", storedFilename, e);
                return sendError(res, 500, "failed_to_store_files", { details: String(e) });
            }

            // Determine category type (image|video|document|file)
            let type: "image" | "video" | "document" | "file" = "file";
            const allowed = new Set(["image", "video", "document", "file"]);
            const providedType = f.type;
            if (providedType && allowed.has(providedType)) {
                type = providedType as any;
            } else {
                const category = detectedMime ? detectedMime.split("/")[0] : "";
                if (category === "image") type = "image";
                else if (category === "video") type = "video";
                else if (
                    detectedMime &&
                    (detectedMime.includes("pdf") ||
                        detectedMime.includes("msword") ||
                        detectedMime.includes("officedocument") ||
                        detectedMime.includes("text"))
                )
                    type = "document";
            }

            // Determine filename metadata: prefer provided filename, otherwise try to extract from URL, otherwise id
            let filenameMetadata = f.filename ? String(f.filename) : "";
            if (!filenameMetadata) {
                try {
                    // extract path basename from URL
                    const parsed = new URL(fileUrl);
                    filenameMetadata = parsed.pathname ? path.basename(parsed.pathname) : "";
                } catch {
                    // fallback: naive split
                    filenameMetadata = (fileUrl || "").split("/").pop() || "";
                }
            }
            // strip query strings and sanitize
            filenameMetadata = filenameMetadata.split("?")[0].replace(/[/\\]/g, "_");
            try {
                filenameMetadata = decodeURIComponent(filenameMetadata);
            } catch {
                // ignore decode errors
            }
            if (!filenameMetadata) filenameMetadata = id;

            attachments.push({
                id,
                type,
                isExternal: false,
                filename: filenameMetadata,
                original_name: null,
                mime_type: detectedMime,
                size: buf ? buf.length : null,
                createdAt: new Date(),
                // internal-only helper to allow future populate to resolve stored file; will be removed before returning
                _storedFilename: storedFilename,
            });
        }

        // Remove internal-only helpers and ensure url is empty for internal attachments before returning to client.
        if (Array.isArray(attachments)) {
            for (const a of attachments) {
                if (a && a._storedFilename) {
                    try {
                        delete a._storedFilename;
                    } catch { }
                }
                if (a && a.isExternal === false) {
                    a.url = "";
                }
            }
        }

        return sendSuccess(res, { attachments }, 201);
    } catch (e) {
        console.error("uploadFileByURL error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

// POST /api/v1/addMessageSingle
// - Convenience endpoint to create a message and upload a single file in the same multipart/form-data request.
// Expects multipart/form-data fields:
//   - file: the binary file (single)
//   - type: one of "image" | "video" | "document" | "file"  (optional; server will try to infer)
//   - filename: original filename hint to store in metadata (optional)
//   - botId, roomId, userId: required message identifiers
//   - username, name: optional user data
//   - messageType, text: optional message fields
//   - meta: optional JSON string or object (if present in form it will be parsed)
app.post("/api/v1/addMessageSingle", apiKeyMiddleware, uploadLimiter, upload.array("file"), async (req, res) => {
    try {
        const files = (req as any).files as Express.Multer.File[] | undefined;
        const body = req.body || {};

        const botId = typeof body.botId === "string" && body.botId ? String(body.botId) : undefined;
        const roomId = typeof body.roomId === "string" && body.roomId ? String(body.roomId) : undefined;
        const userId = typeof body.userId === "string" && body.userId ? String(body.userId) : undefined;

        if (!botId || !roomId || !userId) {
            return sendError(res, 400, "botId, roomId and userId are required");
        }

        const username = typeof body.username === "string" && body.username ? String(body.username) : undefined;
        const name = typeof body.name === "string" && body.name ? String(body.name) : undefined;
        const messageType =
            typeof body.messageType === "string" && body.messageType ? String(body.messageType) : undefined;
        const text = typeof body.text === "string" ? String(body.text) : "";

        // parse meta if provided (allow JSON string)
        let meta: any = null;
        if (body.meta !== undefined && body.meta !== null) {
            if (typeof body.meta === "string") {
                try {
                    meta = JSON.parse(body.meta);
                } catch {
                    meta = body.meta;
                }
            } else {
                meta = body.meta;
            }
        }

        let attachments: any[] | null = null;
        if (files && files.length > 0) {
            try {
                const atts = await processUploadedFiles(files, body);
                // Strip internal-only metadata and ensure url is empty for internal attachments
                if (Array.isArray(atts)) {
                    for (const a of atts) {
                        if (a && a._storedFilename) {
                            try {
                                delete a._storedFilename;
                            } catch { }
                        }
                        if (a && a.isExternal === false) {
                            a.url = "";
                        }
                    }
                }
                attachments = atts.length ? atts : null;
            } catch (e) {
                console.error("addMessageSingle file processing error", e);
                return sendError(res, 500, "failed_to_store_files", { details: String(e) });
            }
        }

        const msgPayload = {
            botId,
            roomId,
            userId,
            username,
            name,
            messageType,
            text,
            attachments,
            meta,
        };

        const msg = await addMessage(msgPayload);
        // Populate signed URLs for internal attachments before notifying listeners
        populateSignedUrlsInMessages([msg]);

        // notify longpoll listeners (same routing as /addMessage)
        try {
            if (msg.messageType === "manager_message") {
                longPoll.notifyListeners([msg], "bot");
                // send manager_message updates to configured webhooks (bot-side only)
                try {
                    void sendToWebhooks({ success: true, messages: [msg] });
                } catch (e) {
                    console.error("sendToWebhooks scheduling error", e);
                }
            } else {
                longPoll.notifyListeners([msg], "ui");
            }
        } catch (e) {
            console.error("longpoll notify error", e);
        }

        return sendSuccess(res, { message: msg }, 201);
    } catch (e) {
        console.error("addMessageSingle error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

// Sweep job: remove files older than configured TTL by scanning message attachments
const unlink = util.promisify(fs.unlink);
async function sweepOldFiles() {
    try {
        const ttlSec = (config.fileTTLSeconds as number) ?? 604800;
        const cutoff = new Date(Date.now() - ttlSec * 1000);

        // Find messages that have attachments
        const msgs = await prisma.message.findMany({
            where: { attachments: { not: null } as any },
            select: { id: true, attachments: true },
        });

        for (const m of msgs) {
            const atts = (m as any).attachments as any[] | null;
            if (!Array.isArray(atts) || atts.length === 0) continue;

            let changed = false;
            const keep: any[] = [];

            for (const a of atts) {
                try {
                    if (a && a.createdAt) {
                        const created = new Date(a.createdAt);
                        // Determine stored filename: prefer a.id (server-side stored filename), otherwise fall back to a.filename.
                        // Avoid synchronous filesystem scans - storage filename equals id by design.
                        let storedFileName: string | null = null;
                        if (a && a._storedFilename) {
                            storedFileName = String(a._storedFilename);
                        } else if (a && a.id) {
                            // reconstruct from id + extension if filename contains one
                            const ext = a.filename && typeof a.filename === "string" ? path.extname(a.filename) : "";
                            storedFileName = `${String(a.id)}${ext}`;
                        } else if (a && a.filename) {
                            storedFileName = String(a.filename);
                        }

                        if (created < cutoff && storedFileName) {
                            // delete file from disk if present (attempt unlink and ignore ENOENT)
                            const filePath = path.join(uploadsPath, storedFileName);
                            try {
                                await unlink(filePath);
                            } catch (e: any) {
                                if (e && e.code !== "ENOENT") {
                                    console.error("failed to unlink file", filePath, e);
                                }
                            }
                            changed = true;
                            continue; // skip adding to keep
                        }
                    }
                } catch (e) {
                    // malformed attachment entry - keep it to avoid data loss
                    console.error("sweep attachment error", e);
                }
                keep.push(a);
            }

            if (changed) {
                // update message attachments (set to null if empty)
                await prisma.message.update({
                    where: { id: (m as any).id },
                    data: { attachments: keep.length ? (keep as any) : null },
                });
            }
        }
    } catch (e) {
        console.error("sweepOldFiles error", e);
    }
}

// schedule hourly
setInterval(sweepOldFiles, 1000 * 60 * 60);
void sweepOldFiles();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     responses:
 *       200:
 *         description: OK
 */
app.get("/health", (_req, res) => sendSuccess(res, { ok: true }));
app.get("/api/v1/health", (_req, res) => sendSuccess(res, { ok: true }));

/**
 * @openapi
 * /getClientConfig:
 *   get:
 *     summary: Get client configuration
 *     responses:
 *       200:
 *         description: Client configuration data
 */
app.get("/api/v1/getClientConfig", (req: express.Request, res: express.Response) => {
    console.log(
        "[HANDLER] GET /api/v1/getClientConfig reached.",
        "originalUrl=",
        req.originalUrl,
        "baseUrl=",
        req.baseUrl,
        "path=",
        req.path,
        "authorization=",
        req.header("authorization"),
    );
    return sendSuccess(res, { data: clientConfig });
});

/**
 * @openapi
 * /addMessage:
 *   post:
 *     summary: Add a message to the store and notify listeners
 *     description: >
 *       Adds a message to the database. The server will route a notification
 *       to long-poll listeners based on the message's `messageType`:
 *         - `manager_message` => notified to listeners with role `bot`
 *         - all other message types => notified to listeners with role `ui`
 *       Note: `roomId` is preserved for backwards compatibility but listener routing
 *       is performed by `botId`/`messageType` and the long-poll manager roles.
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               botId: { type: string }
 *               roomId: { type: string }
 *               userId: { type: string }
 *               text: { type: string }
 *               messageType: { type: string, description: "Determines routing: 'manager_message' -> bot listeners; others -> ui listeners" }
 *               tags: { type: array, items: { type: string }, description: "Arbitrary classification tags" }
 *     responses:
 *       201:
 *         description: Message created
 */
app.post("/api/v1/addMessage", apiKeyMiddleware, async (req, res) => {
    try {
        const body = req.body;
        if (!body || !body.botId || !body.roomId || !body.userId) {
            return sendError(res, 400, "botId, roomId and userId are required");
        }

        const msg = await addMessage(body);
        // Populate signed URLs for internal attachments before notifying listeners
        populateSignedUrlsInMessages([msg]);
        // notify longpoll listeners (route by listener type)
        try {
            // manager_message should notify bot listeners; all other messages notify UI listeners
            if (msg.messageType === "manager_message") {
                longPoll.notifyListeners([msg], "bot");
                // send manager_message updates to configured webhooks (bot-side only)
                try {
                    void sendToWebhooks({ success: true, messages: [msg] });
                } catch (e) {
                    // protect against unexpected errors in webhook dispatch
                    console.error("sendToWebhooks scheduling error", e);
                }
            } else {
                longPoll.notifyListeners([msg], "ui");
            }
        } catch (e) {
            console.error("longpoll notify error", e);
        }

        return sendSuccess(res, { message: msg }, 201);
    } catch (e) {
        console.error("addMessage error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

/**
 * @openapi
 * /addUser:
 *   post:
 *     summary: Create or get a user (idempotent)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               botId: { type: string }
 *               userId: { type: string }
 *               username: { type: string }
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: User created or returned
 */
app.post("/api/v1/addUser", apiKeyMiddleware, async (req, res) => {
    try {
        const body = req.body;
        if (!body || !body.botId || !body.userId) {
            return sendError(res, 400, "botId and userId are required");
        }

        const user = await addUser(body.botId, body.userId, body.username, body.name);
        return sendSuccess(res, { user }, 200);
    } catch (e) {
        console.error("addUser error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

/**
 * @openapi
 * /getMessages:
 *   get:
 *     summary: Get messages (newest first, default limit 50)
 *     parameters:
 *       - in: query
 *         name: botId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: string
 *       - in: query
 *         name: cursorId
 *         schema:
 *           type: integer
 *         description: Message ID cursor for pagination (returns messages older than this ID)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Max messages to return (default 50)
 *       - in: query
 *         name: types
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: list of messages
 */
app.get("/api/v1/getMessages", apiKeyMiddleware, async (req, res) => {
    try {
        const { botId, roomId, cursorId, limit, types, userId, longPoll, timeout } = req.query as any;
        if (!botId) {
            return sendError(res, 400, "botId is required");
        }

        if (longPoll === "true" || longPoll === "1") {
            // Long-poll mode: wait for new messages
            const pollTimeout = timeout ? parseInt(timeout, 10) : 60000;
            const messages = await longPoll.waitForMessages([botId], pollTimeout, "ui");
            // Filter by roomId and userId if provided
            let filtered = messages;
            if (roomId) filtered = filtered.filter((m: any) => m.roomId === roomId);
            if (userId) filtered = filtered.filter((m: any) => m.userId === userId);
            // Apply limit
            const limitNum = limit ? parseInt(limit, 10) : 50;
            if (filtered.length > limitNum) filtered = filtered.slice(0, limitNum);
            populateSignedUrlsInMessages(filtered);
            return sendSuccess(res, { messages: filtered });
        }

        // Normal mode: direct DB query
        const opts: any = {
            botId,
            roomId,
            userId,
            cursorId: cursorId ? parseInt(cursorId, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        };
        if (types) {
            opts.types = String(types)
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean);
        }
        const rows = await getMessages(opts);
        populateSignedUrlsInMessages(rows);
        return sendSuccess(res, { messages: rows });
    } catch (e) {
        console.error("getMessages error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

/**
 * @openapi
 * /getBots:
 *   get:
 *     summary: Get distinct botIds from messages
 *     responses:
 *       200:
 *         description: list of bot ids
 */
app.get("/api/v1/getBots", apiKeyMiddleware, async (_req, res) => {
    try {
        const bots = await getBots();
        return sendSuccess(res, { bots });
    } catch (e) {
        console.error("getBots error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

/**
 * @openapi
 * /getFilterOptions:
 *   get:
 *     summary: Get distinct message types and normalized tags
 *     description: Values are discovered across all persisted messages, independent of the selected bot.
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Complete filter option lists
 */
app.get("/api/v1/getFilterOptions", apiKeyMiddleware, async (_req, res) => {
    try {
        const options = await getFilterOptions();
        return sendSuccess(res, options);
    } catch (e) {
        console.error("getFilterOptions error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

/**
 * @openapi
 * /getRooms:
 *   get:
 *     summary: Get distinct rooms for a botId (returns rooms with users and lastMessage)
 *     parameters:
 *       - in: query
 *         name: botId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: messageType
 *         schema:
 *           type: string
 *         description: Legacy singular message type filter.
 *       - in: query
 *         name: messageTypes
 *         schema:
 *           type: string
 *         description: Comma-separated message types; values are ORed within this group.
 *       - in: query
 *         name: depth
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Number of recent messages to check for message types and tags (default 10).
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated tags; values are ORed within the tag group and ANDed with message type filters.
 *     responses:
 *       200:
 *         description: list of rooms
 */
app.get("/api/v1/getRooms", apiKeyMiddleware, async (req, res) => {
    try {
        const { botId, messageType, messageTypes, depth, limit, cursorId, tags } = req.query as any;
        if (!botId) {
            return sendError(res, 400, "botId is required");
        }

        const result = await getRooms({
            botId: String(botId),
            messageType: messageType ? String(messageType) : undefined,
            messageTypes: parseQueryList(messageTypes),
            depth: depth ? parseInt(depth, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            cursorId: cursorId ? String(cursorId) : undefined,
            tags: parseQueryList(tags),
        });
        // Populate signed URLs in lastMessage attachments
        if (result.rooms) {
            for (const room of result.rooms) {
                if (room.lastMessage) {
                    populateSignedUrlsInMessages([room.lastMessage]);
                }
            }
        }
        return sendSuccess(res, result);
    } catch (e) {
        console.error("getRooms error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

/**
 * @openapi
 * /getUpdates:
 *   get:
 *     summary: Longpoll for updates (waits until messages arrive or timeout)
 *     description: >
 *       Long-poll endpoint used by both UI and bot listeners. Query parameters:
 *         - botIds: optional comma-separated list of botIds to listen for (e.g. botIds=botA,botB).
 *           When omitted or empty and listenerType=ui, the listener will receive updates for all bots.
 *         - botId: legacy single-bot parameter (equivalent to botIds=botId).
 *         - listenerType: 'bot' or 'ui' (defaults to 'bot' if not provided). 'bot' listeners must provide botIds.
 *         - timeoutMs: long-poll timeout in milliseconds.
 *       Behavior:
 *         - UI listeners (listenerType=ui): may omit botIds to listen to all bots; receive non-manager messages.
 *         - Bot listeners (listenerType=bot): must provide one or more botIds and will receive manager_message messages for those bots.
 *     parameters:
 *       - in: query
 *         name: botIds
 *         schema:
 *           type: string
 *         description: "Comma-separated list of botIds to listen for (e.g. 'botA,botB')."
 *       - in: query
 *         name: botId
 *         schema:
 *           type: string
 *         description: "Legacy single botId parameter (use botIds instead)."
 *       - in: query
 *         name: listenerType
 *         schema:
 *           type: string
 *           enum: [bot, ui]
 *         description: "Listener role: 'bot' or 'ui'."
 *       - in: query
 *         name: timeoutMs
 *         schema:
 *           type: integer
 *         description: "Long-poll timeout in milliseconds"
 *     responses:
 *       200:
 *         description: array of messages (may be empty on timeout)
 */
app.get("/api/v1/getUpdates", apiKeyMiddleware, longPollLimiter, async (req, res) => {
    try {
        // New: support botIds[] (comma-separated) and listenerType (bot|ui).
        // - UI listeners: listenerType=ui and botIds may be omitted or empty => listen to all bots
        // - Bot listeners: listenerType=bot must provide at least one botId (or supply default in SDK constructor)
        const { botIds, botId, timeoutMs, listenerType } = req.query as any;

        // parse botIds (either "botIds=a,b" or legacy "botId=single")
        let botIdArray: string[] | null = null;
        if (botIds) {
            botIdArray = String(botIds)
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean);
        } else if (botId) {
            botIdArray = [String(botId)];
        }

        const lt = listenerType === "ui" ? "ui" : "bot";
        if (lt === "bot" && (!botIdArray || botIdArray.length === 0)) {
            return sendError(res, 400, "botIds are required for listenerType=bot");
        }

        const timeout = timeoutMs ? parseInt(timeoutMs, 10) : 60000;
        const messages = await longPoll.waitForMessages(botIdArray ?? null, timeout, lt as "bot" | "ui");
        populateSignedUrlsInMessages(messages);
        return sendSuccess(res, { messages });
    } catch (e) {
        console.error("getUpdates error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

app.get("/apiKeyCheck", (req, res) => {
    try {
        // Accept token via:
        //  - Authorization: Bearer <token>
        //  - legacy x-api-key header
        //  - api_key or apiKey query parameter
        let key = req.header("authorization") as string | undefined;

        // If Authorization header with Bearer scheme was provided, extract the token
        if (typeof key === "string") {
            const m = key.match(/^Bearer\s+(.+)$/i);
            if (m) key = m[1];
        }

        const keys = (config.apiKeys || []) as string[];
        if (!key || !keys.includes(String(key))) {
            // Return 403 when key is invalid per request
            return res.status(403).json({ success: false, errorMessage: "Forbidden - invalid api key" });
        }

        return res.status(200).json({ success: true, ok: true });
    } catch (e) {
        console.error("apiKeyCheck error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

interface WebhookSupport {
    url: string;
    headers: Record<string, string>; // default {} + "Content-Type": "application/json" as default
    query: Record<string, string>; // default {}
    retry: {
        attempts: number; // default 3,
        delay_ms: number; // default 3000
    };
}

/**
 * Minimal OpenAPI JSON assembled from JSDoc-like annotations above.
 * This is a simple static object to provide basic API docs.
 */
const openapi = {
    openapi: "3.0.0",
    info: {
        title: "Botoraptor API",
        version: "4.0.0",
        description: "Simple human-in-the-loop chat middleware API with ChatLayer compatibility",
    },
    paths: {
        "/api/v1/health": {
            get: {
                summary: "Health check",
                responses: { "200": { description: "OK" } },
            },
        },
        "/api/v1/addMessage": {
            post: {
                summary: "Add message and notify listeners",
                requestBody: { content: { "application/json": { schema: { type: "object" } } } },
                responses: { "201": { description: "Created" } },
            },
        },
        "/api/v1/addMessageSingle": {
            post: {
                summary: "Add message and upload a single file (multipart/form-data)",
                description:
                    "Creates a message and uploads a single file in the same request. Expects multipart/form-data with fields: file, type, filename, botId, roomId, userId, text, messageType, username, name, meta (meta may be JSON string).",
                requestBody: {
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                            },
                        },
                    },
                },
                responses: { "201": { description: "Created" } },
            },
        },
        "/api/v1/getMessages": {
            get: {
                summary: "Query messages (newest first, default limit 50)",
                parameters: [
                    { name: "botId", in: "query", required: true, schema: { type: "string" } },
                    { name: "roomId", in: "query", schema: { type: "string" } },
                    { name: "cursorId", in: "query", schema: { type: "integer" }, description: "Message ID cursor; returns messages older than this ID" },
                    { name: "limit", in: "query", schema: { type: "integer" }, description: "Max messages to return (default 50)" },
                    { name: "types", in: "query", schema: { type: "string" } },
                ],
                responses: { "200": { description: "OK" } },
            },
        },
        "/api/v1/getUpdates": {
            get: {
                summary: "Longpoll for updates",
                parameters: [
                    {
                        name: "botIds",
                        in: "query",
                        schema: { type: "string" },
                        description: "Comma-separated list of botIds (e.g. 'botA,botB')",
                    },
                    {
                        name: "botId",
                        in: "query",
                        schema: { type: "string" },
                        description: "Legacy single botId parameter (use botIds instead)",
                    },
                    {
                        name: "listenerType",
                        in: "query",
                        schema: { type: "string", enum: ["bot", "ui"] },
                        description: "Listener role: 'bot' or 'ui' (default 'bot')",
                    },
                    {
                        name: "timeoutMs",
                        in: "query",
                        schema: { type: "integer" },
                        description: "Long-poll timeout in ms",
                    },
                ],
                responses: { "200": { description: "OK" } },
            },
        },
    },
};

// Prefer generated specs (from JSDoc) when they contain documented paths,
// otherwise fall back to the minimal static `openapi` object above.
const swaggerDoc = specs && Object.keys((specs as any).paths || {}).length > 0 ? (specs as any) : openapi;

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// Serve raw OpenAPI JSON at /api/v1/openapi.json for tools that expect it.
// Return the raw spec (not wrapped) to match common tooling expectations.
app.get("/api/v1/openapi.json", (_req, res) => res.json(swaggerDoc));

// POST /api/v1/sign-file
// Generate a signed URL for an already-stored file.
app.post("/api/v1/sign-file", apiKeyMiddleware, async (req, res) => {
    try {
        const { filename, expiresIn } = req.body || {};
        if (!filename || typeof filename !== "string") {
            return sendError(res, 400, "filename is required");
        }
        const expiresSec = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
        const url = generateSignedUrl(filename, expiresSec, filename);
        return sendSuccess(res, { url });
    } catch (e) {
        console.error("sign-file error", e);
        return sendError(res, 500, "internal_error", { details: String(e) });
    }
});

// API 404 handler - return JSON 404 for unknown API routes
app.use("/api", (_req, res) => {
    return sendError(res, 404, "Not Found - unknown API endpoint");
});

// spa routing fix - explicit root route for Express 5 compatibility
app.get("/", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
// catch-all for other SPA routes (requires at least one char after / in Express 5)
app.get("/*path", (_req, res) => res.sendFile(path.join(distPath, "index.html")));

const port = config.port || 31000;
app.listen(port, () => {
    console.log(`Botoraptor server listening on port ${port}`);
    console.log(`Check web app at => http://localhost:${port}/`);
    console.log(`OpenAPI docs at http://localhost:${port}/api-docs`);
});

export default app;
