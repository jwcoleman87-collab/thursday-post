import type { Metadata } from "next";
import "./globals.css";
import "./paper.css";
import "./edition-pages.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEWSROOM_PUBLIC_URL || 'https://the-racing-desk.vercel.app'),
  title: { default: "Thursday Post — Australian Racing", template: "%s · Thursday Post" },
  description: "Independent Australian racing journalism. The people, decisions and stories shaping the sport, reviewed before publication.",
  openGraph: {siteName:'Thursday Post',locale:'en_AU',type:'website'},
  twitter: {card:'summary_large_image'},
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body>{children}</body></html>;
}
