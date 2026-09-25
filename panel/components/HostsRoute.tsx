"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { BundleHostsPage } from "@/components/BundleHostsPage";
import { HostsPage } from "@/components/HostsPage";
import { Spinner } from "@/components/ui";

/** Shows the bundle-scheme hosts once the bundle scheme is active, the previous hosts page before. */
export function HostsRoute() {
  const [mode, setMode] = useState<"loading" | "bundles" | "legacy">("loading");
  useEffect(() => {
    let alive = true;
    void getJson<{ enabled?: boolean }>(panel("bundle/state")).then((r) => {
      if (alive) setMode(r.success && r.obj?.enabled ? "bundles" : "legacy");
    });
    return () => {
      alive = false;
    };
  }, []);
  if (mode === "loading") {
    return (
      <div className="grid min-h-40 place-items-center">
        <Spinner size={32} />
      </div>
    );
  }
  return mode === "bundles" ? <BundleHostsPage /> : <HostsPage />;
}
