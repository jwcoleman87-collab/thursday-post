'use client';

import { FormEvent, useState } from 'react';

export default function SubscribeLanding() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  }

  return (
    <main className="tp-landing">
      <section className="tp-paper" aria-labelledby="thursday-post-title">
        <div className="tp-rule" />
        <p className="tp-kicker">Australian Racing · Delivered Thursdays</p>
        <header className="tp-masthead">
          <span className="tp-horse" aria-hidden="true">♞</span>
          <h1 id="thursday-post-title">Thursday Post</h1>
        </header>
        <div className="tp-rule tp-rule-heavy" />

        <div className="tp-subscribe-copy">
          <p className="tp-eyebrow">The weekly racing newspaper</p>
          <h2>Racing news worth opening your inbox for.</h2>
          <p className="tp-description">
            Independent racing stories, people and industry news — collected, verified and delivered to your inbox every Thursday.
          </p>

          {submitted ? (
            <div className="tp-success" role="status">
              You’re on the list. Thursday Post will be in your inbox.
            </div>
          ) : (
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
              <button type="submit">Subscribe</button>
            </form>
          )}
          <p className="tp-smallprint">Free to subscribe. Unsubscribe at any time.</p>
        </div>

        <footer className="tp-footer">
          <span>THURSDAY POST</span>
          <span>COLLECT · AGGREGATE · DISTRIBUTE</span>
        </footer>
      </section>
    </main>
  );
}
