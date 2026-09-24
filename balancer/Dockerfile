# SharX balancer agent + HAProxy + nginx (stream). Build from the repo root:
#   docker build -f balancer/Dockerfile -t sharxbalancer .
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder
ARG TARGETOS=linux
ARG TARGETARCH
WORKDIR /build
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w" -o /out/sharx-balancer ./balancer

FROM alpine:3.22
RUN apk --no-cache add ca-certificates tzdata haproxy nginx nginx-mod-stream && \
    mkdir -p /app/data /var/run && rm -f /etc/nginx/http.d/default.conf
WORKDIR /app
COPY --from=builder /out/sharx-balancer /app/sharx-balancer
ENV SHARX_BALANCER_DATA=/app/data
EXPOSE 8080
ENTRYPOINT ["/app/sharx-balancer"]
