"use client";

import { useTranslation } from "react-i18next";
import { Switch, Textarea } from "@/components/ui";
import {
  defaultCustomRemarks,
  type CustomRemarks,
  type SharxSubpageConfigV2,
} from "@/lib/sharxSubpageConfig";

type Props = {
  config: SharxSubpageConfigV2;
  onChange: (next: SharxSubpageConfigV2) => void;
};

function arrToText(a: string[] | undefined): string {
  return (a ?? []).join("\n");
}

function textToArr(s: string): string[] {
  return s.split("\n").filter((line) => line.length > 0);
}

const KEYS = [
  "expiredUsers",
  "limitedUsers",
  "disabledUsers",
  "emptyHosts",
  "HWIDMaxDevicesExceeded",
  "HWIDNotSupported",
  "blockedApp",
  "unknownApp",
] as const;

type RemarkKey = (typeof KEYS)[number];

export function CustomRemarksEditor({ config, onChange }: Props) {
  const { t } = useTranslation();
  const remarks: CustomRemarks = config.customRemarks ?? defaultCustomRemarks();

  const setRemark = (key: RemarkKey, value: string) =>
    onChange({
      ...config,
      customRemarks: { ...remarks, [key]: textToArr(value) },
    });

  const setShow = (on: boolean) => onChange({ ...config, showCustomRemarks: on });

  const label = (key: RemarkKey) =>
    ({
      expiredUsers: t("subBuilder.customRemarks.expiredUsers", {
        defaultValue: "Expired (time)",
      }),
      limitedUsers: t("subBuilder.customRemarks.limitedUsers", {
        defaultValue: "Limited (traffic)",
      }),
      disabledUsers: t("subBuilder.customRemarks.disabledUsers", {
        defaultValue: "Account disabled",
      }),
      emptyHosts: t("subBuilder.customRemarks.emptyHosts", {
        defaultValue: "No inbounds / hosts",
      }),
      HWIDMaxDevicesExceeded: t("subBuilder.customRemarks.hwidMax", {
        defaultValue: "HWID: max devices",
      }),
      HWIDNotSupported: t("subBuilder.customRemarks.hwidUnsupported", {
        defaultValue: "HWID: device id missing",
      }),
      blockedApp: t("subBuilder.customRemarks.blockedApp", {
        defaultValue: "Blocked app",
      }),
      unknownApp: t("subBuilder.customRemarks.unknownApp", {
        defaultValue: "Unrecognized app",
      }),
    })[key];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--fg)]">
              {t("subBuilder.customRemarks.title", {
                defaultValue: "Custom subscription remarks",
              })}
            </h3>
            <p className="mt-1 text-xs text-[var(--fg-subtle)]">
              {t("subBuilder.customRemarks.intro", {
                defaultValue:
                  "When a client cannot receive real nodes (expired, limited, disabled, HWID limit or missing HWID, blocked or unrecognized app, or no inbounds), the server can return dummy subscription lines whose titles are these texts. One line per remark; empty hosts messages are always used when there are no inbounds.",
              })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-medium text-[var(--fg-muted)]">
              {t("subBuilder.customRemarks.showToggle", {
                defaultValue: "Replace subscription with remarks",
              })}
            </span>
            <Switch checked={config.showCustomRemarks ?? true} onChange={setShow} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {KEYS.map((key) => (
          <Field key={key} label={label(key)}>
            <Textarea
              value={arrToText(remarks[key])}
              onChange={(e) => setRemark(key, e.target.value)}
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
              {t("subBuilder.customRemarks.lineHint", {
                defaultValue: "One line per item shown in the client as a node title.",
              })}
            </p>
          </Field>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </div>
      {children}
    </label>
  );
}
