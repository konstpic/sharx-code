"use client";

import { Bot } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { p } from "@/lib/paths";

type Bundle = Record<string, string>;

const SAMPLE: Record<string, string> = {
  Hostname: "my-server",
  Username: "admin",
  IP: "203.0.113.7",
  Time: "2026-09-24 12:30:00",
  Code: "482915",
  Percent: "92",
  Threshold: "80",
};

/** Fills go-template placeholders ({{ .Name }}) with sample values. */
function fill(text: string): string {
  return text.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_, k: string) => SAMPLE[k] ?? "");
}

const TAG_STYLE: Record<string, string> = {
  b: "font-semibold",
  strong: "font-semibold",
  i: "italic",
  em: "italic",
  u: "underline",
  s: "line-through",
  code: "rounded bg-black/20 px-1 font-mono text-[0.92em]",
};

/** Renders the small HTML subset Telegram supports (b, i, u, s, code) without innerHTML. */
function renderTelegramHtml(html: string): ReactNode[] {
  const out: ReactNode[] = [];
  const stack: { tag: string; children: ReactNode[] }[] = [{ tag: "", children: out }];
  const re = /<(\/?)(b|strong|i|em|u|s|code)>|([^<]+)|(<)/gi;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[2]) {
      const tag = m[2].toLowerCase();
      if (!m[1]) {
        stack.push({ tag, children: [] });
      } else if (stack.length > 1 && top.tag === tag) {
        const done = stack.pop()!;
        stack[stack.length - 1].children.push(
          <span key={key++} className={TAG_STYLE[tag]}>
            {done.children}
          </span>,
        );
      }
    } else {
      top.children.push(<Fragment key={key++}>{m[3] ?? m[4]}</Fragment>);
    }
  }
  while (stack.length > 1) {
    const done = stack.pop()!;
    stack[stack.length - 1].children.push(<Fragment key={key++}>{done.children}</Fragment>);
  }
  return out;
}

function Bubble({ children, time }: { children: ReactNode; time: string }) {
  return (
    <div className="max-w-[22rem] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[13px] leading-snug text-[#e9eef3] shadow-sm">
      <div className="whitespace-pre-wrap break-words">{children}</div>
      <div className="mt-1 text-right text-[10px] text-[#7d91a3]">{time}</div>
    </div>
  );
}

export function TgMessagePreviews({ langCode }: { langCode: string }) {
  const { t } = useTranslation();
  const [bundle, setBundle] = useState<Bundle | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let r = await fetch(p(`locales/${langCode}.json`), { cache: "no-store" });
        if (!r.ok) r = await fetch(p("locales/en.json"), { cache: "no-store" });
        const data = (await r.json()) as Bundle;
        if (!cancelled) setBundle(data);
      } catch {
        if (!cancelled) setBundle({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [langCode]);

  const messages = useMemo(() => {
    if (!bundle) return [];
    const m = (k: string) => fill(bundle[`tgbot.messages.${k}`] ?? "");
    const login = [m("loginSuccess"), m("hostname"), m("username"), m("ip"), m("time")].join("");
    return [
      { id: "login", title: t("pages.settings.tgPreview.login", { defaultValue: "Successful panel login" }), text: login },
      { id: "code", title: t("pages.settings.tgPreview.code", { defaultValue: "Telegram 2FA login code" }), text: m("twoFactorLoginCode") },
      { id: "cpu", title: t("pages.settings.tgPreview.cpu", { defaultValue: "High CPU alert" }), text: m("cpuThreshold") },
      { id: "backup", title: t("pages.settings.tgPreview.backup", { defaultValue: "Scheduled backup" }), text: m("backupTime") },
    ].filter((x) => x.text.trim());
  }, [bundle, t]);

  return (
    <div className="p-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[#0e1621] p-3">
        <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2">
          <span className="grid size-8 place-items-center rounded-full bg-[#2b5278] text-white">
            <Bot size={16} aria-hidden />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-medium text-white">SharX Bot</div>
            <div className="text-[11px] text-[#7d91a3]">bot</div>
          </div>
        </div>
        {!bundle ? (
          <div className="py-6 text-center text-xs text-[#7d91a3]">…</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {messages.map((msg) => (
              <div key={msg.id} className="flex flex-col gap-1.5">
                <div className="text-[11px] uppercase tracking-wide text-[#7d91a3]">{msg.title}</div>
                <Bubble time="12:30">{renderTelegramHtml(msg.text.replace(/\r\n/g, "\n").trim())}</Bubble>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--fg-subtle)]">
        {t("pages.settings.tgPreview.note", {
          defaultValue: "Sample data in the selected bot language. Real messages use your actual hostname, IP and values.",
        })}
      </p>
    </div>
  );
}
