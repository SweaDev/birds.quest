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
  - Note: MariaDB is NOT installed locally and Docker is broken (see Changelog). Provision it before T1.4/T1.6.
- [x] T0.2 Find and install agent skills for React and Next.js best practices (required by the spec). Also install skills for TypeScript, web security and Drizzle/MariaDB if available. Record the skill names here. (279d268)
  - Installed (project-level, `.agents/skills/`, tracked in `skills-lock.json`, via `npx skills add -a github-copilot`): `vercel-react-best-practices` (vercel-labs/agent-skills), `nextjs-app-router-patterns` (wshobson/agents), `typescript-advanced-types` (wshobson/agents), `security-best-practices` (openai/skills), `drizzle-orm-patterns` (giuseppe-trisciuoglio/developer-kit), `mysql` (planetscale/database-skills, covers MariaDB-compatible MySQL).
- [x] T0.3 Add `.gitignore` (node_modules, `.next`, `.env*` except `.env.example`, `models/*.onnx`, `models/labels.txt`, logs). (279d268)

## Phase 1: Foundation

- [x] T1.1 Scaffold Next.js (App Router, TypeScript strict, ESLint) with pnpm at the repo root. Keep `specs/`, `LICENSE` and `README.md`. (7414ddb)
- [x] T1.2 Add Vitest, and scripts `lint`, `typecheck`, `test`, `build`, `worker`, `db:generate`, `db:migrate`. (63a2671)
- [x] T1.3 Add a validated config module (zod) and `.env.example`: DB URLs (app RW, Traccar RO), LLM provider and key and model, admin password hash, session secret, idle threshold, minimum trip minutes, prediction threshold and top-K.
- [ ] T1.4 Add Drizzle ORM (MariaDB) and the schema: `trips`, `predictions`, `species_info`, `posts`, `post_species`, `jobs`, `admin_sessions`. Unique source key on `trips`. Generate the initial migration.
- [ ] T1.5 Add a read-only Traccar DB client (`tc_devices`, `tc_positions`) and a dev seed script that creates fake Traccar tables and positions for local testing.
- [ ] T1.6 Tests: config validation and DB connection smoke test.

## Phase 2: Pipeline

- [ ] T2.1 Trip discovery (`src/lib/trips.ts`, `traccar.ts`): split positions into trips by idle gap or motion, accept only ended trips (last position older than the idle threshold), ignore trips under 10 minutes, insert idempotently, enqueue a `predict` job.
- [ ] T2.2 Tests for trip splitting: 9 min ignored, 11 min accepted, ongoing trip not processed, re-run is idempotent.
- [ ] T2.3 DB-backed queue (`src/lib/queue.ts`): claim with `FOR UPDATE SKIP LOCKED`, retries with backoff, stale lock recovery, job types `discover`, `predict`, `generate`. Tests included.
- [ ] T2.4 Worker entry `worker/run.ts`: enqueue `discover`, then drain the queue once and exit with a clear log. Wire `pnpm worker`.
- [ ] T2.5 Model download script `scripts/download-models.ts`: fetch `geomodel_fp16.onnx`, `labels.txt` and the licence from the BirdNET geomodel release (confirm the URL). Verify size or checksum. Output goes to the gitignored `models/`.
- [ ] T2.6 GeoModel wrapper (`src/lib/geomodel.ts`) with `onnxruntime-node`: input `(N,3)` float32 `[lat, lon, week]` (input name `input`), parse `labels.txt` (code, scientific, common), batch inference.
- [ ] T2.7 Prediction job: compute week 1-48 from the trip mid-time, sample route points about every few hundred metres, aggregate per species, apply threshold and top-K, store in `predictions`, enqueue enrichment and generation. Tests include a sample check (lat 52.5, lon 13.4, week 22 gives Eurasian Blackbird and Great Tit near the top).
- [ ] T2.8 Wikipedia client (`src/lib/wikipedia.ts`): `page/summary/{title}`, scientific name first then common name, User-Agent header, caching in `species_info`, rate limiting, image attribution and licence, skip images without licence info. Tests with mocked fetch.
- [ ] T2.9 LLM client (`src/lib/llm.ts`): one OpenAI-compatible client with env switch. Dev: Ollama Gemma-4 E2B. Prod: DigitalOcean `https://inference.do-ai.run/v1/chat/completions` with a model access key. Timeouts and retries.
- [ ] T2.10 Post generation (`src/lib/posts.ts`): prompt with species, Wikipedia facts and season only, written as "what anyone might see on this route". Strip or reject location words, template fallback if the LLM fails, include image attribution, save as a draft with `post_species` rows. Tests: no coordinates or place strings reach the LLM.
- [ ] T2.11 End-to-end local run: seed fake trips, run the worker against Ollama, check predictions, species info and a draft post exist.

## Phase 3: Web app

- [ ] T3.1 Public blog: index and `/posts/[slug]` with markdown rendering and `rehype-sanitize`, SEO metadata, published posts only. Check that no location data is exposed.
- [ ] T3.2 Admin auth: single owner, argon2 password hash from env, httpOnly/SameSite/secure session cookie stored in `admin_sessions`, login rate limiting, CSRF protection for server actions, logout.
- [ ] T3.3 Security headers and middleware (CSP, HSTS, frame, referrer, content-type options). Protect `/admin/**`.
- [ ] T3.4 Admin: trips list with status, and post list with draft/published filter.
- [ ] T3.5 Admin post page: species checklist (select or deselect observed species), Regenerate button (enqueues `generate` with the selected species), publish and unpublish.
- [ ] T3.6 Admin side-by-side markdown editor with live sanitized preview and save.
- [ ] T3.7 "Run queue now" admin action, with a status display for recent jobs and errors.
- [ ] T3.8 Tests: auth, sanitisation, species selection and regenerate. Then `pnpm lint`, `pnpm typecheck` and `pnpm build` all pass.

## Phase 4: Deployment

- [ ] T4.1 `deploy/install.sh` (idempotent, Ubuntu 26.04, run as root): install MariaDB, native Traccar with MariaDB config, Node and pnpm, and Caddy (apt repo from the Traccar docs). Create the `birdsquest` user, DBs and DB users (Traccar RW, app RW, app read-only on the Traccar DB), UFW (22, 80, 443), and download models.
- [ ] T4.2 Traccar hardening: disable open registration, HTTPS only through Caddy, bind Traccar to localhost. Document the Traccar Client URL setup.
- [ ] T4.3 `deploy/Caddyfile`: app domain to the Next.js port, Traccar domain to `localhost:8082`, domains from env.
- [ ] T4.4 Systemd units: `birdsquest-web.service`, `birdsquest-worker.service` (oneshot), `birdsquest-worker.timer` (hourly), hardened options and an env file outside the repo.
- [ ] T4.5 Git deploy: bare repo setup in the install script and a `post-receive` hook that checks out the tree, runs `pnpm install --frozen-lockfile`, migrations and `pnpm build`, then restarts the web service.
- [ ] T4.6 Shell lint of the scripts (`shellcheck`) and a dry-run review. If a test VM or container is available, do a trial run.

## Phase 5: Docs and final checks

- [ ] T5.1 Update `README.md`: architecture, local dev (MariaDB, Ollama, model download, seed), env vars, deploy steps, privacy rule about location data.
- [ ] T5.2 Final verification: all tests, lint, typecheck and build pass, the manual admin flow works, and no location data appears in public pages or LLM prompts. Review open items below.

## Open questions

- Publish flow: draft needing owner approval (default) or auto-publish? Default is draft.
- Exact download URL for the ONNX model and labels: confirm during T2.5.
- Exact Gemma-4 model IDs on DigitalOcean and in Ollama: confirm during T2.9.

## Changelog

- 2026-10-12: Initial task list created from PLAN-01.
- 2026-10-12 (T0.1): Environment check. Node v22.14.0, pnpm 12.6.0, npm 11.15.0, Ollama 0.34.0 reachable at `localhost:11434` with Gemma-4 E2B as `gemma4:e2b` (use this exact tag; `gemma4:e4b` and `gemma4:12b` also present). Git tree was clean. MariaDB is not installed (no `mariadb`/`mysql` binaries, no service on 3306; apt candidate `mariadb-server 1:11.8.6`). Docker is present and `mariadb:11.8` was pulled, but containers fail to start (containerd shim/API mismatch, needs a daemon restart). Action: install `mariadb-server` via apt or restart Docker before T1.4/T1.6.
