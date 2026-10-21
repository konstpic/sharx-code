"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Paintbrush, X } from "lucide-react";
import { Button, SelectNative } from "@/components/ui";
import { FRAME_PRESETS, type MyStyle, type TileStyle } from "@/lib/dashboardStyle";
import { clearTileSelection, useStyleClip, useTileSelection } from "./styleStore";

/**
 * Multi-select toolbar (edit mode): tiles are selected with Shift/Ctrl+click on their title bar or Space on a focused tile.
 * "Apply style to selected" copies frame + colour + typography of the chosen source onto them (data options stay).
 */
export function SelectionBar({ myStyles, onApplyStyle }: { myStyles: MyStyle[]; onApplyStyle: (ids: string[], style: TileStyle | undefined) => void }) {
  const { t } = useTranslation();
  const selection = useTileSelection();
  const clip = useStyleClip();
  const [source, setSource] = useState("clip");
  const sources: { id: string; label: string; style: TileStyle | undefined; disabled?: boolean }[] = [
    { id: "clip", label: t("pages.builder.style.fromClipboard"), style: clip, disabled: !clip },
    ...FRAME_PRESETS.filter((p) => p !== "default").map((p) => ({ id: "p:" + p, label: t(`pages.builder.style.preset_${p}`), style: { preset: p } as TileStyle })),
    ...myStyles.map((m) => ({ id: "m:" + m.id, label: m.name, style: m.style })),
  ];
  const chosen = sources.find((s) => s.id === source && !s.disabled) ?? sources.find((s) => !s.disabled);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--fg-muted)]" role="group" aria-label={t("pages.builder.style.selection")}>
      <Paintbrush size={14} className="text-[var(--accent)]" aria-hidden />
      {selection.size === 0 ? (
        <span>{t("pages.builder.style.selectHint")}</span>
      ) : (
        <>
          <span className="font-medium text-[var(--fg)]" role="status">
            {`${t("pages.builder.style.selectedCount")}: ${selection.size}`}
          </span>
          <SelectNative aria-label={t("pages.builder.style.source")} value={chosen?.id ?? ""} onChange={(e) => setSource(e.target.value)} className="!h-8 !w-auto !rounded-lg !text-xs">
            {sources.map((s) => (
              <option key={s.id} value={s.id} disabled={s.disabled}>
                {s.label}
              </option>
            ))}
          </SelectNative>
          <Button className="!h-8 !rounded-lg !text-xs" disabled={!chosen} onClick={() => chosen && onApplyStyle([...selection], chosen.style)}>
            {t("pages.builder.style.applySelected")}
          </Button>
          <Button variant="ghost" className="!h-8 !rounded-lg !px-2 !text-xs" onClick={clearTileSelection} aria-label={t("pages.builder.style.clearSelection")} title={t("pages.builder.style.clearSelection")}>
            <X size={14} />
          </Button>
        </>
      )}
    </div>
  );
}
