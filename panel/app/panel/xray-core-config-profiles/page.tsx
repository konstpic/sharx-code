"use client";

import { RequirePerm } from "@/components/panel/RequirePerm";
import { XrayCoreConfigProfilesPage } from "@/components/XrayCoreConfigProfilesPage";

export default function Page() {
  return (
    <RequirePerm perm="xray:read">
      <XrayCoreConfigProfilesPage />
    </RequirePerm>
  );
}
