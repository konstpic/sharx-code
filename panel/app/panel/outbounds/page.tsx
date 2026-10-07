"use client";

import { RequirePerm } from "@/components/panel/RequirePerm";
import { ArrowLeftRight } from "lucide-react";
import { SimpleListPage } from "@/components/SimpleListPage";

export default function Page() {
  return (
    <RequirePerm perm="outbounds:read">
      <SimpleListPage
        titleKey="menu.outbounds"
        path="outbound/list"
        headerIcon={ArrowLeftRight}
        headerIconTone="info"
      />
    </RequirePerm>
  );
}
