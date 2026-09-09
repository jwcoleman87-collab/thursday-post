import PublicEdition from "@/components/public-edition";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicEdition articleId={id} />;
}
