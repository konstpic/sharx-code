"use client";

import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { Button, Modal, useToast } from "@/components/ui";
import { CoreVersionCards } from "@/components/dashboard/CoreVersionCards";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { isForkXrayBuild } from "@/lib/nodeXrayBuild";

type Source = "official" | "sharx";

export type NodeCoreKind = "xray" | "telemt";

export type NodeCoreTarget = {
  id: number;
  name: string;
  xrayVersion?: string;
  xrayBuild?: string;
  telemtVersion?: string;
};

/**
 * Installs one Xray release (official or the SharX fork) or one Telemt release on a single node. The Dashboard's
 * version dialog installs on the ticked nodes; this one targets only the node it was opened for.
 */
export function NodeCoreModal({
  node,
  core,
  onClose,
  onInstalled,
  t,
}: {
  node: NodeCoreTarget | null;
  core: NodeCoreKind;
  onClose: () => void;
  onInstalled: () => void;
  t: TFunction;
}) {
  const toast = useToast();
  const [source, setSource] = useState<Source>("official");
  const [lists, setLists] = useState<Record<Source, string[] | null>>({ official: null, sharx: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const nodeId = node?.id ?? null;
  const isTelemt = core === "telemt";
  const currentFork = !isTelemt && isForkXrayBuild(node?.xrayBuild);

  // Start on the source the node runs now, and forget what was picked for the previous node.
  useEffect(() => {
    if (nodeId == null) return;
    setSource(currentFork ? "sharx" : "official");
    setPending(null);
    setError("");
    setLists({ official: null, sharx: null });
  }, [nodeId, currentFork, core]);

  useEffect(() => {
    if (nodeId == null || lists[source] !== null) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const url = isTelemt
      ? "api/server/getTelemtVersion"
      : source === "sharx"
        ? "api/server/getXrayVersion?source=sharx"
        : "api/server/getXrayVersion";
    getJson<string[]>(panel(url))
      .then((r) => {
        if (cancelled) return;
        if (r.success && r.obj) setLists((l) => ({ ...l, [source]: r.obj as string[] }));
        else setError(r.msg || t("pages.nodes.coreListFailed", { defaultValue: "Could not load the release list" }));
      })
      .catch(() => {
        if (!cancelled) setError(t("pages.nodes.coreListFailed", { defaultValue: "Could not load the release list" }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, source, lists, t, isTelemt]);

  if (!node) return null;

  const installed = isTelemt
    ? node.telemtVersion || ""
    : (node.xrayBuild && node.xrayBuild !== "bundled" ? node.xrayBuild : node.xrayVersion) || "";
  const coreName = isTelemt ? "Telemt" : "Xray";

  const install = async () => {
    if (!pending) return;
    setInstalling(true);
    try {
      const r = await postJson(
        panel(`api/server/${isTelemt ? "installTelemtOnNodes" : "installXrayOnNodes"}/${pending}`),
        { nodeIds: [node.id] },
        true,
      );
      if (r.success) {
        toast.success(t("success"));
        onInstalled();
        onClose();
      } else {
        toast.error(r.msg || t("fail"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      open
      onClose={installing ? () => undefined : onClose}
      title={t("pages.nodes.changeCoreTitleCore", { defaultValue: "{{core}} core on {{name}}", core: coreName, name: node.name })}
    >
      <p className="mb-3 text-xs text-[var(--fg-muted)]">
        {t("pages.nodes.changeCoreCurrent", { defaultValue: "Now:" })}{" "}
        <span className="font-mono text-[var(--fg)]">
          {(isTelemt ? node.telemtVersion : node.xrayVersion) || "—"}
          {currentFork ? " · SharX fork" : ""}
        </span>
        {" · "}
        {t("pages.nodes.changeCoreOnlyThisNode", { defaultValue: "applies to this node only" })}
      </p>

      {pending ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--fg)]">
            {t("pages.nodes.changeCoreConfirm", {
              defaultValue: "Install {{version}} on {{name}}? {{core}} on this node restarts for a few seconds.",
              version: pending,
              name: node.name,
              core: coreName,
            })}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="primary" loading={installing} onClick={() => void install()}>
              {t("pages.nodes.changeCoreInstall", { defaultValue: "Install" })}
            </Button>
            <Button type="button" variant="secondary" disabled={installing} onClick={() => setPending(null)}>
              {t("back")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {isTelemt ? null : (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant={source === "official" ? "primary" : "secondary"} onClick={() => setSource("official")}>
                {t("pages.index.xraySourceOfficial", { defaultValue: "Official Xray-core" })}
              </Button>
              <Button type="button" variant={source === "sharx" ? "primary" : "secondary"} onClick={() => setSource("sharx")}>
                {t("pages.index.xraySourceSharx", { defaultValue: "SharX fork" })}
              </Button>
            </div>
          )}
          {!isTelemt && source === "sharx" ? (
            <p className="mb-3 text-xs text-[var(--fg-muted)]">
              {t("pages.index.xraySourceSharxHint", {
                defaultValue:
                  "Optional fork of Xray-core with extra XHTTP features (OPTIONS as the uplink method). A fork build is a drop-in replacement; switch back to an official release at any time.",
              })}
            </p>
          ) : null}
          {error ? <p className="mb-3 text-xs text-red-400">{error}</p> : null}
          {loading && lists[source] === null ? (
            <p className="text-sm text-[var(--fg-muted)]">{t("loading")}</p>
          ) : (
            <CoreVersionCards
              key={`${node.id}-${core}-${source}`}
              versions={lists[source] ?? []}
              installed={installed}
              onPick={(v) => setPending(v)}
            />
          )}
        </>
      )}
    </Modal>
  );
}
