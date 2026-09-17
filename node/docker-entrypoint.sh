#!/bin/sh
# Named volume at /app/bin hides image files; re-seed each binary from the image
# individually, and ONLY when that specific file is actually missing (first-ever boot)
# or arch-mismatched (e.g. stale xray-linux-amd64 on an arm64 node).
#
# IMPORTANT: never blanket-copy the whole embedded bin dir over an existing /app/bin.
# An admin may have pinned a specific Xray/Telemt version via the panel's "install
# version" action; those binaries must persist across image/container updates and must
# only ever be replaced by an explicit admin action, not by a Docker image update.
set -e

seed_file() {
  # $1 = filename under /opt/sharx-node-embedded/bin and /app/bin
  src="/opt/sharx-node-embedded/bin/$1"
  dst="/app/bin/$1"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    echo "sharx-node: seeding /app/bin/$1 from image (was missing)" >&2
    cp -a "$src" "$dst"
  fi
}

if [ -d /opt/sharx-node-embedded/bin ]; then
  needname=""
  case "$(uname -m)" in
    x86_64)  needname="xray-linux-amd64" ;;
    aarch64) needname="xray-linux-arm64" ;;
    i386|i486|i686) needname="xray-linux-386" ;;
    armv7l)  needname="xray-linux-arm32" ;;
    armv6l)  needname="xray-linux-armv6" ;;
    *)       needname="" ;;
  esac
  if [ -n "$needname" ] && [ ! -f "/opt/sharx-node-embedded/bin/$needname" ]; then
    needname=""
  fi
  if [ -z "$needname" ]; then
    need=$(find /opt/sharx-node-embedded/bin -maxdepth 1 -name 'xray-linux-*' -type f 2>/dev/null | head -1)
    if [ -n "$need" ]; then
      needname=$(basename "$need")
    fi
  fi

  if [ -n "$needname" ] && [ -f "/opt/sharx-node-embedded/bin/$needname" ]; then
    existing=$(find /app/bin -maxdepth 1 -name 'xray-linux-*' -type f 2>/dev/null | head -1)
    exname=""
    if [ -n "$existing" ]; then
      exname=$(basename "$existing")
    fi
    if [ ! -f "/app/bin/$needname" ] || { [ -n "$exname" ] && [ "$exname" != "$needname" ]; }; then
      # Wrong-arch or missing xray binary: only replace the xray binary itself, and
      # remove a stale wrong-arch file so it doesn't linger alongside the correct one.
      # This never touches telemt/awg/amneziawg-go, which are seeded independently below.
      if [ -n "$exname" ] && [ "$exname" != "$needname" ]; then
        echo "sharx-node: removing stale /app/bin/$exname (wrong arch, need $needname)" >&2
        rm -f "/app/bin/$exname"
      fi
      echo "sharx-node: seeding /app/bin/$needname from image (was ${exname:-missing})" >&2
      cp -a "/opt/sharx-node-embedded/bin/$needname" "/app/bin/$needname"
    fi
  fi

  # Each sidecar binary is seeded independently and ONLY when genuinely absent —
  # never overwrite an already-present (possibly admin-pinned) binary here.
  seed_file telemt
  seed_file awg
  seed_file amneziawg-go

  # Static data assets (geo databases, license/readme) are safe to always keep in sync
  # with the image — they are not version-pinned by the admin and updating them can only
  # improve routing/geo accuracy. Only copy files that don't already exist.
  for asset in geoip.dat geoip_IR.dat geoip_RU.dat geosite.dat geosite_IR.dat geosite_RU.dat LICENSE README.md; do
    seed_file "$asset"
  done
fi
. /app/scripts/ensure-dev-net-tun.sh 2>/dev/null || true
exec "$@"
