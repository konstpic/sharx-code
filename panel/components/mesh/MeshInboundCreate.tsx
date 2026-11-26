"use client";

import { useState, type ReactNode } from "react";
import { Input, SelectNative } from "@/components/ui";
import { postJson } from "@/lib/api";
import { panel } from "@/lib/paths";

/** Answer of POST /panel/mesh/inbound/create. */
type MeshInboundResult = {
  inboundId?: number;
  client?: string;
  nodes?: string[];
  probes?: { node?: string; port: number; sni: string }[];
};

export type MeshInboundCreateProps = {
  operate: boolean;
  tr: (key: string, fallback: string) => string;
  /** Called after a successful creation: the page reloads the connection list. */
  onDone?: () => void;
};

/**
 * Creates one client connection and publishes it on every mesh node. The
 * connection is added to the checks at the same time, so the operator does not
 * have to pick it in the list again.
 */
export function MeshInboundCreate({
  operate,
  tr,
  onDone,
}: MeshInboundCreateProps) {
  const [port, setPort] = useState("");
  const [sni, setSni] = useState("");
  const [protocol, setProtocol] = useState("vless");
  const [security, setSecurity] = useState("reality");
  const [remark, setRemark] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const create = () => {
    if (!port || !sni) return;
    setBusy(true);
    setMsg("");
    setFailed(false);
    void postJson<MeshInboundResult>(
      panel("mesh/inbound/create"),
      {
        port: Number(port),
        sni,
        protocol,
        security,
        remark,
        add_probe: true,
      },
      true,
    )
      .then((r) => {
        if (r.success) {
          const o = r.obj || {};
          let text = tr(
            "inboundDone",
            "Connection #{id} created for {nodes}. Client: {client}.",
          )
            .replace("{id}", String(o.inboundId || ""))
            .replace("{nodes}", (o.nodes || []).join(", "))
            .replace("{client}", o.client || "-");
          if (o.probes && o.probes.length) {
            text += ` ${tr(
              "inboundProbesAdded",
              "Added to the checks: {n}.",
            ).replace("{n}", String(o.probes.length))}`;
          }
          setMsg(text);
          setPort("");
          setSni("");
          setRemark("");
          if (onDone) onDone();
        } else {
          setFailed(true);
          setMsg(r.msg || tr("inboundFailed", "Failed to create the connection."));
        }
      })
      .catch((e: unknown) => {
        setFailed(true);
        setMsg(
          String(
            (e as Error)?.message || tr("inboundFailed", "Failed to create the connection."),
          ),
        );
      })
      .then(() => setBusy(false));
  };

  const field = (label: ReactNode, child: ReactNode) => (
    <label className="flex flex-col gap-1 text-xs text-[var(--fg-muted)]">
      {label}
      {child}
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {field(
          tr("inboundPort", "Port"),
          <Input
            disabled={!operate || busy}
            type="number"
            placeholder="443"
            className="!w-full"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
          />,
        )}
        {field(
          tr("inboundSNI", "SNI"),
          <Input
            disabled={!operate || busy}
            placeholder="www.example.com"
            className="!w-full"
            value={sni}
            onChange={(e) => setSni(e.target.value)}
          />,
        )}
        {field(
          tr("inboundProtocol", "Protocol"),
          <SelectNative
            disabled={!operate || busy}
            className="!w-full"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
          >
            <option value="vless">vless</option>
            <option value="trojan">trojan</option>
          </SelectNative>,
        )}
        {field(
          tr("inboundSecurity", "Security"),
          <SelectNative
            disabled={!operate || busy}
            className="!w-full"
            value={security}
            onChange={(e) => setSecurity(e.target.value)}
          >
            <option value="reality">reality</option>
            <option value="tls">tls</option>
          </SelectNative>,
        )}
        {field(
          tr("inboundRemark", "Remark"),
          <Input
            disabled={!operate || busy}
            placeholder="Mesh"
            className="!w-full"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />,
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!operate || busy || !port || !sni}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          onClick={create}
        >
          {busy ? tr("creating", "Creating...") : tr("inboundCreate", "Create")}
        </button>
      </div>
      {msg ? (
        <p
          role="status"
          className="text-sm"
          style={{ color: failed ? "#f87171" : "var(--accent)" }}
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
