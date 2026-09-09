'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PaperFooter, PaperHeader } from './publication-brand';
import type { Member } from '@/lib/commerce-types';

type Account = { id: string; email: string; deliveryEnabled: boolean; deliverySuppressed: boolean; paidAccess: boolean; billingAvailable: boolean; subscription: Pick<Member['subscription'], 'status' | 'paidThrough' | 'cancelAtPeriodEnd'> };
type Sales = { salesOpen: boolean; signInReady: boolean; monthlyAmount: number | null; currency: string; mode: string };

export function MemberAccount() {
  const [member, setMember] = useState<Account | null>(null);
  const [sales, setSales] = useState<Sales | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch('/api/member', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Your account could not be loaded.');
    setMember(data.member); setSales(data.sales);
  }, []);
  useEffect(() => {
    load().catch(error => setError(error.message)).finally(() => setLoading(false));
    if (new URLSearchParams(window.location.search).get('checkout') === 'success') setMessage('Thank you. Your account will update after your payment is confirmed. Use Refresh subscription to check its progress.');
    if (new URLSearchParams(window.location.search).get('checkout') === 'canceled') setMessage('Checkout was canceled. Your account is still available.');
  }, [load]);

  async function act(url: string, method = 'POST', body?: unknown) {
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'This action could not be completed.');
      if (data.url) { window.location.assign(data.url); return; }
      await load();
      setMessage(data.message || (url.includes('refresh') ? 'Your subscription is up to date.' : method === 'DELETE' ? 'You are signed out.' : 'Your preferences have been saved.'));
    } catch (error) { setError(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  function requestLink(event: FormEvent) { event.preventDefault(); void act('/api/member/request-link', 'POST', { email, deliveryConsent: consent }); }
  const monthly = sales?.monthlyAmount ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(sales.monthlyAmount / 100) : null;
  const status = member?.subscription.status.replaceAll('_', ' ');

  return <main className="paper reader-paper">
    <PaperHeader /><div className="paper-dateline"><span>THE SUBSCRIBER’S DESK</span><span>YOUR THURSDAY POST</span><Link href="/editions">Edition archive ↗</Link></div>
    <div className="reader-account-layout"><section className="reader-account-main">
      <p className="paper-kicker">The subscriber’s desk</p><h1>{member ? 'Your account.' : 'Your Thursday starts here.'}</h1>
      {loading ? <p role="status">Loading your account…</p> : null}
      {error ? <p className="reader-feedback reader-feedback-error" role="alert">{error}</p> : null}
      {message ? <p className="reader-feedback" role="status">{message}</p> : null}
      {!loading && !member ? <>
        <p>Sign in with a secure link sent to your email. New readers can create an account the same way.</p>
        {sales && !sales.salesOpen ? <div className="reader-account-section"><h2>Subscriptions open soon</h2><p>The first paid subscriptions are being prepared. Pricing will be published here when sales open.</p></div> : monthly ? <p className="reader-account-price">{monthly} AUD per month{sales?.mode === 'test' ? ' · Test checkout' : ''}</p> : null}
        <form onSubmit={requestLink} className="paper-form"><label htmlFor="member-email">Email address</label><input id="member-email" name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} placeholder="you@example.com" />
          <label className="reader-consent" htmlFor="member-consent"><input id="member-consent" type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>Email me The Thursday Post editions. I can unsubscribe at any time.</span></label>
          <button className="paper-button" disabled={busy || !sales?.signInReady}>{busy ? 'Sending your link…' : 'Email me a sign-in link'}</button>
          {sales && !sales.signInReady ? <p>Member sign-in is being set up. Please check back soon.</p> : null}
          <p className="reader-form-note">Edition delivery requires an active subscription. We only send editions with your permission.</p>
        </form>
      </> : member ? <>
        <p className="reader-account-identity">Signed in as <strong>{member.email}</strong></p>
        <section className="reader-account-section"><h2>Your subscription</h2>
          <p className="reader-account-status">{member.paidAccess ? 'Subscriber access is active.' : member.subscription.status === 'none' ? 'You do not have a paid subscription yet.' : `Subscription status: ${status}.`}</p>
          {member.subscription.paidThrough && member.paidAccess ? <p>{member.subscription.cancelAtPeriodEnd ? 'Your subscription ends' : 'Current access through'} {new Date(member.subscription.paidThrough).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.</p> : null}
          {member.paidAccess ? <Link className="paper-button" href="/editions">Read your editions</Link> : sales?.salesOpen && monthly ? <button className="paper-button" disabled={busy} onClick={() => void act('/api/checkout')}>Subscribe · {monthly} AUD per month{sales.mode === 'test' ? ' (test)' : ''}</button> : <p>Subscriptions are not on sale yet. The monthly price will appear here when sales open.</p>}
          {member.billingAvailable ? <div className="reader-actions"><button className="paper-button reader-button-outline" disabled={busy} onClick={() => void act('/api/billing/portal')}>Manage billing & cancellation</button><button className="paper-button reader-button-outline" disabled={busy} onClick={() => void act('/api/billing/refresh')}>Refresh subscription</button></div> : null}
          {sales?.salesOpen && !member.paidAccess ? <p>Monthly subscriptions renew automatically until canceled. Review the price and terms at checkout.</p> : null}
        </section>
        <section className="reader-account-section"><h2>Edition emails</h2><p>{member.deliverySuppressed ? 'Delivery is paused after a delivery problem. Contact the editor to restore it.' : member.deliveryEnabled ? 'You have opted in to receive subscriber editions by email.' : 'Edition emails are switched off.'}</p><button className="paper-button reader-button-outline" disabled={busy || member.deliverySuppressed} onClick={() => void act('/api/member', 'PATCH', { deliveryEnabled: !member.deliveryEnabled })}>{member.deliveryEnabled ? 'Turn off edition emails' : 'Send me edition emails'}</button><p className="reader-form-note">Email preferences do not change your subscription or billing.</p></section>
        <button className="paper-button reader-button-outline" disabled={busy} onClick={() => void act('/api/member', 'DELETE')}>Sign out</button>
      </> : null}
    </section><aside className="reader-margin"><p className="paper-column-label">THE READING ROOM</p><h2>A paper worth<br />making time for.</h2><p>People, decisions and the stories shaping Australian thoroughbred racing.</p><Link className="paper-continue" href="/editions">Browse the edition archive ↗</Link><div className="paper-rule" /><h3>A direct line<br />to the newsroom.</h3><p>Questions about your account, a correction or something we should investigate?</p><a className="paper-continue" href="mailto:workbenchadmin@gmail.com">Write to the Thursday Post ↗</a><div className="paper-rule" /><p><Link href="/terms">Subscriber terms</Link><br /><Link href="/privacy">Privacy information</Link></p></aside></div>
    <PaperFooter />
  </main>;
}
