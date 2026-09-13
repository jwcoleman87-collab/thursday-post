import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScopeAssessmentPanel from '../src/components/scope-assessment-panel';
import type { ScopeAssessment } from '../src/lib/domain';

const assessment: ScopeAssessment = { outcome: 'not_required_for_scope', rationale: 'No owners or staffing assertion is present.', assessor: 'newsroom-assessor', authorisingOwner: 'James', claimIds: ['claim-fixture'], draftHash: 'a'.repeat(64), evidenceFingerprint: 'b'.repeat(64), assessedAt: '2026-09-13T00:00:00Z' };
test('scope panel distinguishes delegated scope from evidence verification and exposes an owner withdrawal form', () => {
  const html = renderToStaticMarkup(createElement(ScopeAssessmentPanel, { assessment, busy: false, onWithdraw: async () => {} }));
  assert.match(html, /newsroom assessor/);
  assert.match(html, /does not mean James personally reviewed/);
  assert.match(html, /Missing evidence has not been verified/);
  assert.match(html, /Withdraw assessment and request research/);
  assert.match(html, /minLength="8"/i);
  assert.match(html, /disabled=""/);
});
test('scope withdrawal is wired to the existing authenticated editorial action with research lockout', () => {
  const desk = readFileSync(new URL('../src/components/editorial-desk.tsx', import.meta.url), 'utf8');
  assert.match(desk, /withdraw_scope_assessment/);
  assert.match(desk, /ScopeAssessmentPanel/);
  assert.match(desk, /busy=\{busy\|\|Boolean\(data\?\.config\.running\)\}/);
  const html = renderToStaticMarkup(createElement(ScopeAssessmentPanel, { assessment, busy: true, onWithdraw: async () => {} }));
  assert.match(html, /<textarea[^>]*disabled=""/);
});
