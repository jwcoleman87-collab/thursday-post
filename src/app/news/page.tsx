import PublicEdition from "@/components/public-edition";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "The newspaper" };

export default function NewsPage() {
  return <PublicEdition />;
}
