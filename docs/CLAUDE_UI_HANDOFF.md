# Thursday Post — Claude UI handoff

**Task:** Improve the existing UI only. Preserve the working application and its behaviour.

**Correct branding:** **Thursday Post**. Logo: **one horse named Thursday, standing at one timber post, reins loosely tied; no person**. Understated silhouette, roughly half the horse suggested rather than detailed. Content, familiar and dependable; not tired or a flashy racing mascot. James previously approved a visual, but its artwork was not retrievable: use his approved reference when available. “The Racing Desk” and the “R” mark are incorrect placeholders. Correct the masthead, newsroom, login, footer, metadata and icons. Motto: **“collect, aggregate, distribute.”**

**Project:** `C:\Users\James Coleman\Documents\ChatGPT\Newspaper`  
**Current deployment:** https://the-racing-desk.vercel.app — retain this infrastructure/project identity during UI work.  
**Reader contact:** workbenchadmin@gmail.com; infrastructure account emails remain separate.

**Built:** A Next.js 16 / React 19 / TypeScript application with custom CSS and Lucide icons. Vercel hosting, Sydney Neon Postgres, local SQLite, protected owner login and persistent audit/evidence records are working.

GO → source discovery/selection → six research disciplines → shared evidence hub → targeted gap resolution → four editorial desks → compliance → **James: Approve / Reject / Send Back** → publication.

Research roles: Open Source Monitoring; Official Records & Data; Expert Sources & Analysis; Social Media & Eyewitnesses; Imagery & Media Verification; Geopolitical & Regional Focus. Editorial desks: Politics & Governance; Society & People; Business & Technology; Global Affairs. Current bylines use Agent 1–4; James’s intended display is **“By Agent One”**, etc. PE stays internal. Form/wagering analysis is separate and currently restricted.

**Existing screens:** `/` has Overview, Stories, Evidence hub, Reader inbox, Agents and Settings. Story review exposes draft, sentence-to-source tracing, gaps, research history and approval controls. `/login` protects ownership; `/news` and `/news/[id]` show approved public articles. Source registration, monitoring controls and private `.eml` import exist.

**Actual status:** 47 tests passed; production build and hosted demo passed. One demo draft awaits approval; zero public articles. Live AI and monitoring are paused by James. Gateway requires account verification. Automatic Gmail forwarding is unconnected; `.eml` import works. Licensed form feeds, media forensics, subscription billing and newsletter sending are not implemented. Live editorial output is conservative attributed source briefings, not unrestricted investigative prose.

**Edit surface:** `src/components/{newsroom,public-edition}.tsx`, `src/app/globals.css`, login/page presentation, layout metadata and new brand assets. Keep `src/lib/**`, API routes, schemas, storage, secrets, service configuration and dependencies stable. Preserve event handlers, API payloads, `expectedDraftHash`, authentication, evidence links, honest blocked states and demo/public separation. Never publish or enable services during UI work.

**Finish:** Check responsive layouts, keyboard access, empty/loading/error states and every existing action. Run `npm test`, `npm run typecheck`, `npm run build`; report changed files and checks. Keep the handoff concise.
