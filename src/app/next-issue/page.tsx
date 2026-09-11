import type { Metadata } from "next";
import NextIssuePreview from "@/components/next-issue-preview";

export const metadata: Metadata = { title: "Next issue so far", robots: { index: false, follow: false } };
export default function Page() { return <NextIssuePreview />; }
