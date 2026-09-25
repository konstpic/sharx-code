# Telemt: ./scripts/download-telemt.sh → third_party/telemt-sharx/prebuilt/linux-*/telemt (or DockerInit fallback)
# Build stage
FROM golang:1.26-alpine AS builder

WORKDIR /build
ARG BUILDKIT_INLINE_CACHE=1
# Set by `docker buildx build --platform` (do not use ARG TARGETARCH=amd64: it blocks the auto value).
ARG TARGETARCH

# Install build dependencies (git/make for AmneziaWG sidecar in DockerInit.sh)
RUN apk --no-cache add curl unzip build-base git make linux-headers libmnl-dev

# Copy go mod files first for better caching
COPY go.mod go.sum ./

# Download dependencies with cache mount
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Copy source code
COPY . .

# Build node service with cache mounts
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /build/node-service ./node/main.go

# Same Xray + geo files as the panel image (DockerInit.sh, v26.9.9).
# Run with WORKDIR / so the script’s mkdir -p build/bin creates /build/bin (matches panel layout under /app).
COPY DockerInit.sh /docker-init.sh
WORKDIR /
# Re-state ARG for this RUN (BuildKit: TARGETARCH matches target platform of this stage)
ARG TARGETARCH
RUN sh /docker-init.sh "${TARGETARCH}" && \
    f=$(ls /build/bin/xray-linux-* 2>/dev/null | head -1) && [ -f "$f" ] && \
    [ -f /build/bin/awg ] && [ -f /build/bin/amneziawg-go ] && \
    echo "Xray+geo+telemt+awg in /build/bin:" && ls -la /build/bin/
# Optional overlay: ./scripts/download-telemt.sh produces prebuilt/linux-{amd64,arm64}/telemt
RUN ARCH="" && case "${TARGETARCH}" in amd64) ARCH=linux-amd64 ;; arm64) ARCH=linux-arm64 ;; esac && \
    PRE="/build/third_party/telemt-sharx/prebuilt/${ARCH}/telemt" && \
    if [ -n "$ARCH" ] && [ -f "$PRE" ]; then \
      cp "$PRE" /build/bin/telemt && chmod +x /build/bin/telemt && \
      echo "telemt: prebuilt (${ARCH})"; \
    else \
      echo "telemt: no prebuilt at prebuilt/${ARCH:-skip}/telemt — keeping DockerInit binary"; \
    fi
WORKDIR /build

# Runtime stage
FROM alpine:latest
ARG TARGETARCH

RUN apk --no-cache add ca-certificates tzdata conntrack-tools iptables

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/node-service .

# Copy XRAY binary and data files
# Use wildcard to copy all files from bin directory
COPY --from=builder /build/bin/ ./bin/
# Unmounted copy for /app/bin when a Docker volume is empty (see docker-entrypoint.sh)
COPY --from=builder /build/bin/ /opt/sharx-node-embedded/bin/

# Optional rename path uses same TARGETARCH as build (for legacy layouts with plain `xray` only)
# Verify: exactly one xray-linux-* from build; chmod. Do not hardcode amd64 only.
RUN echo "Contents of /app/bin after COPY:" && ls -la ./bin/ && \
    XRAY=$(find ./bin -maxdepth 1 -name 'xray-linux-*' -type f 2>/dev/null | head -1) && \
    if [ -n "$XRAY" ] && [ -f "$XRAY" ]; then \
        chmod +x "$XRAY" && \
        echo "✓ xray: $XRAY"; \
    elif [ -f ./bin/xray ]; then \
        case "${TARGETARCH}" in \
            arm64) TGT=xray-linux-arm64 ;; \
            arm)   TGT=xray-linux-arm32 ;; \
            386)   TGT=xray-linux-386 ;; \
            *)     TGT=xray-linux-amd64 ;; \
        esac && \
        chmod +x ./bin/xray && mv ./bin/xray "./bin/$TGT" && \
        echo "✓ Renamed xray -> $TGT"; \
    else \
        echo "✗ No xray binary in ./bin" && find ./bin -type f && exit 1; \
    fi

# Create directories for config, logs, and data
RUN mkdir -p /app/config /app/logs /app/data

# Set environment variables for paths
ENV XUI_BIN_FOLDER=/app/bin
ENV XUI_LOG_FOLDER=/app/logs
ENV XUI_DATA_FOLDER=/app/data

# Expose API port
EXPOSE 8080

COPY node/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY scripts/ensure-dev-net-tun.sh /app/scripts/ensure-dev-net-tun.sh
RUN chmod +x /app/docker-entrypoint.sh /app/scripts/ensure-dev-net-tun.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
# Pairing only: SECRET_KEY env; see panel "copy compose"
CMD ["./node-service", "-port", "8080"]
