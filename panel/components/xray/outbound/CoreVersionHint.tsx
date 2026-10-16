"use client";

import { useXrayCoreVersion } from "@/lib/useXrayCoreVersion";
import { isXrayFeatureSupported, xrayFeatureMinVersion, type XrayFeatureId } from "@/lib/xrayVersionFeatures";
import type { Tr } from "@/components/xray/configurator/fields";

/**
 * "Requires Xray >= X" note. Amber when the panel's running core is known to be older, muted otherwise
 * (an unknown version never blocks anything). Nodes may run a different core than the panel host.
 */
export function CoreVersionHint({ feature, tr }: { feature: XrayFeatureId; tr: Tr }) {
  const version = useXrayCoreVersion();
  const min = xrayFeatureMinVersion(feature);
  const unsupported = isXrayFeatureSupported(version, feature) === false;
  return (
    <div className={`text-[11px] leading-snug ${unsupported ? "text-amber-400" : "text-[var(--fg-subtle)]"}`}>
      {unsupported
        ? tr("coreTooOld", "Requires Xray ≥ {{min}}; this panel runs {{have}}. Update the core first.", { min, have: version ?? "" })
        : tr("coreRequires", "Requires Xray ≥ {{min}}.", { min })}
    </div>
  );
}
