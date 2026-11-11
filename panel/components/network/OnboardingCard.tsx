"use client";

import { Globe, HandCoins, LogOut, Megaphone, ShieldAlert, Unplug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  CheckboxField,
  Input,
  Modal,
  Switch,
} from "@/components/ui";
import { shortId } from "./format";
import type { NetworkStatus } from "@/types/network";

type OnboardingCardProps = {
  status: NetworkStatus;
  /** holds network:manage — without it everything here is read-only */
  manage: boolean;
  /** called after a successful enroll/enable/leave so the parent reloads status */
  onChanged: () => Promise<void> | void;
};

/**
 * First-run / disabled view of the section. Participation is strictly
 * opt-in: nothing is sent to the coordinator until the operator enrolls
 * explicitly, having accepted the risk text.
 */
export function OnboardingCard({ status, manage, onChanged }: OnboardingCardProps) {
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) =>
    t(`pages.network.${key}`, { defaultValue: fallback });

  const enrolled = Boolean(status.participantId);

  const [coordinatorUrl, setCoordinatorUrl] = useState(status.coordinatorUrl ?? "");
  const [inviteCode, setInviteCode] = useState("");
  const [name, setName] = useState(status.name ?? "");
  const [riskAck, setRiskAck] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState("");
  const [enabling, setEnabling] = useState(false);

  const enroll = async () => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await postJson<{ ok: boolean }>(
        panel("network/enroll"),
        { coordinatorUrl: coordinatorUrl.trim(), inviteCode: inviteCode.trim(), name: name.trim() },
        true,
      );
      if (!r.success || r.obj?.ok !== true) throw new Error(r.msg || tr("enrollError", "Could not join the network"));
      setInfo(tr("enrollComplete", "Joined the network. No additional approval is required."));
      setInviteCode("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("enrollError", "Could not join the network"));
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setEnabling(true);
    setError("");
    try {
      const r = await postJson(panel("network/enable"), { enabled }, true);
      if (!r.success) throw new Error(r.msg);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("actionError", "Operation failed"));
    } finally {
      setEnabling(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await postJson(panel("network/leave"), { confirm: "LEAVE" }, true);
      if (!r.success) throw new Error(r.msg);
      setLeaveOpen(false);
      setLeaveConfirm("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("actionError", "Operation failed"));
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    {
      icon: Megaphone,
      title: tr("step1Title", "Publish a node"),
      text: tr(
        "step1Text",
        "Offer one of your servers to other participants and set traffic, speed and price limits.",
      ),
    },
    {
      icon: HandCoins,
      title: tr("step2Title", "Earn credits"),
      text: tr(
        "step2Text",
        "Served traffic is credited to your balance by the coordinator after each session.",
      ),
    },
    {
      icon: Globe,
      title: tr("step3Title", "Use nodes of others"),
      text: tr(
        "step3Text",
        "Spend credits on sessions via nodes published by other participants.",
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Surface>
        <h2 className="font-semibold">{tr("howItWorks", "How the exchange works")}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4"
            >
              <div className="flex items-center gap-2 text-[var(--accent)]">
                <s.icon className="size-4" />
                <span className="text-xs font-semibold">{i + 1}</span>
              </div>
              <h3 className="mt-2 font-medium">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--fg-muted)]">{s.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[var(--fg-muted)]">
          {tr(
            "voluntaryNote",
            "Participation is voluntary and off by default. You can pause or leave the network at any time.",
          )}
        </p>
      </Surface>

      {error && <AlertBanner type="error" title={error} />}
      {info && <AlertBanner type="info" title={info} />}

      {!enrolled ? (
        <Surface>
          <h2 className="font-semibold">{tr("joinTitle", "Join SharX Network")}</h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {tr("joinHint", "Enter the coordinator API address and the invite code from the network operator. The public Explorer address is different.")}
          </p>
          <fieldset disabled={!manage} className="m-0 min-w-0 border-0 p-0">
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {tr("coordinatorUrl", "Coordinator URL")}
                </span>
                <Input
                  value={coordinatorUrl}
                  onChange={(e) => setCoordinatorUrl(e.target.value)}
                  placeholder="https://coordinator.sharxconnect.app"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {tr("inviteCode", "Invite code")}
                </span>
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {tr("panelName", "Panel name shown to other participants")}
                </span>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tr("panelNamePlaceholder", "My server")}
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
                <CheckboxField
                  align="start"
                  checked={riskAck}
                  onChange={(e) => setRiskAck(e.target.checked)}
                  label={<span className="text-amber-100">{tr("riskAck", "Risk acknowledgment")}</span>}
                />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-amber-100/90">
                {tr(
                  "riskText",
                  "I understand that traffic from other network participants will pass through my server; complaints and blocks by third parties are possible; I can stop participating at any time, but already established connections will finish within a few minutes.",
                )}
              </p>
            </div>
            <Button
              className="mt-4 min-h-11"
              variant="primary"
              loading={busy}
              disabled={
                !coordinatorUrl.trim() || !inviteCode.trim() || !name.trim() || !riskAck
              }
              onClick={() => void enroll()}
            >
              {tr("join", "Join the network")}
            </Button>
          </fieldset>
        </Surface>
      ) : (
        <Surface>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-semibold">{tr("membership", "Membership")}</h2>
              <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-[var(--fg-muted)]">{tr("name", "Name")}</dt>
                  <dd className="truncate">{status.name || "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-[var(--fg-muted)]">{tr("participantId", "Participant ID")}</dt>
                  <dd className="font-mono text-xs">{shortId(status.participantId)}</dd>
                </div>
                <div className="col-span-full flex gap-2">
                  <dt className="shrink-0 text-[var(--fg-muted)]">{tr("coordinatorUrl", "Coordinator URL")}</dt>
                  <dd className="break-all">{status.coordinatorUrl || "—"}</dd>
                </div>
              </dl>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--fg-muted)]">{tr("enabledSwitch", "Participation enabled")}</span>
              <Switch
                ariaLabel={tr("enabledSwitch", "Participation enabled")}
                checked={status.enabled}
                disabled={!manage || enabling}
                onChange={(v) => void setEnabled(v)}
              />
            </div>
          </div>

          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <h3 className="flex items-center gap-2 font-semibold text-rose-400">
              <Unplug className="size-4" />
              {tr("dangerZone", "Danger zone")}
            </h3>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              {tr(
                "leaveHint",
                "Leaving removes your publications and sessions. Remaining earned credits are kept by the network rules.",
              )}
            </p>
            <Button
              className="mt-3"
              variant="secondary"
              disabled={!manage}
              onClick={() => {
                setLeaveConfirm("");
                setLeaveOpen(true);
              }}
            >
              <LogOut className="size-4" />
              {tr("leave", "Leave the network")}
            </Button>
          </div>
        </Surface>
      )}

      <Modal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title={tr("leaveTitle", "Leave SharX Network?")}
        width={480}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLeaveOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              className="!bg-red-600 hover:!bg-red-500"
              loading={busy}
              disabled={leaveConfirm !== "LEAVE"}
              onClick={() => void leave()}
            >
              {tr("leaveConfirm", "Leave")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--fg-muted)]">
          {tr(
            "leaveText",
            "This stops your participation: publications are withdrawn and sessions end. Type LEAVE to confirm.",
          )}
        </p>
        <Input
          className="mt-4 font-mono"
          value={leaveConfirm}
          onChange={(e) => setLeaveConfirm(e.target.value)}
          placeholder="LEAVE"
          autoComplete="off"
        />
      </Modal>
    </div>
  );
}
