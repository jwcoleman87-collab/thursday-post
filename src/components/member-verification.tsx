'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PaperFooter, PaperHeader } from './publication-brand';

export function MemberVerification({ mode }: { mode: 'verify' | 'unsubscribe' }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const incoming = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    setToken(incoming);
    // Secrets are removed from the visible URL before the reader follows another link.
    window.history.replaceState(null, '', window.location.pathname);
    if (!incoming) setError('This link is incomplete. Return to your account to request a new link.');
  }, []);
  async function confirm() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/member/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'This link could not be confirmed.');
      if (mode === 'verify') { window.location.replace('/member'); return; }
      setDone(true); setToken('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <main className="paper reader-paper"><PaperHeader /><div className="paper-dateline"><span>YOUR ACCOUNT</span><span>{mode === 'verify' ? 'SUBSCRIBER SIGN IN' : 'EDITION EMAIL PREFERENCES'}</span></div><section className="reader-confirmation"><p className="paper-kicker">The subscriber’s desk</p><h1>{mode === 'verify' ? 'One step to your account.' : done ? 'Your inbox. Your choice.' : 'Edition email preferences.'}</h1><p>{done ? 'You have unsubscribed from edition emails. Your paid membership is unchanged, and you can continue reading while your subscription is active.' : mode === 'verify' ? 'Continue to securely sign in to your Thursday Post account.' : 'Confirm to stop receiving edition emails. This does not cancel your paid subscription. Manage billing separately in your account.'}</p>{error ? <p className="reader-feedback reader-feedback-error" role="alert">{error}</p> : null}<div className="reader-actions">{!done ? <button className="paper-button" disabled={busy || !token} onClick={() => void confirm()}>{busy ? 'Confirming…' : mode === 'verify' ? 'Continue to my account ↗' : 'Unsubscribe from edition emails'}</button> : null}<Link className="paper-continue" href="/member">{done ? 'Manage your account ↗' : 'Return to your account'}</Link></div>{done ? <Link className="paper-continue" href="/editions">Browse the editions ↗</Link> : null}</section><PaperFooter /></main>;
}
