import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "The Racing Desk · Newsroom", template: "%s · The Racing Desk" },
  description: "An evidence-led Australian thoroughbred racing newspaper. Independently researched, reviewed by James, and traceable to the source.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body>{children}</body></html>;
}
