# Use a tested SharX worker image containing the matching Xray binary.
ARG XRAY_IMAGE
FROM ${XRAY_IMAGE} AS xray
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS builder
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY verifier ./verifier
COPY network ./network
COPY node/nodecache ./node/nodecache
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -trimpath -o /verifier ./verifier
FROM alpine:3.23
ARG TARGETARCH
RUN apk add --no-cache ca-certificates tzdata
COPY --from=xray /app/bin/ /opt/sharx/bin/
COPY --from=builder /verifier /usr/local/bin/sharx-verifier
ENV SHARX_VERIFIER_XRAY=/opt/sharx/bin/xray-linux-${TARGETARCH}
USER 10001:10001
EXPOSE 9444
ENTRYPOINT ["/usr/local/bin/sharx-verifier"]
