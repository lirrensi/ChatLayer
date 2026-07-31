# FILE: apps/server/Dockerfile
# PURPOSE: Build the Botoraptor web application and server into one image using the shared data contract.
# OWNS: Reproducible frontend/backend build stages and the production container entrypoint.
# DOCS: README.md, MIGRATION-v4.md

# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app/apps/web

# Copy web package files
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm@11.13.1 && \
    pnpm install --frozen-lockfile

# Copy web source
COPY apps/web/ ./
# The UI imports the copyable Node SDK template directly.
COPY sdk-templates/node /app/sdk-templates/node

# Build frontend
RUN pnpm run build

# Stage 2: Build Server
FROM node:22-alpine AS server-builder

WORKDIR /app/apps/server

# Copy server package files
COPY apps/server/package.json apps/server/pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm@11.13.1 && \
    pnpm install --frozen-lockfile

# Copy server source
COPY apps/server/ ./

# Generate Prisma client
RUN pnpm run generate

# Build TypeScript
RUN pnpm run build

# Stage 3: Production Image
FROM node:22-alpine

WORKDIR /app

# Install pnpm for runtime
RUN npm install -g pnpm@11.13.1

# Runtime dependencies, builds, and the launcher are copied into this image. The
# launcher must never install into the bind-mounted data directory on startup.
ENV BOTORAPTOR_IMAGE=1 BOTORAPTOR_DOCKER_MODE=1

# Copy the complete built server tree so Prisma CLI and runtime paths agree.
COPY --from=server-builder /app/apps/server ./apps/server

# Copy frontend build to the canonical application path.
COPY --from=frontend-builder /app/apps/web/dist ./apps/web/dist

# Copy the lifecycle launcher and root metadata.
COPY tools ./tools
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Create necessary directories
RUN mkdir -p data/config data/db data/uploads data/backups

# Expose port
EXPOSE 31000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:31000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Initialize/migrate persistent state and start the server.
CMD ["node", "/app/tools/botoraptor.mjs", "start"]
