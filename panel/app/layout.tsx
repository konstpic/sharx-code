import type { Metadata } from "next";
import {
  Comfortaa,
  Fira_Mono,
  Montserrat,
  Orbitron,
  Pathway_Gothic_One,
  Playfair_Display,
  Sacramento,
  Unbounded,
} from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { themeInitScript } from "@/lib/theme-provider";

const montserrat = Montserrat({
  variable: "--font-mont",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const firaMono = Fira_Mono({
  variable: "--font-fira",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const sacramento = Sacramento({
  variable: "--font-sacramento",
  subsets: ["latin", "latin-ext"],
  weight: "400",
  display: "swap",
});

/** Star Wars theme — display / crawl-style headings */
const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const pathwayGothic = Pathway_Gothic_One({
  variable: "--font-pathway",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

/** Hello Kitty theme — soft rounded display headings */
const comfortaa = Comfortaa({
  variable: "--font-comfortaa",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  display: "swap",
});

/** Barbie theme — glam serif display headings */
const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "cyrillic"],
  weight: ["600", "700", "800"],
  style: ["normal", "italic"],
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
        className={`${montserrat.variable} ${unbounded.variable} ${firaMono.variable} ${sacramento.variable} ${orbitron.variable} ${pathwayGothic.variable} ${comfortaa.variable} ${playfairDisplay.variable} antialiased`}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
