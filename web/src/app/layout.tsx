import type { Metadata, Viewport } from "next";
import {
  Barlow,
  Barlow_Condensed,
  Crimson_Text,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const crimsonText = Crimson_Text({
  variable: "--font-crimson-text",
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic"],
});

export const metadata: Metadata = {
  title: "Overlander",
  description: "Plan overland trips with confidence.",
  // iPad PWA install affordances. `capable: true` emits the legacy
  // <meta name="apple-mobile-web-app-capable">; the manifest's
  // `display: standalone` covers modern browsers. Status-bar style
  // black-translucent lets our dark chrome (--bg-base) bleed under
  // the iOS status bar instead of leaving a white strip.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Overlander",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover lets the app paint under iOS safe-area insets
  // (status bar, home indicator). Components that need to avoid them
  // can use env(safe-area-inset-*) — none do today, but offline
  // priming UI (sessions 3/4) likely will.
  viewportFit: "cover",
  themeColor: "#0a0b0c", // matches --bg-base in globals.css and the manifest
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} ${spaceGrotesk.variable} ${spaceMono.variable} ${crimsonText.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {modal}
      </body>
    </html>
  );
}
