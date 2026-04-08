import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Display font: distinctive serif with optical italics for the wordmark.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// Mono font: timestamps, status codes, intent labels, session ids.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

// Body font: comfortable, characterful sans for the suggestion text itself.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sales Copilot",
  description: "Live coaching for sales conversations",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${jetbrainsMono.variable} ${ibmPlexSans.variable} dark`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
