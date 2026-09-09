import EditionReader from './reader';
import '../edition.css';
export const metadata = { title: 'Read the edition' };
export default async function EditionPage({ params }: { params: Promise<{ id: string }> }) {
  return <EditionReader id={(await params).id} />;
}
