# Thursday Post — Claude UI handoff

Improve presentation while preserving application contracts. Read [DESIGN_PRODUCT_BRIEF.md](DESIGN_PRODUCT_BRIEF.md). James's exact Claude template and approved artwork are missing; the current broadsheet layout and horse mark are **drafts**, not an exact reproduction.

**Brand:** Thursday Post. Motto: “collect, aggregate, distribute.” Thursday is one horse standing at one timber post, reins loosely tied, no person. Use an understated, familiar silhouette. Keep existing repository/Vercel identities and [hosted address](https://the-racing-desk.vercel.app). Reader email: workbenchadmin@gmail.com.

**Screens:** Subscription homepage `/`, broadsheet newspaper `/news`, story `/news/[id]`, editions `/editions` and `/editions/[id]`; signup/offer `/subscribe`, account/sign-in `/member`. Owner `/newsroom`, `/editorial/[id]`, `/operations`, `/login`. Preserve the incoming subscription landing design, corrections, Post Box and policy pages. The homepage must show real signup/sales readiness; never invent an active price or subscription promise.

**Built:** Next.js 16, React 19, TypeScript, custom CSS and Lucide. Six research disciplines feed a shared evidence hub and four PE desks. Public bylines are **By Agent 1–4**; PE labels stay internal. Internal tone: **A positive/constructive, B adverse/dubious, N neutral**. Never expose tone markers to readers. B stories require a right-of-reply outcome or rationale.

Owners collect without AI, review proposals, save human-attested narrative with claim references, resolve gaps, approve/reject/send back, correct/withdraw articles, assemble editions, release, then explicitly SEND. Member access, billing, delivery and operations tooling are implemented. Preserve honest loading, empty, locked, blocked and provider-unconfigured states.

**Stable backend contracts:**

- `/api/newsroom`: existing `collect`, `run`, `decision`, source and monitoring actions; approval requires `expectedDraftHash`.
- `/api/editorial`: `edit_draft`, `resolve_gap`, `right_of_reply`, `correction`, `publication_status`, `publication_access`. Preserve claim IDs, notes and explicit `humanReviewed: true` attestation.
- `/api/owner/editions` and `/[id]`: creation/editing and separate `release`, `send`, `process`. Preserve `expectedReviewHash` and recipient-count confirmation.
- `/api/public`, `/api/editions/[id]`: server-controlled member access. Never fetch private bodies to simulate a frontend paywall.
- `/api/member/**`, `/api/checkout`, `/api/billing/**`, `/api/owner/operations`, `/api/owner/backup`: retain request shapes, sessions and same-origin protections.

**Edit surface:** Components, page presentation, `globals.css`, `paper.css`, edition styles, metadata and brand assets. Keep `src/lib/**`, API routes, schemas, storage, dependencies, credentials and service configuration stable. Preserve demo/private boundaries and immutable approvals. Do not enable sales, providers, monitoring, publication or delivery during UI work.

**Verification:** 106 tests and TypeScript pass. Current production build, browser and deployment checks are pending. AI is paused; Stripe/Resend live connections are incomplete, sales closed, price unset. Fixture tests do not prove provider operation.

Finish with responsive/keyboard checks and `npm test`, `npm run typecheck`, `npm run build`; report actual results and remaining template differences.
