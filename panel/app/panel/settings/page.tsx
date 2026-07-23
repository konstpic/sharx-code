"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasRuntimeBasePath, linkP } from "@/lib/paths";
import { DEFAULT_SETTINGS_TAB } from "@/lib/settingsTabs";

export default function Page() {
  const router = useRouter();
  const target = linkP(`panel/settings/${DEFAULT_SETTINGS_TAB}`);

  useEffect(() => {
    if (hasRuntimeBasePath()) {
      window.location.replace(target);
      return;
    }
    router.replace(target);
  }, [router, target]);

  return null;
}
