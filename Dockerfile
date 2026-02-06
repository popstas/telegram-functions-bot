# Stage 1: application build
FROM node:24-bookworm-slim AS builder

# install dependencies and build
WORKDIR /build
COPY package*.json ./
RUN npm install

# Stage 2: runtime image with uvx
FROM node:24-bookworm-slim

# install ssh, ffmpeg
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      openssh-client ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy uv and uvx from official Astral image (recommended over install script)
# https://docs.astral.sh/uv/guides/integration/docker/
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# copy application
WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY . .

# healthcheck script
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD npm -s run healthcheck

# default command
CMD ["npm", "run", "start"]
