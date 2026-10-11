## Plan: birds.quest auto-blogging from GPS trips

The repo has only the spec, so this is a greenfield build. A Next.js (TypeScript, pnpm) app and a TS worker share one MariaDB server. The worker finds ended Traccar trips by reading `tc_positions` directly. It predicts species with the BirdNET GeoModel ONNX, enriches them from Wikipedia, and has Gemma write a location-free post. The owner curates posts in an admin UI. It deploys to Ubuntu 26.04 behind Caddy, with git push deploy.

**Phase 1 – Foundation**
1. Find and install the Next.js/React agent skill files first, as the spec requires. Then scaffold Next.js (App Router, TS strict, pnpm, ESLint, Vitest) at the repo root. Add `.env.example`, a validated config module (zod) and `.gitignore` (env files, model files).
2. Add the DB layer with Drizzle ORM on MariaDB, with migrations in a separate `birdsquest` database. Tables:
   - `trips`: Traccar device id, start/end time, centroid, status, source key (unique).
   - `predictions`: trip id, species code, scientific name, common name, probability.
   - `species_info`: Wikipedia cache of summary and image URL, attribution/license, fetched-at.
   - `posts`: slug, trip id, title, markdown, status (draft/published), generated-at, edited-at.
   - `post_species`: selected or deselected flag per post.
   - `jobs`: type, payload, status, attempts, run-after, error, locked-at.
   - `admin_sessions`.

   Use a separate read-only DB user for the Traccar database. *depends on 1*

**Phase 2 – Pipeline (worker, shared lib in `src/lib`, entry in `worker/`)** *depends on Phase 1*
3. Trip discovery reads `tc_positions` per device, ordered by `fixtime`. It splits trips on idle gaps or `attributes.motion` and uses a stop-gap threshold from config. A trip counts as ended only when its last position is older than that threshold, and trips under 10 minutes are ignored. Insert idempotently into `trips` and enqueue a `predict` job.
4. Add a DB-backed queue (`jobs`) that claims rows with `SELECT ... FOR UPDATE SKIP LOCKED`. It adds retries with backoff, handlers for `discover`, `predict` and `generate`, and a one-shot runner that exits when the queue is empty.
5. Prediction uses `onnxruntime-node` with `geomodel_fp16.onnx` and `labels.txt`, kept in a gitignored `models/` directory. A download script fetches them and keeps the Apache-2.0 licence file. Then:
   - Compute the week (1–48) from the trip's mid-time.
   - Sample points along the route, downsampled to about one every few hundred metres.
   - Run one batched `(N,3)` inference and aggregate per species (max or mean).
   - Apply a threshold (default 0.15) and top-K, then store in `predictions`.
6. Wikipedia enrichment calls `page/summary/{title}`, trying the scientific name first and the common name as fallback. It stores the extract, image URL and attribution, sets a User-Agent, and caches and rate-limits requests. *parallel with 5's tail*
7. LLM client is a single OpenAI-compatible client, switched by env: DigitalOcean `https://inference.do-ai.run/v1/chat/completions` with a model access key in production, and Ollama `gemma4:e2b` in dev. The prompt receives only species, Wikipedia facts and the season. It never receives coordinates or place names. Post-validate the output to strip any location words, and fall back to a template if the call fails. The `dots` TS client is optional; plain fetch is lighter.
8. Generation creates a draft `posts` row with markdown and images, and attribution lines for the Wikipedia images. Publishing is manual by default (decision below).

**Phase 3 – Web app** *depends on Phases 1–2; the public pages can run parallel with admin*
9. Public pages: blog index and post page (`/posts/[slug]`) rendered from markdown with sanitisation (rehype-sanitize), plus SEO metadata. No location data is ever exposed.
10. Admin auth for the single owner: a password hash in env (argon2), httpOnly/SameSite/secure session cookies, login rate limiting and CSRF protection on server actions. Add a security-headers middleware.
11. Admin UI: list trips and their status, and for each post a species checklist (select/deselect observed), a Regenerate button (enqueues `generate` with the selected species), and a side-by-side markdown editor with live preview. Add publish/unpublish and a "run queue now" action.

**Phase 4 – Deployment** *can start after Phase 1; parallel with 2–3*
12. `deploy/install.sh` (idempotent, for Ubuntu 26.04) does the following:
    - Install Traccar natively and MariaDB.
    - Create the DBs and users (Traccar read-write, app database, read-only grant for the app).
    - Set Traccar's `traccar.xml` to MariaDB.
    - Install Node and pnpm, plus Caddy from the Traccar docs' apt repo.
    - Create a `birdsquest` system user.
    - Set up UFW (22/80/443 only).
    - Download the model files.
13. Caddyfile has two sites: the app domain reverse-proxied to the Next.js port, and a Traccar domain reverse-proxied to `localhost:8082`. Traccar's open registration is disabled and the Traccar Client uses HTTPS only.
14. Systemd units: `birdsquest-web.service`, `birdsquest-worker.service` (oneshot) and `birdsquest-worker.timer` (hourly).
15. Git deploy: a bare repo plus a `post-receive` hook that checks out the working tree, runs `pnpm install --frozen-lockfile`, runs migrations, runs `pnpm build`, and restarts the web service.
16. Docs: update `README.md` with local dev setup (Ollama, MariaDB, model download) and the deploy steps.

**Relevant files** (all to be created)
- `package.json`, `next.config.ts`, `drizzle.config.ts`, `.env.example`
- `src/db/schema.ts` and `src/lib/{config,traccar,trips,geomodel,wikipedia,llm,queue,posts}.ts`
- `worker/run.ts` and `scripts/download-models.ts`
- `src/app/(public)/**`, `src/app/admin/**`, `src/middleware.ts`
- `deploy/{install.sh,Caddyfile,*.service,*.timer,post-receive}`
- `README.md` is existing and will be updated

**Verification**
1. Vitest unit tests:
   - Trip splitting on synthetic positions: 9 min is ignored, 11 min is accepted, and an ongoing trip is not processed.
   - Week calculation and aggregation.
   - A prompt test asserting no coordinate or place strings reach the LLM.
   - A markdown sanitisation test.
2. Local integration: seed fake `tc_positions`, run the worker once, and check that predictions, a draft post and the images appear. Run it against Ollama `gemma4:e2b`.
3. Run a sample prediction (for example, lat 52.5, lon 13.4, week 22) and confirm it matches the GeoModel docs (Eurasian Blackbird, Great Tit near the top).
4. Run `pnpm lint`, `pnpm typecheck` and `pnpm build`.
5. Manual checks: the admin flow (login, deselect species, regenerate, edit markdown, publish) and the public page showing no location data.
6. Deploy on a fresh Ubuntu VM: `install.sh`, a git push triggering restart, Caddy TLS, a Traccar Client test, and an hourly timer run.

**Decisions**
- Traccar trips are not stored by Traccar (they are computed reports), so the app derives them from positions. The "ended" rule is a configurable idle threshold, default 10 minutes.
- Excluded: multi-user accounts, a Traccar UI replacement (Traccar's own web interface serves as the GPS data manager), and any exact location display.
- Sampling along the whole route, not only the centroid, since the model is coarse.

**Further Considerations**
1. Publish flow: new posts as drafts needing owner approval, or auto-publish? Recommend draft first, since the species are only predicted, not confirmed.
2. The ONNX files must be fetched from the BirdNET geomodel repo releases (exact URL to confirm at implementation). Recommend a download script, not committing binaries.
3. Wikipedia image licences vary, so show attribution and skip images lacking licence info.
