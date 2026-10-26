"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A line of text that writes itself: each letter's outline is drawn in turn, then filled. The visible text is an SVG (aria-hidden);
 * the same words stay in the DOM for screen readers. With reduced motion, or before the font is measured, the text just appears.
 */
export function HandwrittenText({
  text,
  className = "",
  reduceMotion = false,
  perLetterMs = 170,
}: {
  text: string;
  className?: string;
  reduceMotion?: boolean;
  perLetterMs?: number;
}) {
  const textRef = useRef<SVGTextElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const FONT_SIZE = 120;

  const measure = () => {
    const el = textRef.current;
    if (!el) return;
    const b = el.getBBox();
    if (b.width > 0) setBox({ x: b.x - 6, y: b.y - 6, w: b.width + 12, h: b.height + 12 });
  };

  useLayoutEffect(() => {
    measure();
  }, [text]);

  // the script font arrives after the first paint: measure again once it is ready
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
    };
  }, [text]);

  const chars = Array.from(text);
  return (
    <>
      <span className="sr-only">{text}</span>
      <svg
        aria-hidden
        role="presentation"
        className={`mx-auto block overflow-visible ${className}`}
        style={{ height: "clamp(3rem, 1.6rem + 4.4vw, 4.6rem)", width: "auto", maxWidth: "100%", visibility: box ? "visible" : "hidden" }}
        viewBox={box ? `${box.x} ${box.y} ${box.w} ${box.h}` : `0 0 ${Math.max(1, chars.length) * 60} 150`}
        key={box ? "m" : "u"}
      >
        <text
          ref={textRef}
          x={0}
          y={FONT_SIZE}
          fontSize={FONT_SIZE}
          className={reduceMotion ? "hw-static" : "hw-text"}
          style={{ ["--hw-len" as string]: `${FONT_SIZE * 7}px` }}
        >
          {chars.map((ch, i) => (
            <tspan key={i} className="hw-glyph" style={{ ["--hw-d" as string]: `${i * perLetterMs}ms` }}>
              {ch}
            </tspan>
          ))}
        </text>
      </svg>
    </>
  );
}
