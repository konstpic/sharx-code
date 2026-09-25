# ========================================================
# Stage: Next.js static panel
# ========================================================
FROM node:22-alpine AS panelui
WORKDIR /app/panel
# Must match XUI / SharX `webBasePath` (e.g. / or /prefix). `next.config` `basePath` + client `linkP()`.
ARG NEXT_PUBLIC_BASE_PATH=/
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
COPY panel/package.json panel/package-lock.json ./
# react-simple-maps declares peer react@18; panel uses react@19 — same as panel/.npmrc locally.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --cache /root/.npm --prefer-offline --legacy-peer-deps
COPY panel/ ./
RUN npm run build && cp -R out /webpanel

# Telemt: ./scripts/download-telemt.sh → third_party/telemt-sharx/prebuilt/linux-*/telemt (or DockerInit fallback)
# ========================================================
# Stage: Builder
# ========================================================
FROM golang:1.27-alpine AS builder
WORKDIR /app
ARG TARGETARCH
ARG BUILDKIT_INLINE_CACHE=1

RUN apk --no-cache --update add \
  build-base \
  gcc \
  curl \
  unzip \
  bash \
  git \
  make \
  linux-headers \
  libmnl-dev

# Copy go mod files first for better caching
COPY go.mod go.sum ./

# Download dependencies (this layer will be cached if go.mod/go.sum don't change)
# Using cache mount for Go modules to speed up builds
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Copy only Go sources (web/panel comes from panelui; omitted via .dockerignore).
# Panel or doc edits no longer invalidate the compile layer.
COPY config/ ./config/
# Optional: docker build --build-arg SHARX_VERSION=1.2.3 to stamp config/version before compile.
ARG SHARX_VERSION=
RUN if [ -n "$SHARX_VERSION" ]; then printf '%s' "$SHARX_VERSION" > config/version; fi
COPY database/ ./database/
COPY logger/ ./logger/
COPY util/ ./util/
COPY conndrop/ ./conndrop/
COPY xray/ ./xray/
COPY telemt/ ./telemt/
COPY amneziawg/ ./amneziawg/
COPY sub/ ./sub/
COPY node/ ./node/
# Go API and services (.dockerignore omits web/panel/; static UI comes from panelui below).
COPY web/ ./web/
# Optional Telemt prebuilt binary (see scripts/download-telemt.sh); small layer, avoids compile in image build.
COPY third_party/telemt-sharx/prebuilt/ ./third_party/telemt-sharx/prebuilt/
COPY main.go ./
COPY DockerInit.sh DockerEntrypoint.sh ./
COPY scripts/ensure-dev-net-tun.sh ./scripts/
COPY --from=panelui /webpanel/ ./web/panel

# Make all .sh files executable and fix line endings if needed
RUN chmod +x *.sh && \
    sed -i 's/\r$//' *.sh && \
    ls -la DockerInit.sh

ENV CGO_ENABLED=1
ENV CGO_CFLAGS="-D_LARGEFILE64_SOURCE"

# Build with cache mount for Go build cache
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go build -ldflags "-w -s" -o build/x-ui main.go

RUN bash DockerInit.sh "$TARGETARCH"
RUN ARCH="" && case "${TARGETARCH}" in amd64) ARCH=linux-amd64 ;; arm64) ARCH=linux-arm64 ;; esac && \
    PRE="/app/third_party/telemt-sharx/prebuilt/${ARCH}/telemt" && \
    if [ -n "$ARCH" ] && [ -f "$PRE" ]; then \
      cp "$PRE" /app/build/bin/telemt && chmod +x /app/build/bin/telemt && \
      echo "telemt: prebuilt (${ARCH})"; \
    else \
      echo "telemt: no prebuilt at prebuilt/${ARCH:-skip}/telemt — keeping DockerInit binary"; \
    fi

# ========================================================
# Stage: Final Image of SharX
# ========================================================
FROM alpine
ENV TZ=Asia/Tehran
WORKDIR /app

RUN apk add --no-cache --update \
  ca-certificates \
  tzdata \
  fail2ban \
  bash \
  postgresql-client \
  conntrack-tools

COPY --from=builder /app/build/ /app/
COPY --from=builder /app/DockerEntrypoint.sh /app/
COPY --from=builder /app/scripts/ensure-dev-net-tun.sh /app/scripts/ensure-dev-net-tun.sh

# Configure fail2ban
RUN rm -f /etc/fail2ban/jail.d/alpine-ssh.conf \
  && cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local \
  && sed -i "s/^\[ssh\]$/&\nenabled = false/" /etc/fail2ban/jail.local \
  && sed -i "s/^\[sshd\]$/&\nenabled = false/" /etc/fail2ban/jail.local \
  && sed -i "s/#allowipv6 = auto/allowipv6 = auto/g" /etc/fail2ban/fail2ban.conf

RUN chmod +x \
  /app/DockerEntrypoint.sh \
  /app/scripts/ensure-dev-net-tun.sh \
  /app/x-ui

ENV XUI_ENABLE_FAIL2BAN="true"
EXPOSE 2053
VOLUME [ "/etc/x-ui" ]
CMD [ "./x-ui" ]
ENTRYPOINT [ "/app/DockerEntrypoint.sh" ]
