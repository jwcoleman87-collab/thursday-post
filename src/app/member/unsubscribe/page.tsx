import type { Metadata } from 'next';
import { MemberVerification } from '@/components/member-verification';
import '../../editions/edition.css';
export const metadata: Metadata = { title: 'Email preferences', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function UnsubscribePage() { return <MemberVerification mode="unsubscribe" />; }
