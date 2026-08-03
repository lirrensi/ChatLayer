# FILE: apps/server/Dockerfile
# PURPOSE: Build the Botoraptor web application and server into one image using the shared data contract.
# OWNS: Reproducible frontend/backend build stages and the production container entrypoint.
# DOCS: README.md, MIGRATION-v4.md

# Stage 1: Build the npm workspace
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace manifests first for dependency-layer caching.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

# Install the complete npm workspace.
RUN npm ci

# Copy application sources after dependencies.
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/
# The UI imports the copyable Node SDK template directly.
COPY sdk-templates/node sdk-templates/node

# Build frontend and server from the workspace.
RUN npm run build --workspace=chat_layer_web_ui
RUN npm run generate --workspace=chat_layer_server
RUN npm run build --workspace=chat_layer_server

# Stage 3: Production Image
FROM node:22-alpine

WORKDIR /app

# Runtime dependencies, builds, and the launcher are copied into this image. The
# launcher must never install into the bind-mounted data directory on startup.
ENV BOTORAPTOR_IMAGE=1 BOTORAPTOR_DOCKER_MODE=1

# Copy the complete built server tree so Prisma CLI and runtime paths agree.
COPY --from=builder /app/apps/server ./apps/server

# Copy frontend build to the canonical application path.
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Copy the lifecycle launcher and root metadata.
COPY tools ./tools
COPY package.json package-lock.json ./

# npm workspaces hoist shared dependencies (express, tsx, prisma, ...) to the
# repository root node_modules; copy them so the image can run without a
# post-start install.
COPY --from=builder /app/node_modules ./node_modules

# Create necessary directories
RUN mkdir -p data/config data/db data/uploads data/backups

# Expose port
EXPOSE 31000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:31000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Initialize/migrate persistent state and start the server.
CMD ["node", "/app/tools/botoraptor.mjs", "start"]
