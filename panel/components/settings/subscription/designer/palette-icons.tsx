"use client";

import { AlignJustify, BarChart3, Code2, Frame, Image as ImageIcon, Languages, LayoutTemplate, Minus, MousePointerClick, QrCode, Repeat, Smile, SquareDashed, Star, Tag, Clapperboard, Smartphone, Type, type LucideIcon } from "lucide-react";
import type { NodeType } from "@/lib/subLayout/types";

const MAP: Record<NodeType, LucideIcon> = {
  frame: Frame,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  badge: Tag,
  divider: Minus,
  spacer: SquareDashed,
  progress: BarChart3,
  icon: Star,
  qr: QrCode,
  repeat: Repeat,
  block: LayoutTemplate,
  html: Code2,
  header: AlignJustify,
  "locale-switch": Languages,
  scene: Clapperboard,
  apps: Smartphone,
};

export function TypeIcon({ type, size = 16, className }: { type: NodeType; size?: number; className?: string }) {
  const I = MAP[type] ?? Smile;
  return <I size={size} className={className} aria-hidden />;
}
