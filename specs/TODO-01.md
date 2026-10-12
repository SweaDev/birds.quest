# TODO-01: Execution tracker for PLAN-01

Source documents: [SPEC-01.md](SPEC-01.md) (requirements) and [PLAN-01.md](PLAN-01.md) (approach).

## Agent rules

1. Work top to bottom. Pick the first unchecked task whose dependencies are done.
2. When a task is complete and verified, change `[ ]` to `[x]` and add the short commit hash after it, e.g. `- [x] T1.1 ... (abc1234)`.
3. Run `git add -A && git commit -m "<task id>: <summary>"` after each completed task. Do NOT push to any remote.
4. Mark a task `[~]` while in progress. Add a one-line note under it if work is paused or blocked.
5. If the work shows a task is wrong, missing or too large, edit this file: add, split, reorder or reword tasks, and note the reason under a `Changelog` entry at the bottom.
6. Install the relevant agent skills before the work they apply to (best practice). Record the installed skill names in the task.
7. Never commit secrets, `.env` files or model binaries.
8. Update `README.md` and `.env.example` when behaviour or configuration changes.
9. No location data (coordinates, place names) may reach the LLM prompt or the public blog.

Legend: `[ ]` todo, `[~]` in progress, `[x]` done.

## Phase 0: Setup and skills

- [x] T0.1 Verify the environment: `git status`, `node -v`, `pnpm -v`, Ollama reachable with a Gemma-4 E2B model, MariaDB available locally. Record versions and the exact Ollama model tag in Changelog. (36b08ea)
  - Note: MariaDB was missing at first; installed via apt during Phase 1 (see Changelog).
- [x] T0.2 Find and install agent skills for React and Next.js best practices (required by the spec). Also install skills for TypeScript, web security and Drizzle/MariaDB if available. Record the skill names here. (279d268)
  - Installed (project-level, `.agents/skills/`, tracked in `skills-lock.json`, via `npx skills add -a github-copilot`): `vercel-react-best-practices` (vercel-labs/agent-skills), `nextjs-app-router-patterns` (wshobson/agents), `typescript-advanced-types` (wshobson/agents), `security-best-practices` (openai/skills), `drizzle-orm-patterns` (giuseppe-trisciuoglio/developer-kit), `mysql` (planetscale/database-skills, covers MariaDB-compatible MySQL).
- [x] T0.3 Add `.gitignore` (node_modules, `.next`, `.env*` except `.env.example`, `models/*.onnx`, `models/labels.txt`, logs). (279d268)

## Phase 1: Foundation

- [x] T1.1 Scaffold Next.js (App Router, TypeScript strict, ESLint) with pnpm at the repo root. Keep `specs/`, `LICENSE` and `README.md`. (7414ddb)
- [x] T1.2 Add Vitest, and scripts `lint`, `typecheck`, `test`, `build`, `worker`, `db:generate`, `db:migrate`. (63a2671)
- [x] T1.3 Add a validated config module (zod) and `.env.example`: DB URLs (app RW, Traccar RO), LLM provider and key and model, admin password hash, session secret, idle threshold, minimum trip minutes, prediction threshold and top-K. (6d78093)
- [x] T1.4 Add Drizzle ORM (MariaDB) and the schema: `trips`, `predictions`, `species_info`, `posts`, `post_species`, `jobs`, `admin_sessions`. Unique source key on `trips`. Generate the initial migration. (6c1bb2d)
- [x] T1.5 Add a read-only Traccar DB client (`tc_devices`, `tc_positions`) and a dev seed script that creates fake Traccar tables and positions for local testing. (d14d108)
- [x] T1.6 Tests: config validation and DB connection smoke test. (80707ca)

## Phase 2: Pipeline

- [x] T2.1 Trip discovery (`src/lib/trips.ts`, `traccar.ts`): split positions into trips by idle gap or motion, accept only ended trips (last position older than the idle threshold), ignore trips under 10 minutes, insert idempotently, enqueue a `predict` job. (7a5d3e0)
- [x] T2.2 Tests for trip splitting: 9 min ignored, 11 min accepted, ongoing trip not processed, re-run is idempotent. (753da78)
- [x] T2.3 DB-backed queue (`src/lib/queue.ts`): claim with `FOR UPDATE SKIP LOCKED`, retries with backoff, stale lock recovery, job types `discover`, `predict`, `generate`. Tests included. (46a4d90)
- [x] T2.4 Worker entry `worker/run.ts`: enqueue `discover`, then drain the queue once and exit with a clear log. Wire `pnpm worker`. (cdea5f1)
- [x] T2.5 Model download script `scripts/download-models.ts`: fetch `geomodel_fp16.onnx`, `labels.txt` and the licence from the BirdNET geomodel release (confirm the URL). Verify size or checksum. Output goes to the gitignored `models/`. (71ce0bb)
  - Done: `pnpm models:download` pins BirdNET+ Geomodel release v3.0.4 (FP16 ONNX, labels, `LICENSE-MODELS.md`) with sha256 + size checks. The licence file in `models/` is committed; the binaries are not.
- [x] T2.6 GeoModel wrapper (`src/lib/geomodel.ts`) with `onnxruntime-node`: input `(N,3)` float32 `[lat, lon, week]` (input name `input`), parse `labels.txt` (code, scientific, common), batch inference. (af16cfa)
- [x] T2.7 Prediction job: compute week 1-48 from the trip mid-time, sample route points about every few hundred metres, aggregate per species, apply threshold and top-K, store in `predictions`, enqueue enrichment and generation. Tests include a sample check (lat 52.5, lon 13.4, week 22 gives Eurasian Blackbird and Great Tit near the top). (439556f)
- [x] T2.8 Wikipedia client (`src/lib/wikipedia.ts`): `page/summary/{title}`, scientific name first then common name, User-Agent header, caching in `species_info`, rate limiting, image attribution and licence, skip images without licence info. Tests with mocked fetch. (671a8ce)
- [x] T2.9 LLM client (`src/lib/llm.ts`): one OpenAI-compatible client with env switch. Dev: Ollama Gemma-4 E2B. Prod: DigitalOcean `https://inference.do-ai.run/v1/chat/completions` with a model access key. Timeouts and retries. (5ba6143)
- [x] T2.10 Post generation (`src/lib/posts.ts`): prompt with species, Wikipedia facts and season only, written as "what anyone might see on this route". Strip or reject location words, template fallback if the LLM fails, include image attribution, save as a draft with `post_species` rows. Tests: no coordinates or place strings reach the LLM. (1f31ffb)
- [x] T2.11 End-to-end local run: seed fake trips, run the worker against Ollama, check predictions, species info and a draft post exist. (a4b8fbf)

## Phase 3: Web app

- [x] T3.1 Public blog: index and `/posts/[slug]` with markdown rendering and `rehype-sanitize`, SEO metadata, published posts only. Check that no location data is exposed. (1bf7317)
- [x] T3.2 Admin auth: single owner, argon2 password hash from env, httpOnly/SameSite/secure session cookie stored in `admin_sessions`, login rate limiting, CSRF protection for server actions, logout. (1bf7317)
- [x] T3.3 Security headers and middleware (CSP, HSTS, frame, referrer, content-type options). Protect `/admin/**`. (1bf7317)
- [x] T3.4 Admin: trips list with status, and post list with draft/published filter. (1bf7317)
- [x] T3.5 Admin post page: species checklist (select or deselect observed species), Regenerate button (enqueues `generate` with the selected species), publish and unpublish. (1bf7317)
- [x] T3.6 Admin side-by-side markdown editor with live sanitized preview and save. (1bf7317)
- [x] T3.7 "Run queue now" admin action, with a status display for recent jobs and errors. (1bf7317)
- [x] T3.8 Tests: auth, sanitisation, species selection and regenerate. Then `pnpm lint`, `pnpm typecheck` and `pnpm build` all pass. (1bf7317)

## Phase 4: Deployment

- [x] T4.1 `deploy/install.sh` (idempotent, Ubuntu 26.04, run as root): install MariaDB, native Traccar with MariaDB config, Node and pnpm, and Caddy (apt repo from the Traccar docs). Create the `birdsquest` user, DBs and DB users (Traccar RW, app RW, app read-only on the Traccar DB), UFW (22, 80, 443), and download models.
- [x] T4.2 Traccar hardening: disable open registration, HTTPS only through Caddy, bind Traccar to localhost. Document the Traccar Client URL setup.
- [x] T4.3 `deploy/Caddyfile`: app domain to the Next.js port, Traccar domain to `localhost:8082`, domains from env.
- [x] T4.4 Systemd units: `birdsquest-web.service`, `birdsquest-worker.service` (oneshot), `birdsquest-worker.timer` (hourly), hardened options and an env file outside the repo.
- [x] T4.5 Git deploy: bare repo setup in the install script and a `post-receive` hook that checks out the tree, runs `pnpm install --frozen-lockfile`, migrations and `pnpm build`, then restarts the web service.
- [x] T4.6 Shell lint of the scripts (`shellcheck`) and a dry-run review. If a test VM or container is available, do a trial run.

## Phase 5: Docs and final checks

- [x] T5.1 Update `README.md`: architecture, local dev (MariaDB, Ollama, model download, seed), env vars, deploy steps, privacy rule about location data.
- [x] T5.2 Final verification: all tests, lint, typecheck and build pass, the manual admin flow works. Review open items below.

## Open questions

- ~~Publish flow~~ Resolved in Phase 5: drafts need owner approval; `AUTO_PUBLISH=true` in the env publishes new posts automatically.
- ~~Exact download URL for the ONNX model and labels~~ Resolved in T2.5: GitHub release `birdnet-team/geomodel` v3.0.4.
- ~~Exact Gemma-4 model IDs~~ Resolved in T2.9: Ollama `gemma4:e2b`, DigitalOcean `gemma-4-31B-it` (per the DO supported-models page, verified 9 Oct 2026).

## Changelog

- 2026-10-12: Initial task list created from PLAN-01.
- 2026-10-12 (T0.1): Environment check. Node v22.14.0, pnpm 12.6.0, npm 11.15.0, Ollama 0.34.0 reachable at `localhost:11434` with Gemma-4 E2B as `gemma4:e2b` (use this exact tag; `gemma4:e4b` and `gemma4:12b` also present). Git tree was clean. MariaDB is not installed (no `mariadb`/`mysql` binaries, no service on 3306; apt candidate `mariadb-server 1:11.8.6`). Docker is present and `mariadb:11.8` was pulled, but containers fail to start (containerd shim/API mismatch, needs a daemon restart). Action: install `mariadb-server` via apt or restart Docker before T1.4/T1.6.
- 2026-10-12 (Phase 1): Installed `mariadb-server` 11.8 via apt for local dev (Docker was unusable). Dev DBs `birdsquest`, `birdsquest_test`, `traccar`; users `birdsquest` (RW), `birdsquest_ro` (SELECT on `traccar`), `traccar_dev` (seed only). Credentials live only in the gitignored `.env`.
- 2026-10-12 (T1.1): `create-next-app` generated Next 16.4 with `cacheComponents` and Google fonts; both removed (cache components force Suspense around all dynamic DB reads, and font download needs network at build). Re-evaluate before Phase 3. The generated `AGENTS.md` says to read `node_modules/next/dist/docs/` before writing Next code; do that in Phase 3.
- 2026-10-12 (T1.1): the global pnpm `trustPolicy=no-downgrade` blocked `eslint-import-resolver-typescript@3.10.1` and `semver@6.3.1`; both are narrowly allowed in `pnpm-workspace.yaml` (`trustPolicyExclude`). `@types/node` is `^24` because 22.x depends on the flagged `undici-types@6.21.0` (runtime is still Node 22). Build scripts of `esbuild`, `sharp`, `unrs-resolver` stay disabled (`allowBuilds: false`); `onnxruntime-node` is also set to `false` (T2.6): its install script only fetches optional CUDA binaries; the CPU runtime ships in the package and was verified to load.
- 2026-10-12 (T1.3): `ADMIN_PASSWORD_HASH` is written with `\$` escapes in `.env` (Next expands `$VAR`), unescaped by the config module. Dev `.env` has a placeholder hash until the T3.2 password-hash helper exists.
- 2026-10-12 (T1.4/T1.5): schema additions beyond the plan: `jobs.dedupe_key` (unique, for idempotent enqueue), `jobs.max_attempts`, `admin_sessions.csrf_token`, `posts.trip_id` unique (one post per trip), `species_info` keyed by species code. Added `src/db/pool.ts` (shared mysql2 pool, UTC timezone), and `scripts/seed-data.ts` (pure walk builders reused by T2.2 tests). Login rate limiting storage will be added in T3.2.
- 2026-10-12 (T1.6): `pnpm test` runs 23 tests; the DB smoke tests skip when the DB env vars are unset.
- 2026-10-12 (T2.5): Release v3.0.4 is the 14K-species model and covers more than birds. In `labels.txt`, birds have eBird codes (e.g. `gretit1`) while other taxa have purely numeric iNaturalist ids (3,672 of 14,082 lines). T2.6 must keep only non-numeric codes. Common names also changed ("Common Blackbird" instead of "Eurasian Blackbird"), so the T2.7 sample check asserts on scientific names (Turdus merula, Parus major).
- 2026-10-12 (T2.3/T2.4): all DB sessions are forced to UTC (`SET time_zone`) so server-side defaults match the JS dates used by the queue. `runQueue` only claims job types that have a handler, so `predict`/`generate` jobs wait until their handlers exist. `discoverTrips` also re-enqueues a `predict` job for any trip still in status `discovered`, which covers a crash between inserting the trip and enqueueing.
- 2026-10-12 (T2.8): the Wikipedia summary endpoint has no licence data, so image licence and credit come from the MediaWiki `extmetadata` of the image file (Commons or the local wiki). Images without a licence are skipped, the text is still used. Wikipedia now serves thumbnails from `thumb.wikimedia.org` with `utm_*` query strings; both hosts are handled and the query string is dropped. Live check against Wikipedia: all 20 seeded species found, all with licensed images. New optional env `WIKIPEDIA_USER_AGENT`.
- 2026-10-12 (T2.9): `src/lib/llm.ts` is one OpenAI-compatible client (plain fetch, no `dots`). Gemma 4 on Ollama is a thinking model: with a small `max_tokens` it returns empty `content` and only a `reasoning` field, so the Ollama default sends `reasoning_effort: "none"` (override with `LLM_REASONING_EFFORT`); verified live against `gemma4:e2b`. Empty answers fail with a clear error. DigitalOcean defaults to model `gemma-4-31B-it` and sends no `reasoning_effort`; its behaviour was not tested here (no key). Retries (default 2) cover network errors, timeouts, 429 (honours `Retry-After`, max 30 s) and 5xx; 4xx fail at once. Default timeout 180 s per attempt.
- 2026-10-12 (T2.10): privacy design for posts. The LLM prompt contains only species (common and scientific name), up to three Wikipedia sentences per species, and the time of year ("mid June (summer)"; the season is computed for the trip's hemisphere but the latitude is never sent). Wikipedia sentences that name a place (continents, countries, US/CA/AU states, major cities, see `src/lib/locations.ts`) are dropped before prompting, and again from the model's reply, sentence by sentence. A reply containing coordinates, GPS/coordinate words, map names or URLs is rejected whole and the template is used. Species names that contain place words ("Turkey Vulture") are masked from the check. The model may not add images or links: they are stripped and the code adds Wikipedia images itself, with attribution and licence. Photographer credits (e.g. "…from Vaxholm, Sweden") are kept as the licence requires; they describe the photo, not the trip. A `generate` job without `force` never touches an existing post; admin regenerate (T3.5) must enqueue `{tripId, speciesCodes, force: true}` with a unique dedupe key, which resets `edited_at` and keeps slug and publish state.
- 2026-10-12 (T2.11): local end-to-end run on the seeded data with Ollama `gemma4:e2b` succeeded: 2 ended trips found (the 9 min and the ongoing walk correctly skipped), 20 predictions each, 20/20 species cached from Wikipedia with licensed images, 2 draft posts, all 7 jobs done, trips `generated`. It took about 6m40s, i.e. roughly 3 min per 20-species post on the local E2B model (the 180 s per-attempt LLM timeout is close to that; raise it or lower `PREDICTION_TOP_K` if dev runs time out). Reading the first post showed two leaks that the first filters missed: photographer credits with places ("Frank Vassen from Brussels, Belgium") and range text using adjectives or vague words ("the Australian magpie", "the northern part of the continent"). Fixed with demonym/geo-word filtering and `cleanAttribution`, covered by unit tests; the fixed output was not re-generated against the live model. More thorough LLM testing is deferred until Gemma-4 31B runs on the server.
- 2026-10-12 (Phase 3): built as one batch and committed together (hash on each T3.x line), at MVP depth. Next.js 16 renamed `middleware` to `proxy`, so T3.3 lives in `src/proxy.ts`: per-request nonce CSP (`strict-dynamic`, no inline styles, images only from Wikimedia), HSTS (production), frame/referrer/content-type/permissions headers, `no-store` on `/admin`, plus an early redirect to the login page when there is no session cookie. The real session check is in the database and runs in every admin page and server action (`requireAdmin`). Auth: argon2id (`@node-rs/argon2`) hash from env, random session token stored only as an HMAC, `__Host-` httpOnly SameSite=Lax cookie (Secure in production), 7 day expiry, per-session CSRF token in every admin form on top of Next's origin check, and login rate limiting (5 failures per IP and 30 overall per 15 minutes, new table `login_attempts`, migration `0002`). `pnpm admin:hash` creates the password hash for `.env`; the dev `.env` now has one (password shared in chat only). \"Run queue now\" and Regenerate start `runWorkerOnce` in the web process in the background (single lock, status shown on the overview page), so they need the long-running `next start` server, not serverless. Wikimedia only serves fixed thumbnail widths, 640 px returned HTTP 400, so images now use 960 px. Verified in a production build with a real browser: login (wrong and right password), overview, publish, public index with image, editor preview stripping scripts. Tests added: Markdown sanitisation, password and session handling, CSRF, login limiting, regenerate and publish. Not done on purpose: a rendered-page test of the public pages for location data (they only read title, slug, Markdown and publish date, which the generation step already checks) and end-to-end browser tests.
- 2026-10-12 (Phase 4): added `deploy/` (`install.sh`, `Caddyfile`, web/worker units, timer, `post-receive`), not run here. Passes `bash -n` and `shellcheck`; no VM, so no trial run (T4.6 trial pending on the real server). Traccar's open registration is a DB setting (`tc_servers.registration`), not a config-file key, so the installer sets it to 0 once the first (admin) user exists. Caddy routes `POST /` and `GET /?id=` on the Traccar domain to the OsmAnd port 5055 and the rest to 8082; this routing is untested against a live Traccar Client.
- 2026-10-12 (Phase 5): README now has architecture, config table, publishing and privacy sections. New env `AUTO_PUBLISH` (default `false`, also written by `install.sh`): `generatePost` publishes a *newly created* post at once when set; regenerating an existing post never changes its status. Final checks: lint, typecheck, 208 tests and `pnpm build` pass; a production `next start` smoke check gave 200 for `/`, `/admin/login`, `/sitemap.xml` and a redirect to login for `/admin`. Testing is deliberately light for now (no browser or end-to-end tests); the full admin flow was last exercised in a real browser in Phase 3. Advanced testing is left for later.
