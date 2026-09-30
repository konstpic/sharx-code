#!/usr/bin/env python3
"""Generate web/service/telemt_params_catalog.json from Telemt's CONFIG_PARAMS.ru.md.

Usage: scripts/gen_telemt_catalog.py CONFIG_PARAMS.ru.md > web/service/telemt_params_catalog.json
Source: https://github.com/telemt/telemt/blob/main/docs/Config_params/CONFIG_PARAMS.ru.md
"""
import json
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read().split("\n")

# Section -> path in the TOML tree ("" = root). "[[x]]" means array of tables.
def sec_path(h):
    m = re.match(r"^# (\[+)([^\]]+)\]+", h)
    if not m:
        return None
    return m.group(2), len(m.group(1)) == 2

rows = {}      # section -> [(key, typ, default, hot)]
blocks = {}    # section -> [(heading, text)]
arrays = set()
sec = ""
in_top = False
cur = None
hdr = None
for line in text:
    if line.startswith("# Ключи верхнего уровня"):
        sec, in_top, cur = "", True, None
        continue
    sp = sec_path(line)
    if sp:
        sec, arr = sp
        if arr:
            arrays.add(sec)
        in_top, cur = True, None
        continue
    if line.startswith("# ") and not sp:
        in_top, cur = False, None
        if line.startswith("# Содержание"):
            in_top = False
        continue
    if line.startswith("|"):
        cells = [c.strip() for c in line.strip().strip("|").split(" | ")]
        if cells and cells[0] in ("Ключ", "Mode"):
            hdr = cells
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        m = re.match(r"^\[?`([^`]+)`\]?(\([^)]*\))?$", cells[0])
        if m and hdr and hdr[0] == "Ключ":
            col = dict(zip(hdr, cells))
            hot = col.get("Hot-Reload", "").strip("` ")
            rows.setdefault(sec, []).append((m.group(1), col.get("Тип", ""), col.get("По умолчанию", ""), hot, col.get("Описание", "")))
        continue
    if line.startswith("## "):
        cur = [line[3:].strip(), []]
        blocks.setdefault(sec, []).append(cur)
        continue
    if cur is not None:
        cur[1].append(line)

def clean(s):
    return re.sub(r"\s+", " ", s.replace("`", "").strip())

def strip_md(s):
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    return clean(s)

# Keys SharX generates itself and never lets the operator override (ports, listeners, the control
# API used by the panel, users, WEB vhosts/profiles/decoy).
MANAGED = {
    "include", "show_link", "server.admin_api",
    "server.port", "server.listeners", "server.api.enabled", "server.api.listen", "server.api.whitelist",
    "server.api.auth_header", "server.api.minimal_runtime_enabled", "server.api.read_only",
    "access.users", "access.user_source_deny", "access.user_ad_tags", "access.user_rate_limits",
    "web.enabled", "web.vhosts.host", "web.vhosts.public_addr", "web.vhosts.decoy", "web.vhosts.profiles",
    "web.vhosts.profiles.user", "web.vhosts.profiles.secret_mode",
    "general.modes.classic", "general.modes.secure", "general.modes.tls", "general.links.show",
    "general.links.public_host", "general.links.public_port", "general.log_level",
    "general.use_middle_proxy", "general.ad_tag", "general.fast_mode", "general.me2dc_fallback",
    "general.me2dc_fast", "general.middle_proxy_nat_ip", "general.tg_connect",
    "network.ipv4", "network.ipv6", "network.prefer",
    "server.metrics_port", "server.metrics_listen", "server.metrics_whitelist", "server.proxy_protocol",
    "server.max_connections",
    "censorship.tls_domain", "censorship.mask", "censorship.tls_emulation", "censorship.tls_front_dir",
    "censorship.unknown_sni_action", "censorship.mask_host", "censorship.mask_port",
    "censorship.mask_proxy_protocol", "censorship.server_hello_delay_min_ms", "censorship.server_hello_delay_max_ms",
    "timeouts.client_handshake", "timeouts.client_keepalive", "timeouts.client_ack",
    "timeouts.client_first_byte_idle_secs", "timeouts.relay_idle_policy_v2_enabled",
    "timeouts.relay_client_idle_soft_secs", "timeouts.relay_client_idle_hard_secs",
    "timeouts.relay_idle_grace_after_downstream_activity_secs", "timeouts.me_one_retry", "timeouts.me_one_timeout_ms",
    "access.ignore_time_skew", "access.user_max_unique_ips_global_each", "access.user_max_tcp_conns_global_each",
    "access.user_max_unique_ips_mode", "access.user_max_unique_ips_window_secs",
}
# Keys the docs list but that older Telemt builds reject. Verified empirically: every catalog key
# was run through `telemt run` with general.config_strict=true on Telemt 3.5.7; only these two were
# reported as unknown (both first shipped in 3.5.9).
SINCE = {"web.vhosts.base_path": "3.5.9", "web.debug.sideband": "3.5.9"}
CONTAINER_TYPES = {"Table", "Table[]", "Таблица", "таблица", "массив таблиц"}

out = []
for s, rs in rows.items():
    bl = blocks.get(s, [])
    for i, (key, typ, dflt, hot, inline) in enumerate(rs):
        # find the matching detail block
        blk = None
        for h, b in bl:
            hh = h.split(".")[-1]
            if hh == key or h == key or h.startswith(key + "-") or h == (s + "." + key):
                blk = (h, b)
                break
        if blk is None and i < len(bl):
            blk = bl[i]
        desc = strip_md(inline) if inline else ""
        valid = example = ""
        if blk:
            body = "\n".join(blk[1])
            mv = re.search(r"\*\*Ограничения / валидация\*\*:\s*(.*?)(?=\n  - \*\*|\Z)", body, re.S)
            md = re.search(r"\*\*Описание\*\*:\s*(.*?)(?=\n  - \*\*|\Z)", body, re.S)
            me = re.search(r"```toml\n(.*?)```", body, re.S)
            valid = strip_md(mv.group(1)) if mv else ""
            desc = (strip_md(md.group(1)) if md else "") or desc
            example = me.group(1).strip() if me else ""
        out.append({
            "section": s,
            "key": key,
            "array": s in arrays,
            "type": clean(typ),
            "default": clean(dflt),
            "hot": hot == "✔",
            "desc": desc,
            "valid": valid,
            "container": clean(typ) in CONTAINER_TYPES,
            "managed": (s + "." + key if s else key) in MANAGED,
            "since": SINCE.get(s + "." + key if s else key, ""),
        })
json.dump(out, sys.stdout, ensure_ascii=False, separators=(",", ":"))
