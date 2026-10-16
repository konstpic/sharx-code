"use client";

import { ArrowRight } from "lucide-react";
import { dcLabel, type Transition } from "@/lib/telemtDc";
import { StateIcon, stateBox } from "./StateBadge";
import { stateText } from "./DcDetail";
import type { Td } from "./useTd";

export function EventLog({ events, td }: { events: Transition[]; td: Td }) {
  if (events.length === 0) {
    return <p className="text-xs text-[var(--fg-subtle)]">{td("events.empty", "No state changes since this page was opened.")}</p>;
  }
  return (
    <ul className="max-h-48 space-y-1 overflow-auto pr-1 text-xs">
      {events.map((e, i) => (
        <li key={`${e.key}-${e.at}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <time className="font-mono text-[10px] text-[var(--fg-subtle)]" dateTime={new Date(e.at).toISOString()}>
            {new Date(e.at).toLocaleTimeString()}
          </time>
          <span className="min-w-0 truncate font-medium text-[var(--fg)]">
            {e.dc == null ? td("events.instance", "instance") : dcLabel(e.dc)} · {e.instanceLabel}
            {e.sourceName ? <span className="font-normal text-[var(--fg-subtle)]"> ({e.sourceName})</span> : null}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 rounded border px-1 py-px text-[10px] ${stateBox[e.from]}`}>
              <StateIcon state={e.from} className="h-2.5 w-2.5" />
              {stateText(td, e.from)}
            </span>
            <ArrowRight aria-hidden className="h-3 w-3 text-[var(--fg-subtle)]" />
            <span className={`inline-flex items-center gap-1 rounded border px-1 py-px text-[10px] ${stateBox[e.to]}`}>
              <StateIcon state={e.to} className="h-2.5 w-2.5" />
              {stateText(td, e.to)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
