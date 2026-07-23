"use client";

import Link from "next/link";
import { getBasePath } from "@/lib/paths";

type Props = {
  href: string;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
};

/**
 * Full document navigation when Go injects a runtime secret base path: Next client
 * router fetches RSC flight at unprefixed /panel/.../index.txt and breaks.
 */
export function PanelNavLink({ href, className, onClick, children }: Props) {
  if (getBasePath()) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
