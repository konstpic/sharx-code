#!/bin/sh
# $1: Docker BuildKit TARGETARCH (amd64, arm64, arm, 386, ...). If empty, match host/emu arch so
# the downloaded binary name matches runtime.GOOS/GOARCH (e.g. xray-linux-arm64 on linux/arm64).
set -e

download_with_retry() {
    url="$1"
    out="$2"
    attempt=1
    while [ "$attempt" -le 3 ]; do
        echo "DockerInit: download attempt ${attempt}/3 — ${out}"
        if curl -fSL --connect-timeout 15 --max-time 600 -o "${out}" "${url}"; then
            return 0
        fi
        echo "DockerInit: download failed (${out}); retrying..." >&2
        attempt=$((attempt + 1))
        sleep 2
    done
    echo "DockerInit: download failed after 3 attempts: ${out} (${url})" >&2
    return 1
}

RESOLVED="${1:-}"
if [ -z "$RESOLVED" ]; then
    case "$(uname -m)" in
        x86_64)  RESOLVED=amd64 ;;
        i386|i486|i686) RESOLVED=386 ;;
        aarch64) RESOLVED=arm64 ;;
        armv7l)  RESOLVED=arm ;;
        armv6l)  RESOLVED=armv6 ;;
        *)       RESOLVED=amd64 ;;
    esac
    echo "DockerInit: TARGETARCH empty, using uname -> ${RESOLVED}"
fi

case $RESOLVED in
    amd64)
        ARCH="64"
        FNAME="amd64"
        ;;
    386|i386)
        ARCH="32"
        FNAME="i386"
        ;;
    armv8|arm64|aarch64)
        ARCH="arm64-v8a"
        FNAME="arm64"
        ;;
    armv7|arm|arm32)
        ARCH="arm32-v7a"
        FNAME="arm32"
        ;;
    armv6)
        ARCH="arm32-v6"
        FNAME="armv6"
        ;;
    *)
        echo "DockerInit: unknown arch '$RESOLVED', defaulting to amd64"
        ARCH="64"
        FNAME="amd64"
        ;;
esac
echo "DockerInit: downloading Xray for ${RESOLVED} (zip ARCH=${ARCH}, output xray-linux-${FNAME})"
mkdir -p build/bin
cd build/bin
curl -sfLRO "https://github.com/XTLS/Xray-core/releases/download/v26.9.9/Xray-linux-${ARCH}.zip"
unzip "Xray-linux-${ARCH}.zip"
rm -f "Xray-linux-${ARCH}.zip" geoip.dat geosite.dat
mv xray "xray-linux-${FNAME}"
chmod +x "xray-linux-${FNAME}"
echo "DockerInit: rules 1/6 — Loyalsoldier geoip.dat (large, may take minutes)..."
download_with_retry "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat" "geoip.dat"
echo "DockerInit: rules 2/6 — Loyalsoldier geosite.dat..."
download_with_retry "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat" "geosite.dat"
echo "DockerInit: rules 3/6 — IR geoip..."
download_with_retry "https://github.com/chocolate4u/Iran-v2ray-rules/releases/latest/download/geoip.dat" "geoip_IR.dat"
echo "DockerInit: rules 4/6 — IR geosite..."
download_with_retry "https://github.com/chocolate4u/Iran-v2ray-rules/releases/latest/download/geosite.dat" "geosite_IR.dat"
echo "DockerInit: rules 5/6 — RU geoip..."
download_with_retry "https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geoip.dat" "geoip_RU.dat"
echo "DockerInit: rules 6/6 — RU geosite..."
download_with_retry "https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geosite.dat" "geosite_RU.dat"
echo "DockerInit: done."
cd ../../

# Telemt (MTProto) binary for panel standalone and shared layout with node builds.
TELEMT_VERSION="${TELEMT_VERSION:-3.5.7}"
case "$FNAME" in
    amd64) TELEMT_ARCH_DL="x86_64-linux-musl" ;;
    arm64) TELEMT_ARCH_DL="aarch64-linux-musl" ;;
    *)
        echo "DockerInit: skipping Telemt download (no musl build for arch $FNAME)"
        TELEMT_ARCH_DL=""
        ;;
esac
if [ -n "$TELEMT_ARCH_DL" ]; then
    echo "DockerInit: downloading Telemt ${TELEMT_VERSION} (${TELEMT_ARCH_DL})..."
    download_with_retry "https://github.com/telemt/telemt/releases/download/${TELEMT_VERSION}/telemt-${TELEMT_ARCH_DL}.tar.gz" "/tmp/telemt.tgz"
    tar -xzf /tmp/telemt.tgz -C build/bin
    chmod +x build/bin/telemt
    rm -f /tmp/telemt.tgz
    echo "DockerInit: telemt -> build/bin/telemt"
fi

# AmneziaWG-go + awg (userspace sidecar; build from source — no release tarball).
AMNEZIAWG_GO_REF="${AMNEZIAWG_GO_REF:-master}"
AMNEZIAWG_TOOLS_REF="${AMNEZIAWG_TOOLS_REF:-master}"
if command -v git >/dev/null 2>&1 && command -v make >/dev/null 2>&1; then
    echo "DockerInit: building amneziawg-go (${AMNEZIAWG_GO_REF})..."
    AWG_GO_TMP="$(mktemp -d)"
    if git clone --depth 1 --branch "${AMNEZIAWG_GO_REF}" https://github.com/amnezia-vpn/amneziawg-go.git "${AWG_GO_TMP}" \
        && make -C "${AWG_GO_TMP}" \
        && cp "${AWG_GO_TMP}/amneziawg-go" build/bin/amneziawg-go \
        && chmod +x build/bin/amneziawg-go; then
        echo "DockerInit: amneziawg-go -> build/bin/amneziawg-go"
    else
        echo "DockerInit: WARNING — amneziawg-go build failed (AmneziaWG sidecar unavailable)"
    fi
    rm -rf "${AWG_GO_TMP}"

    echo "DockerInit: building awg from amneziawg-tools (${AMNEZIAWG_TOOLS_REF})..."
    if command -v apk >/dev/null 2>&1; then
        apk add --no-cache linux-headers libmnl-dev >/dev/null 2>&1 || true
    fi
    AWG_TOOLS_TMP="$(mktemp -d)"
    if git clone --depth 1 --branch "${AMNEZIAWG_TOOLS_REF}" https://github.com/amnezia-vpn/amneziawg-tools.git "${AWG_TOOLS_TMP}" \
        && make -C "${AWG_TOOLS_TMP}/src" wg \
        && cp "${AWG_TOOLS_TMP}/src/wg" build/bin/awg \
        && chmod +x build/bin/awg; then
        echo "DockerInit: awg -> build/bin/awg"
    else
        echo "DockerInit: ERROR — awg build failed (AmneziaWG setconf unavailable)" >&2
        exit 1
    fi
    rm -rf "${AWG_TOOLS_TMP}"
    if [ ! -f build/bin/amneziawg-go ]; then
        echo "DockerInit: ERROR — amneziawg-go missing after build" >&2
        exit 1
    fi
else
    echo "DockerInit: skipping AmneziaWG build (git/make not available)"
fi
