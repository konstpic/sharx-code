"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { NodeSSHProvisionSteps, type SSHProvisionStep } from "@/components/NodeSSHProvisionSteps";
import { AlertBanner, Button, Input, RadioOptionCard, Spinner } from "@/components/ui";

type Phase = "form" | "probing" | "confirm" | "running" | "done" | "error";

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Installs the balancer agent over SSH: confirm the host key, run the install, then push the configuration. */
export function BalancerSSHInstall({
  balancerId,
  defaultHost,
  onInstalled,
}: {
  balancerId: number;
  defaultHost: string;
  onInstalled: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [host, setHost] = useState(defaultHost);
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [authMethod, setAuthMethod] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [fingerprint, setFingerprint] = useState<{ fingerprint: string; keyType: string } | null>(null);
  const [steps, setSteps] = useState<SSHProvisionStep[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const canSubmit = host.trim() !== "" && (authMethod === "password" ? password !== "" : privateKey.trim() !== "");

  const probe = async () => {
    setError("");
    setPhase("probing");
    const r = await postJson<{ fingerprint: string; keyType: string }>(
      panel("node/ssh-hostkey"),
      { host: host.trim(), port: parseInt(port, 10) || 22 },
      true,
    );
    if (!alive.current) return;
    if (!r.success || !r.obj?.fingerprint) {
      setError(r.msg || t("pages.balancers.sshProbeFailed", { defaultValue: "Could not read the SSH host key" }));
      setPhase("form");
      return;
    }
    setFingerprint(r.obj);
    setPhase("confirm");
  };

  const install = async () => {
    if (!fingerprint) return;
    setPhase("running");
    setSteps([]);
    const start = await postJson<{ taskId: string }>(
      panel(`balancer/ssh-install/${balancerId}`),
      {
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim() || "root",
        authMethod,
        password: authMethod === "password" ? password : undefined,
        privateKey: authMethod === "key" ? privateKey : undefined,
        privateKeyPassphrase: authMethod === "key" ? passphrase : undefined,
        hostKeyFingerprint: fingerprint.fingerprint,
      },
      true,
    );
    if (!alive.current) return;
    if (!start.success || !start.obj?.taskId) {
      setError(start.msg || t("pages.balancers.sshFailed", { defaultValue: "Installation failed" }));
      setPhase("error");
      return;
    }
    for (;;) {
      const r = await getJson<{ status: "running" | "success" | "error"; steps: SSHProvisionStep[]; error?: string }>(
        panel(`node/ssh-provision-status/${start.obj.taskId}`),
      );
      if (!alive.current) return;
      if (!r.success || !r.obj) {
        setError(r.msg || t("pages.balancers.sshFailed", { defaultValue: "Installation failed" }));
        setPhase("error");
        return;
      }
      setSteps(r.obj.steps ?? []);
      if (r.obj.status === "error") {
        setError(r.obj.error || t("pages.balancers.sshFailed", { defaultValue: "Installation failed" }));
        setPhase("error");
        return;
      }
      if (r.obj.status === "success") break;
      await wait(1500);
    }
    // The agent needs a moment to start; then push the configuration.
    for (let i = 0; i < 12; i++) {
      const a = await postJson(panel(`balancer/apply/${balancerId}`), {}, true);
      if (!alive.current) return;
      if (a.success) break;
      await wait(2500);
    }
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
    await onInstalled();
    if (alive.current) setPhase("done");
  };

  if (phase === "running" || phase === "done") {
    return (
      <div className="flex flex-col gap-3">
        <NodeSSHProvisionSteps steps={steps} />
        {phase === "running" ? (
          <p className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
            <Spinner size={14} /> {t("pages.balancers.sshRunning", { defaultValue: "Installing… this can take a few minutes." })}
          </p>
        ) : (
          <AlertBanner
            type="info"
            title={t("pages.balancers.sshDone", {
              defaultValue: "The agent is installed and the configuration is pushed. Open the pool ports in the server firewall for clients.",
            })}
          />
        )}
      </div>
    );
  }

  if (phase === "confirm" && fingerprint) {
    return (
      <div className="flex flex-col gap-3 text-sm text-[var(--fg-muted)]">
        <p>
          {t("pages.nodes.sshHostKeyText", {
            defaultValue:
              "Compare this fingerprint with the one on the server (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub). If it differs, someone may be impersonating the server: do not continue.",
          })}
        </p>
        <p className="break-all rounded-lg border border-[var(--border)] px-3 py-2 font-mono text-xs text-[var(--fg)]">{fingerprint.fingerprint}</p>
        <p className="text-xs text-[var(--fg-subtle)]">{fingerprint.keyType}</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void install()}>
            {t("pages.nodes.sshHostKeyTrust", { defaultValue: "Fingerprint matches, connect" })}
          </Button>
          <Button variant="secondary" onClick={() => setPhase("form")}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <AlertBanner type="error" title={error} /> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_90px_1fr]">
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.balancers.sshHost", { defaultValue: "SSH host" })}</span>
          <Input value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.balancers.sshPort", { defaultValue: "Port" })}</span>
          <Input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.balancers.sshUser", { defaultValue: "User" })}</span>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <RadioOptionCard name="sshauth" heading={t("pages.balancers.sshPassword", { defaultValue: "Password" })} checked={authMethod === "password"} onChange={() => setAuthMethod("password")} />
        <RadioOptionCard name="sshauth" heading={t("pages.balancers.sshKey", { defaultValue: "Private key" })} checked={authMethod === "key"} onChange={() => setAuthMethod("key")} />
      </div>
      {authMethod === "password" ? (
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("password")}</span>
          <Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      ) : (
        <>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.balancers.sshKeyPem", { defaultValue: "Private key (PEM)" })}</span>
            <textarea
              className="h-28 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 font-mono text-xs text-[var(--fg)]"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.balancers.sshPassphrase", { defaultValue: "Key passphrase (optional)" })}</span>
            <Input type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </label>
        </>
      )}
      <p className="text-xs text-[var(--fg-subtle)]">
        {t("pages.balancers.sshNote", {
          defaultValue: "Credentials are used once for this install and are not stored. Docker is installed automatically if missing.",
        })}
      </p>
      <div>
        <Button variant="primary" loading={phase === "probing"} disabled={!canSubmit} onClick={() => void probe()}>
          {t("pages.balancers.sshStart", { defaultValue: "Check the server and install" })}
        </Button>
      </div>
    </div>
  );
}
