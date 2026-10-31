import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { themeInitScript } from "@/lib/theme-provider";

/**
 * Only the body font is preloaded. The others are used by some pages/themes only; preloading them made the browser warn
 * "resource was preloaded but not used within a few seconds" on every page load. They still load on demand via @font-face.
 */
const montserrat = localFont({
  src: [{ path: "./fonts/montserrat/Montserrat[wght].ttf", weight: "100 900", style: "normal" }],
  variable: "--font-mont",
  preload: true,
  display: "swap",
});

const unbounded = localFont({
  src: [{ path: "./fonts/unbounded/Unbounded[wght].ttf", weight: "200 900", style: "normal" }],
  variable: "--font-unbounded",
  preload: false,
  display: "swap",
});

const firaMono = localFont({
  src: [
    { path: "./fonts/firamono/FiraMono-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/firamono/FiraMono-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/firamono/FiraMono-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-fira",
  preload: false,
  display: "swap",
});

const sacramento = localFont({
  src: [{ path: "./fonts/sacramento/Sacramento-Regular.ttf", weight: "400", style: "normal" }],
  variable: "--font-sacramento",
  preload: false,
  display: "swap",
});

/** Cyrillic cursive for the handwritten login greeting (Sacramento has no Cyrillic glyphs) */
const marckScript = localFont({
  src: [{ path: "./fonts/marckscript/MarckScript-Regular.ttf", weight: "400", style: "normal" }],
  variable: "--font-marck",
  preload: false,
  display: "swap",
});

/** Star Wars theme — display / crawl-style headings */
const orbitron = localFont({
  src: [{ path: "./fonts/orbitron/Orbitron[wght].ttf", weight: "500 700", style: "normal" }],
  variable: "--font-orbitron",
  preload: false,
  display: "swap",
});

const pathwayGothic = localFont({
  src: [{ path: "./fonts/pathwaygothicone/PathwayGothicOne-Regular.ttf", weight: "400", style: "normal" }],
  variable: "--font-pathway",
  preload: false,
  display: "swap",
});

/** Hello Kitty theme — soft rounded display headings */
const comfortaa = localFont({
  src: [{ path: "./fonts/comfortaa/Comfortaa[wght].ttf", weight: "500 700", style: "normal" }],
  variable: "--font-comfortaa",
  preload: false,
  display: "swap",
});

/** Barbie theme — glam serif display headings */
const playfairDisplay = localFont({
  src: [
    { path: "./fonts/playfair-display/PlayfairDisplay-Variable.ttf", weight: "600 800", style: "normal" },
    { path: "./fonts/playfair-display/PlayfairDisplay-Italic-Variable.ttf", weight: "600 800", style: "italic" },
  ],
  adjustFontFallback: "Times New Roman",
  preload: false,
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SharX",
  description: "SharX panel",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-panel-theme="web"
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#05060a" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${montserrat.variable} ${unbounded.variable} ${firaMono.variable} ${sacramento.variable} ${marckScript.variable} ${orbitron.variable} ${pathwayGothic.variable} ${comfortaa.variable} ${playfairDisplay.variable} antialiased`}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
