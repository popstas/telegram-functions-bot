# Stage 1: application build
FROM node:20-alpine AS builder

# install dependencies and build
WORKDIR /build
COPY package*.json ./
RUN npm install

# Stage 2: runtime image with uvx
FROM node:20-alpine

# install ssh, Python and pip, then uv (includes uvx)
RUN apk update \
   && apk add --no-cache openssh ffmpeg
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

# default command
CMD ["npm", "run", "start"]
