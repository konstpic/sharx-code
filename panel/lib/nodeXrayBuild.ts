/** The Xray release a node worker reports as installed: a release tag, "bundled" for the image's own binary, or "" when not reported. */
export function isForkXrayBuild(build?: string): boolean {
  return /^v?\d+\.\d+\.\d+-sharx\.\d+$/.test((build ?? "").trim());
}

/** Text for the Xray version cell: the version, plus a "SharX fork" marker when the worker runs the fork build. */
export function xrayVersionLabel(version?: string, build?: string): string {
  const v = version?.trim() || "—";
  return isForkXrayBuild(build) ? `${v} · SharX fork` : v;
}
