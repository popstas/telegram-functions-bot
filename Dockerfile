# Stage 1: application build
FROM node:20-bookworm-slim AS builder

# install dependencies and build
WORKDIR /build
COPY package*.json ./
RUN npm install

# Stage 2: runtime image with uvx
FROM node:20-bookworm-slim

# install ssh, Python and pip, then uv (includes uvx)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      openssh-client ffmpeg wget \
    && rm -rf /var/lib/apt/lists/*
#   python3 py3-pip \
#    && python3 -m pip install --upgrade pip \
#    && pip install uv

# Install uvx
RUN wget -qO- https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# copy application
WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY . .

# healthcheck script
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD npm -s run healthcheck

# default command
CMD ["npm", "run", "start"]
