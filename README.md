# birds.quest

Auto-blogging from bird watching sessions. GPS tracks recorded with the Traccar Client are turned into a blog post about the birds anyone might see on that route. See [specs/](specs/) for the spec, plan and task list.

> **Privacy rule:** no location data (coordinates, place names) may reach the LLM prompt or the public blog.

## Local development

Requirements: Node 22+, pnpm, MariaDB, and Ollama with `gemma4:e2b`.

```sh
pnpm install
cp .env.example .env        # then fill it in, see the comments inside
```

Create the databases and users (once, as the MariaDB admin):

```sql
CREATE DATABASE birdsquest CHARACTER SET utf8mb4;
CREATE DATABASE birdsquest_test CHARACTER SET utf8mb4;
CREATE DATABASE traccar CHARACTER SET utf8mb4;
CREATE USER 'birdsquest'@'127.0.0.1' IDENTIFIED BY '...';      -- app, read/write
CREATE USER 'birdsquest_ro'@'127.0.0.1' IDENTIFIED BY '...';   -- Traccar DB, read-only
CREATE USER 'traccar_dev'@'127.0.0.1' IDENTIFIED BY '...';     -- dev only, creates fake Traccar tables
GRANT ALL ON birdsquest.* TO 'birdsquest'@'127.0.0.1';
GRANT ALL ON birdsquest_test.* TO 'birdsquest'@'127.0.0.1';
GRANT ALL ON traccar.* TO 'traccar_dev'@'127.0.0.1';
GRANT SELECT ON traccar.* TO 'birdsquest_ro'@'127.0.0.1';
```

Then:

```sh
pnpm models:download   # BirdNET geomodel (ONNX, labels, licence) into models/, checksum verified
pnpm db:migrate   # apply migrations to DATABASE_URL
pnpm db:seed      # fake Traccar tables and walks (needs TRACCAR_ADMIN_DATABASE_URL)
pnpm dev
```

| Script | Purpose |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Checks |
| `pnpm db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed fake Traccar data (dev only) |
| `pnpm admin:hash` | Create `ADMIN_PASSWORD_HASH` for `.env` (prompts for the password) |
| `pnpm models:download` | Download the BirdNET geomodel files into `models/` |
| `pnpm worker` | Run one worker pass: discover trips, then drain the job queue and exit |

## Web app

- `/` and `/posts/[slug]`: public blog, published posts only, Markdown sanitised with `rehype-sanitize`. No trip data or coordinates are ever read by the public pages.
- `/admin`: owner area (single password, set `ADMIN_PASSWORD_HASH` with `pnpm admin:hash`). Overview with trips, jobs and "Run queue now"; posts with draft/published filter; per post: tick the species you really saw and regenerate, edit Markdown side by side with a live preview, publish or unpublish.
- Security: nonce-based CSP and other headers in `src/proxy.ts`, argon2id password, httpOnly session cookie stored hashed in the database, CSRF token on every admin form, login rate limiting.
- Set `SITE_URL` to the public address (canonical links, sitemap).

## Pipeline

`pnpm worker` runs one pass and exits: it enqueues a `discover` job, then drains the job queue.

1. `discover` finds ended trips in Traccar's positions (a gap or standstill of `IDLE_THRESHOLD_MINUTES` ends a trip; trips shorter than `MIN_TRIP_MINUTES` are ignored).
2. `predict` samples the route (about every 300 m), runs the GeoModel for the trip's mid-time week, and keeps birds above `PREDICTION_THRESHOLD` (top `PREDICTION_TOP_K`).
3. `enrich` caches Wikipedia text and licensed images per species.
4. `generate` asks the LLM for a post from species, Wikipedia facts and the time of year only (no coordinates or place names), checks the reply for location words, and saves a draft. If the LLM fails, a template post is used.

Tests that need MariaDB use the `<database>_test` database (or `TEST_DATABASE_URL`) and truncate its tables.

The database smoke test (`src/db/db.smoke.test.ts`) runs only when `DATABASE_URL` and `TRACCAR_DATABASE_URL` are set.

`ADMIN_PASSWORD_HASH` must have every `$` escaped as `\$` in `.env`.
