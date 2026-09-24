"use client";

import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MENU_STYLE_IDS, useMenuStyle, type MenuStyleId } from "@/lib/menuStyle";

/** A tiny panel drawn with the current theme colors, showing where the menu lives in each style. */
function MenuPreview({ id }: { id: MenuStyleId }) {
  const soft = "color-mix(in oklab, var(--fg) 14%, transparent)";
  const strong = "color-mix(in oklab, var(--fg) 26%, transparent)";
  const content = (
    <div className="flex flex-1 flex-col gap-1.5 p-2">
      <span className="h-2 w-1/3 rounded-full" style={{ background: strong }} />
      <div className="grid flex-1 grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="rounded-md" style={{ background: soft }} />
        ))}
      </div>
    </div>
  );
  return (
    <div
      aria-hidden
      className="relative flex h-[104px] w-full overflow-hidden rounded-lg border border-[var(--border-strong)]"
      style={{ background: "color-mix(in oklab, var(--fg) 4%, transparent)" }}
    >
      {id === "sidebar" ? (
        <>
          <div className="flex w-[30%] flex-col gap-1 border-r border-[var(--border)] p-1.5">
            <span className="h-3.5 rounded-lg" style={{ background: soft }} />
            <span
              className="h-3.5 rounded-lg"
              style={{ background: "color-mix(in oklab, var(--accent) 22%, transparent)", border: "1px solid var(--accent)", boxShadow: "0 0 8px -2px var(--accent)" }}
            />
            <div className="ml-2 flex flex-col gap-0.5 border-l border-[var(--border)] pl-1.5">
              {[70, 55, 62].map((w, i) => (
                <span key={i} className="h-1 rounded-full" style={{ background: i === 0 ? "var(--accent)" : soft, width: `${w}%` }} />
              ))}
            </div>
            <span className="h-3.5 rounded-lg" style={{ background: soft }} />
            <span className="h-3.5 rounded-lg" style={{ background: soft }} />
          </div>
          {content}
        </>
      ) : null}
      {id === "carousel" ? (
        <div className="flex w-full flex-col">
          <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-2 py-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className="grid h-6 w-7 shrink-0 place-items-center rounded-md"
                style={
                  i === 1
                    ? { background: "color-mix(in oklab, var(--accent) 22%, transparent)", boxShadow: "0 0 10px -2px var(--accent)", border: "1px solid var(--accent)" }
                    : { background: soft }
                }
              >
                <span className="h-1.5 w-3 rounded-full" style={{ background: i === 1 ? "var(--accent)" : strong }} />
              </span>
            ))}
          </div>
          {content}
        </div>
      ) : null}
      {id === "dock" ? (
        <div className="relative flex w-full flex-col">
          {content}
          <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center">
            <div
              className="flex items-end gap-1 rounded-2xl border border-[var(--border-strong)] px-1.5 py-1"
              style={{ background: "color-mix(in oklab, var(--bg-elevated) 80%, transparent)" }}
            >
              {[12, 15, 21, 15, 12, 10].map((h, i) => (
                <span
                  key={i}
                  className="rounded-lg"
                  style={{
                    width: h,
                    height: h,
                    background: i === 2 ? "var(--accent)" : soft,
                    boxShadow: i === 2 ? "0 0 10px -2px var(--accent)" : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MenuStyleGallery() {
  const { t } = useTranslation();
  const [style, setStyle] = useMenuStyle();
  const label = (id: MenuStyleId) =>
    ({
      sidebar: t("pages.settings.menuStyle.sidebar", { defaultValue: "Sidebar" }),
      carousel: t("pages.settings.menuStyle.carousel", { defaultValue: "Top carousel" }),
      dock: t("pages.settings.menuStyle.dock", { defaultValue: "Dock" }),
    })[id];
  const desc = (id: MenuStyleId) =>
    ({
      sidebar: t("pages.settings.menuStyle.sidebarDesc", { defaultValue: "Cards on the left; click a section and its pages slide out underneath." }),
      carousel: t("pages.settings.menuStyle.carouselDesc", { defaultValue: "Glowing cards on top with a gliding highlight; sections appear in a row below." }),
      dock: t("pages.settings.menuStyle.dockDesc", { defaultValue: "Floating dock at the bottom: icons grow under the cursor, sections open as a pop-over." }),
    })[id];
  return (
    <div className="p-4">
      <div role="radiogroup" aria-label={t("pages.settings.menuStyle.title", { defaultValue: "Menu style" })} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MENU_STYLE_IDS.map((id) => {
          const selected = id === style;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setStyle(id)}
              className={`flex flex-col gap-2 rounded-xl border p-2 text-left transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                selected
                  ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] shadow-[0_0_0_1px_var(--accent)]"
                  : "border-[var(--border)] panel-inset hover:border-[var(--border-strong)]"
              }`}
            >
              <MenuPreview id={id} />
              <div className="px-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--fg)]">{label(id)}</span>
                  {selected ? <Check size={14} className="text-[var(--accent)]" aria-hidden /> : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--fg-muted)]">{desc(id)}</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-[var(--fg-subtle)]">
        {t("pages.settings.menuStyle.mobileNote", { defaultValue: "On phones the classic slide-out menu is always used." })}
      </p>
    </div>
  );
}
