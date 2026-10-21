"use client";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";
import { STYLE_ICONS } from "@/lib/dashboardStyle";
import { Choice, Field, Section, Select, Slider, Toggle } from "./controls";
import { TILE_ICONS } from "./icons";
import type { TabProps } from "./types";

/** Tab "Текст и числа": size / font / weight / alignment of the text, icon, number formatting, change badge. */
export function TextTab({ r, patch, metric, precision, onPrecision }: TabProps & { precision: number; onPrecision: (n: number) => void }) {
  const { t } = useTranslation();
  const text = (key: "unit" | "prefix" | "suffix" | "emptyText", max: number) => (
    <Field label={t(`pages.builder.style.${key}`)}>
      <Input key={r[key]} defaultValue={r[key]} maxLength={max} onBlur={(e) => patch({ [key]: e.target.value })} />
    </Field>
  );
  return (
    <div className="space-y-4">
      <Section title={t("pages.builder.style.sizes")} hint={metric ? t("pages.builder.style.scaleHint") : undefined}>
        {metric ? <Slider label={t("pages.builder.style.valueScale")} value={r.valueScale} min={50} max={300} step={5} def={100} unit=" %" onChange={(valueScale) => patch({ valueScale })} /> : null}
        <Slider label={t("pages.builder.style.labelScale")} value={r.labelScale} min={60} max={200} step={5} def={100} unit=" %" onChange={(labelScale) => patch({ labelScale })} />
        {metric ? (
          <>
            <Select
              label={t("pages.builder.style.valueFont")}
              value={r.valueFont}
              options={[
                { id: "default", label: t("pages.builder.style.fontDefault") },
                { id: "mono", label: t("pages.builder.style.fontMono") },
                { id: "sans", label: t("pages.builder.style.fontSans") },
                { id: "heading", label: t("pages.builder.style.fontHeading") },
              ]}
              onChange={(valueFont) => patch({ valueFont })}
            />
            <Slider label={t("pages.builder.style.valueWeight")} value={r.valueWeight} min={400} max={900} step={100} def={600} onChange={(valueWeight) => patch({ valueWeight })} />
            <Choice
              label={t("pages.builder.style.align")}
              value={r.align}
              options={[
                { id: "default", label: t("pages.builder.style.auto") },
                { id: "left", label: t("pages.builder.style.left") },
                { id: "center", label: t("pages.builder.style.center") },
                { id: "right", label: t("pages.builder.style.right") },
              ]}
              onChange={(align) => patch({ align })}
            />
          </>
        ) : null}
        <Choice
          label={t("pages.builder.style.labelPos")}
          value={r.labelPos}
          options={[
            { id: "top", label: t("pages.builder.style.top") },
            { id: "bottom", label: t("pages.builder.style.bottom") },
            { id: "hidden", label: t("pages.builder.style.hidden") },
          ]}
          onChange={(labelPos) => patch({ labelPos })}
        />
        <Toggle label={t("pages.builder.style.uppercase")} checked={r.uppercaseLabel} onChange={(uppercaseLabel) => patch({ uppercaseLabel })} />
      </Section>
      {metric ? (
        <>
          <Section title={t("pages.builder.style.icon")}>
            <Choice
              label={t("pages.builder.style.showIcon")}
              value={r.showIcon === undefined ? "auto" : r.showIcon ? "yes" : "no"}
              options={[
                { id: "auto", label: t("pages.builder.style.auto") },
                { id: "yes", label: t("pages.builder.style.show") },
                { id: "no", label: t("pages.builder.style.hide") },
              ]}
              onChange={(v) => patch({ showIcon: v === "auto" ? undefined : v === "yes" })}
            />
            <div role="group" aria-label={t("pages.builder.style.icon")} className="grid grid-cols-8 gap-1">
              {STYLE_ICONS.map((name) => {
                const I = TILE_ICONS[name];
                const on = r.icon === name;
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    aria-label={name}
                    aria-pressed={on}
                    onClick={() => patch({ icon: on ? undefined : name, ...(on ? {} : { showIcon: true }) })}
                    className={`grid h-8 place-items-center rounded-lg border transition ${on ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--fg)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
                  >
                    <I size={15} />
                  </button>
                );
              })}
            </div>
            <Choice
              label={t("pages.builder.style.iconPos")}
              value={r.iconPos}
              options={[
                { id: "left", label: t("pages.builder.style.left") },
                { id: "right", label: t("pages.builder.style.right") },
                { id: "top", label: t("pages.builder.style.top") },
              ]}
              onChange={(iconPos) => patch({ iconPos })}
            />
          </Section>
          <Section title={t("pages.builder.style.numbers")} hint={t("pages.builder.style.numbersHint")}>
            <div className="grid grid-cols-2 gap-3">
              {text("unit", 12)}
              {text("prefix", 8)}
              {text("suffix", 12)}
              <Select label={t("pages.builder.precision")} value={precision} options={[0, 1, 2, 3].map((n) => ({ id: n, label: String(n) }))} onChange={onPrecision} />
            </div>
            <Select
              label={t("pages.builder.style.thousands")}
              value={r.thousands}
              options={[
                { id: "default", label: t("pages.builder.style.thousandsDefault") },
                { id: "none", label: t("pages.builder.style.thousandsNone") },
                { id: "space", label: t("pages.builder.style.thousandsSpace") },
                { id: "comma", label: t("pages.builder.style.thousandsComma") },
              ]}
              onChange={(thousands) => patch({ thousands })}
            />
            <Toggle label={t("pages.builder.style.abbreviate")} checked={r.abbreviate} onChange={(abbreviate) => patch({ abbreviate })} hint={t("pages.builder.style.abbreviateHint")} />
            <Toggle label={t("pages.builder.style.showDelta")} checked={r.showDelta} onChange={(showDelta) => patch({ showDelta })} />
            <Toggle label={t("pages.builder.style.hideWhenZero")} checked={r.hideWhenZero} onChange={(hideWhenZero) => patch({ hideWhenZero })} />
            {text("emptyText", 24)}
          </Section>
        </>
      ) : null}
    </div>
  );
}
