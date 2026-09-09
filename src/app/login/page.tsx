"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import {ThursdayMark} from '@/components/publication-brand';

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in failed. Please try again.");
      window.location.assign("/newsroom");
    } catch (error) { setError(error instanceof Error ? error.message : "Sign-in failed."); setBusy(false); }
  }
  return <main className="login-page"><div className="login-brand"><ThursdayMark/><span>Thursday Post</span></div><section className="login-card"><span className="login-icon"><LockKeyhole size={24} /></span><p className="eyebrow">The editor’s entrance</p><h1>Welcome to the desk.</h1><p>Sign in to run the newsroom, review the evidence and approve the next edition.</p><form onSubmit={login}><label htmlFor="password">Newsroom password</label><input autoFocus id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your newsroom password" />{error ? <div className="notice danger" role="alert">{error}</div> : null}<button className="button primary" disabled={busy}>{busy ? "Signing in…" : "Enter the newsroom"}<ArrowRight size={16} /></button></form><Link href="/news" className="text-link">Read the newspaper <ArrowRight size={14} /></Link></section><p className="login-note">An evidence-led Australian thoroughbred racing newsroom.</p></main>;
}
