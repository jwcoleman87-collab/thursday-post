# JSONB integrity repair

## Cause

Production stores the newsroom aggregate as PostgreSQL `jsonb`; local tests used SQLite TEXT. JSONB does not preserve object insertion order. The old `draftHash` fixed the outer field order but serialized nested `factReview`, sentences, captions and `assessorReview` directly. A genuine writer-produced human review `{actor, note, reviewedAt}` is read back with different key order, so unchanged content fails its original hash. Empty `deck` is retained and is not treated as absent by this fix.

## Fix

`draftHashJson` reconstructs the existing writer's documented field order, recursively independent of storage order. The known writer-produced hashes are preserved: no stored digest is overwritten, no historic review is removed, and no expected-version/self-consistency check is relaxed. Sentence/evidence array order, string contents, empty optional fields, values and attestation contents remain significant. Unknown nested keys are not silently dropped.

Evidence fingerprints also used insertion-order-sensitive JSON. They now use recursive canonical JSON so a just-saved assessor review, scope decision or autonomous checkpoint survives JSONB and strict backup parsing. Old order-dependent evidence bindings may become stale: they fail closed and require fresh assessment under the existing workflow. This is not an automatic migration of editorial authority or a claim that old evidence was rechecked. Original history remains retained. New assessed drafts bind to the canonical evidence snapshot.

## Tests

Normal CI provisions a disposable PostgreSQL 17 service with a synthetic-only database; production/Neon credentials are not used. The integration regression first demonstrates the old hash diverging after an actual jsonb round trip, then verifies preservation of the original digest, a real stored human edit, assessed-draft HTTP save, optional-angle assessment, subsequent database read, strict backup parsing and a synthetic publication snapshot. Modified text and evidence remain rejected. Local runs without HASH_TEST_DATABASE_URL skip only this explicit database integration test; deterministic hash tests still run.

## Live acceptance (not supplied by automated tests)

After the reviewed code is deployed, read Wild Monarch's CURRENT stored draft without modifying it. Verify its stored digest is unchanged and the fixed draftHash now recomputes to that exact digest. If it does not, stop and preserve the original; do not force a rehash. Fetch fresh evidence bindings before the existing assessed_draft operation. The completed article and optional-angle assessment remain separate truthful editorial operations. Do not use resolve_gap to invent James's personal review, change publication or SEND controls, or spend a GO run solely to repair a digest.

This change is based on d0d22738b0eff651d98cb6f542a20c713c7d7efa and preserves the newer autonomous newsroom work. It introduces no production setting, model, quota, source-registry or database-schema change.
