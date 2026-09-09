import type { Metadata } from 'next';
import { MemberAccount } from '@/components/member-account';
import '../editions/edition.css';
export const metadata: Metadata = { title: 'Your account', robots: { index: false, follow: false } };
export default function MemberPage() { return <MemberAccount />; }
