'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {ThursdayMark} from './publication-brand';

export default function SubscribeLanding() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [offer,setOffer]=useState<{liveSalesEnabled:boolean;canRequestLink:boolean;priceDisplay:string|null}|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const[consent,setConsent]=useState(false);
  useEffect(()=>{const controller=new AbortController();fetch('/api/billing/offer',{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Subscription information is temporarily unavailable.');return response.json();}).then(setOffer).catch(error=>{if(error.name!=='AbortError')setError(error.message);});return()=>controller.abort();},[]);

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()||busy||!offer?.canRequestLink) return;
    setBusy(true);setError('');
    try{const response=await fetch('/api/member/request-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),deliveryConsent:consent})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Your sign-in link could not be sent.');setSubmitted(true);}catch(error){setError(error instanceof Error?error.message:'Please try again.');}finally{setBusy(false);}
  }

  return (
    <main className="tp-landing">
      <section className="tp-paper" aria-labelledby="thursday-post-title">
        <div className="tp-rule" />
        <p className="tp-kicker">Australian Racing · The Thursday Edition</p>
        <header className="tp-masthead">
          <ThursdayMark className="tp-horse"/>
          <h1 id="thursday-post-title">Thursday Post</h1>
        </header>
        <div className="tp-rule tp-rule-heavy" />

        <div className="tp-subscribe-copy">
          <p className="tp-eyebrow">The weekly racing newspaper</p>
          <h2>Racing news worth opening your inbox for.</h2>
          <p className="tp-description">
            Independent racing stories, people and industry news. A considered view of the sport, its communities and the questions worth asking.
          </p>

          {submitted ? (
            <div className="tp-success" role="status">
              Check your inbox for a secure sign-in link. Confirm your email to continue; no payment has been taken.
            </div>
          ) : offer?.canRequestLink ? (
            <>
            <form className="tp-subscribe-form" onSubmit={subscribe}>
              <label htmlFor="subscriber-email" className="tp-visually-hidden">Email address</label>
              <input
                id="subscriber-email"
                type="email"
                required
                autoComplete="email"
                placeholder="Your email address"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" disabled={busy}>{busy?'Sending…':'Continue'}</button>
            </form>
            <label className="tp-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>Email me Thursday Post editions. I can unsubscribe at any time.</label>
            </>
          ) : offer ? <div className="tp-success"><strong>Preparing the first edition.</strong><p>Subscriptions are not open yet. The price and launch date will be announced here.</p></div> : <p role="status">Checking subscription availability…</p>}
          {error?<p role="alert" className="tp-error">{error}</p>:null}
          <p className="tp-smallprint">{offer?.liveSalesEnabled?`${offer.priceDisplay}. Renews until cancelled. Email preferences and billing are managed separately.`:'No subscription payment is currently being taken.'}</p>
          <nav className="tp-links" aria-label="Subscriber information"><Link href="/subscribe">Subscription details</Link><Link href="/member">Reader sign in</Link><a href="mailto:workbenchadmin@gmail.com">Contact the Post</a></nav>
        </div>

        <footer className="tp-footer">
          <span>THURSDAY POST</span>
          <nav aria-label="Legal information"><Link href="/privacy">Privacy</Link> · <Link href="/terms">Subscriber terms</Link></nav>
        </footer>
      </section>
    </main>
  );
}
