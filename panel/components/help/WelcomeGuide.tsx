"use client";

import { ChevronDown, ChevronUp, Compass } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpScene } from "@/components/help/HelpScene";
import { linkP } from "@/lib/paths";
import { Surface } from "@/components/panel";

const STORAGE_KEY = "sharx.welcomeGuide.collapsed";

const STEPS: { key: string; def: string; href: string }[] = [
  { key: "welcomeStep1", def: "Add nodes", href: "panel/nodes" },
  { key: "welcomeStep2", def: "Create inbounds", href: "panel/inbounds" },
  { key: "welcomeStep3", def: "Check hosts", href: "panel/hosts" },
  { key: "welcomeStep4", def: "Make bundles", href: "panel/bundles" },
  { key: "welcomeStep5", def: "Add clients", href: "panel/clients" },
];

/** The dashboard's welcome card: an animated tour of how the pieces fit, with the setup order as links. */
export function WelcomeGuide() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* private mode: show the guide */
    }
    setReady(true);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  if (!ready) return null;
  return (
    <Surface className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)]">
            <Compass size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--fg)]">{t("pages.index.welcomeTitle", { defaultValue: "Welcome to SharX" })}</h2>
            <p className="text-xs text-[var(--fg-muted)]">
              {t("pages.index.welcomeText", { defaultValue: "A short tour of how servers, hosts, bundles and clients fit together." })}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          {collapsed ? t("pages.index.welcomeShow", { defaultValue: "Show the guide" }) : t("pages.index.welcomeHide", { defaultValue: "Hide" })}
        </button>
      </div>
      {!collapsed ? (
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <HelpScene sceneId="welcome" />
          <ol className="flex flex-col gap-2 self-center">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <Link
                  href={linkP(s.href)}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--fg)] transition-colors hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-xs font-semibold text-[var(--accent)]">
                    {i + 1}
                  </span>
                  {t(`pages.index.${s.key}`, { defaultValue: s.def })}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Surface>
  );
}
