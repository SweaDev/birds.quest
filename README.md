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

## Server deployment (Ubuntu 26.04)

One VPS runs everything: MariaDB, native Traccar, the Next.js app (`birdsquest-web.service`, port 3000), the hourly worker (`birdsquest-worker.timer`) and Caddy for HTTPS. Only ports 22, 80 and 443 are open (UFW). Traccar and the app listen on `127.0.0.1` only.

Files are in [deploy/](deploy/): `install.sh`, `Caddyfile`, the systemd units and the git `post-receive` hook.

### 1. DNS

Create two A/AAAA records pointing at the server: the blog domain (e.g. `birds.example.com`) and the Traccar domain (e.g. `gps.example.com`). Caddy needs them to get Let's Encrypt certificates.

### 2. Run the installer

Copy the repo to the server (e.g. `git clone` or `scp -r`) and, as root:

```sh
sudo APP_DOMAIN=birds.example.com TRACCAR_DOMAIN=gps.example.com \
     LETSENCRYPT_EMAIL=you@example.com ./deploy/install.sh
```

It is idempotent. It installs MariaDB, Traccar (configured for MariaDB), Node 22+, pnpm and Caddy; creates the `birdsquest` system user, the `traccar` and `birdsquest` databases and users (`traccar` RW, `birdsquest` RW, `birdsquest_ro` SELECT on the Traccar DB); installs the Caddyfile and systemd units; creates the bare repo `/srv/birdsquest/repo.git` with the deploy hook; and enables UFW. Optional variables: `DEPLOY_SSH_PUBKEY` (key allowed to push; defaults to root's `authorized_keys`), `SSH_PORT`, `TRACCAR_VERSION`.

Generated passwords are in `/etc/birdsquest/secrets.env` (root only). The app configuration is `/etc/birdsquest/birdsquest.env` (outside the repo, created once, never overwritten). Edit it and set `LLM_API_KEY`, `WIKIPEDIA_USER_AGENT` and `ADMIN_PASSWORD_HASH` (see step 4).

### 3. Traccar admin account and hardening

1. Open `https://<TRACCAR_DOMAIN>` and register your account. The first account becomes the administrator.
2. Re-run `./deploy/install.sh` (same variables). Once a user exists it sets `registration = 0` in Traccar and restarts it, so nobody else can sign up. If you re-run it before registering, it only reminds you.
3. In Traccar, add a device whose **identifier** is the one you will use in the client (unknown devices are rejected).

### 4. First deploy

From your development machine:

```sh
git remote add production birdsquest@<server>:/srv/birdsquest/repo.git
git push production main
```

The `post-receive` hook (only for `main`) checks out `/srv/birdsquest/app`, then runs `pnpm install --frozen-lockfile`, `pnpm models:download`, `pnpm db:migrate`, `pnpm build` and restarts `birdsquest-web.service`. Later pushes redeploy the same way.

Create the admin password hash on the server and put it in the env file, keeping the `\$` escapes and single quotes:

```sh
cd /srv/birdsquest/app && sudo -u birdsquest pnpm admin:hash
sudoedit /etc/birdsquest/birdsquest.env
sudo systemctl restart birdsquest-web
```

Then start the worker timer: `sudo systemctl enable --now birdsquest-worker.timer`. Run a pass by hand with `sudo systemctl start birdsquest-worker.service`.

### 5. Traccar Client setup

In the Traccar Client app set:

- **Device identifier**: the identifier you added in Traccar.
- **Server URL**: `https://<TRACCAR_DOMAIN>` (HTTPS, no port). Caddy forwards the client's OsmAnd requests to Traccar on `127.0.0.1:5055`.
- Frequency and location accuracy as you like, then start the service.

### Operations

```sh
journalctl -u birdsquest-web -f          # web logs
journalctl -u birdsquest-worker -e       # last worker pass
systemctl list-timers birdsquest-worker  # next run
journalctl -u traccar -e                 # Traccar logs
```

After changing anything in `deploy/` (units, Caddyfile), re-run `./deploy/install.sh`.
