import type { LucideIcon } from "lucide-react";

export type NavChild = { id: string; label: string; href: string; active: boolean };

/** One top-level menu entry in a view-agnostic shape (carousel, dock; the sidebar keeps its own markup). */
export type NavNode = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  children?: NavChild[];
  /** Plain document navigation (logout). */
  external?: boolean;
};
