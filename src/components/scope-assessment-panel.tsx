'use client';
import { useState, type FormEvent } from 'react';
import type { ScopeAssessment } from '@/lib/domain';

/** A scope decision is not a personal fact attestation or a missing-evidence resolution. */
export default function ScopeAssessmentPanel({ assessment, busy, onWithdraw }: {
  assessment: ScopeAssessment;
  busy: boolean;
  onWithdraw: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  function withdraw(event: FormEvent) {
    event.preventDefault();
    if (!busy && note.trim().length >= 8) void onWithdraw(note.trim());
  }
  return <section aria-label="Delegated editorial scope assessment">
    <h4>Additional reporting angle not required for this draft’s scope</h4>
    <p>Assessed by the newsroom assessor under James’s delegated authority. This does not mean James personally reviewed the evidence.</p>
    <p>{assessment.rationale}</p>
    <p>The original question remains open. Missing evidence has not been verified. Publication still requires James’s separate approval.</p>
    <p>Supporting claims: {assessment.claimIds.join(', ')}</p>
    <form onSubmit={withdraw}>
      <label>Why should this angle return to research?
        <textarea required minLength={8} maxLength={3000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
      </label>
      <button className="button" type="submit" disabled={busy || note.trim().length < 8}>Withdraw assessment and request research</button>
    </form>
  </section>;
}
