#!/usr/bin/env python3
"""Regenerates the API_DATA array embedded in index.html (the "API Explorer" panel on the
GitHub Pages landing page) from web/docs/API.md, the source of truth.

index.html is a static page with no build step of its own (deployed as-is by GitHub Pages), so
this script is the only thing keeping its API Explorer in sync with API.md — run it after any
API.md change that adds/removes/renames an endpoint, then commit the resulting index.html.

Parsing rules (reverse-engineered from the existing embedded data, kept intentionally simple so
API.md stays the single source of truth and doesn't need explorer-specific markup):
  - Top-level sections are `## N. Title` headings (only numbered ones; `## Notes` etc. are
    front matter and are skipped).
  - Within a section, `### [Worker: ]METHOD `/path`` headings are endpoints (METHOD one of GET,
    POST, PUT, DELETE, WS). Any other `###` heading (e.g. a "Mass Assignment to Group" prose
    subsection) is not an endpoint and is skipped, exactly like the previous data does.
  - desc: the endpoint's lead paragraph(s) — text up to the first table, the first bolded
    "**Label:**" marker (Path/Query/Request Body Parameters, Response, Example Request, ...),
    or the first code fence, whichever comes first. Markdown emphasis/code/links are stripped to
    plain text since the page renders desc as textContent (no markdown rendering).
  - request: the first ```bash fenced block in the endpoint's body (usually the curl example).
  - response: the first ```json fenced block that appears after the request block (usually the
    example response; some endpoints show more than one request/response pair — matching the
    existing data, only the first of each is used).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_MD = ROOT / "web" / "docs" / "API.md"
INDEX_HTML = ROOT / "index.html"

SECTION_RE = re.compile(r"^## (\d+)\. (.+)$", re.MULTILINE)
SUBSECTION_RE = re.compile(r"^### (.+)$", re.MULTILINE)
ENDPOINT_RE = re.compile(r"^(?:(\w+): )?(GET|POST|PUT|DELETE|WS)\s+`([^`]+)`")
FENCE_RE = re.compile(r"```(\w+)\n(.*?)\n```", re.DOTALL)


def strip_markdown(text: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # [text](url) -> text
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)  # **bold** -> bold
    text = re.sub(r"`([^`]+)`", r"\1", text)  # `code` -> code
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def extract_desc(body: str) -> str:
    stop_at = len(body)
    # A line that is itself a short structural label ("**Path Parameters:**", "**Request Body**
    # (JSON):", "**Response (pairing):**", ...) ends in ":" right at end-of-line, optionally
    # followed by the closing "**" — unlike prose that happens to start with a bolded word
    # ("**Forcibly tear down** established connections...") but continues as a real sentence.
    # A table row, a code fence, or a "---" separator before the next heading also end the lead.
    for pat in (r"^\|.*\|\s*$", r"^\*\*[^\n]*:\*{0,2}\s*$", r"^```", r"^---\s*$"):
        m = re.search(pat, body, re.MULTILINE)
        if m and m.start() < stop_at:
            stop_at = m.start()
    lead = body[:stop_at].strip()
    return strip_markdown(lead)


def extract_request_response(body: str):
    fences = list(FENCE_RE.finditer(body))
    request = ""
    response = ""
    req_end = -1
    for m in fences:
        if m.group(1) == "bash" and not request:
            request = m.group(2)
            req_end = m.end()
            break
    for m in fences:
        if m.group(1) == "json" and m.start() > req_end and not response:
            response = m.group(2)
            break
    return request, response


def parse_api_md(text: str):
    sections = list(SECTION_RE.finditer(text))
    data = []
    for i, sec_m in enumerate(sections):
        num = int(sec_m.group(1))
        title = sec_m.group(2).strip()
        body_start = sec_m.end()
        body_end = sections[i + 1].start() if i + 1 < len(sections) else len(text)
        section_body = text[body_start:body_end]

        subs = list(SUBSECTION_RE.finditer(section_body))
        endpoints = []
        for j, sub_m in enumerate(subs):
            heading = sub_m.group(1).strip()
            ep_m = ENDPOINT_RE.match(heading)
            if not ep_m:
                continue
            worker_prefix, method, path = ep_m.groups()
            ep_body_start = sub_m.end()
            ep_body_end = subs[j + 1].start() if j + 1 < len(subs) else len(section_body)
            ep_body = section_body[ep_body_start:ep_body_end]
            desc = extract_desc(ep_body)
            if worker_prefix:
                # Called by the worker node itself, not by an admin/API-token client — flag it
                # so it doesn't look like just another panel endpoint in the explorer.
                desc = "(Called by the worker node, not the panel API) " + desc
            request, response = extract_request_response(ep_body)
            endpoints.append([method, path, desc, request, response])
        data.append([num, title, endpoints])
    return data


def main():
    api_md_text = API_MD.read_text(encoding="utf-8")
    data = parse_api_md(api_md_text)
    total_eps = sum(len(sec[2]) for sec in data)
    if not data or total_eps == 0:
        print("error: parsed 0 sections/endpoints — refusing to overwrite index.html", file=sys.stderr)
        sys.exit(1)

    array_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    html = INDEX_HTML.read_text(encoding="utf-8")
    marker = "var API_DATA = "
    start = html.index(marker)
    end = html.index("\n", start)
    old_line = html[start:end]
    if not old_line.rstrip().endswith(";"):
        print("error: could not find the API_DATA statement's terminating ';'", file=sys.stderr)
        sys.exit(1)
    new_html = html[:start] + marker + array_json + ";" + html[end:]
    INDEX_HTML.write_text(new_html, encoding="utf-8")
    print(f"wrote {len(data)} sections, {total_eps} endpoints into {INDEX_HTML.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
