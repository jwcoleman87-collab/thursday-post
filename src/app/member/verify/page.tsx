import type { Metadata } from 'next';
import { MemberVerification } from '@/components/member-verification';
import '../../editions/edition.css';
export const metadata: Metadata = { title: 'Confirm sign-in', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function VerifyPage() { return <MemberVerification mode="verify" />; }
