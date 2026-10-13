"use client";
import { useEffect } from "react";
import { linkP } from "@/lib/paths";
export default function Page() {
  useEffect(() => { window.location.replace(linkP("panel/nodes")); }, []);
  return null;
}
