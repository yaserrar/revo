# Deploying Revo next to other apps (EC2, GitHub Actions)

This is how Revo runs at `revo.asrar.software`: on an EC2 server that already runs a shared infra
stack (Traefik behind Cloudflare, one Postgres, pgAdmin, Dozzle), deployed by GitHub Actions. To run
Revo alone on a fresh server instead, follow [DEPLOY.md](../../DEPLOY.md) (its own Traefik, Postgres
and Redis, built on the server).

Every push to `main` runs [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml):

1. **Check:** types, lint, formatting and tests ([`ci.yml`](../../.github/workflows/ci.yml), which
   also runs on every pull request).
2. **Build:** the `web`, `worker` and `migrate` images, pushed to `ghcr.io/<owner>/revo-*`, tagged
   with the commit SHA and `latest`.
3. **Deploy:** copies [`docker-compose.yml`](./docker-compose.yml) to `~/revo` on the server, sets
   `IMAGE_TAG` to the new SHA, pulls, restarts, and waits until `web` and `worker` are healthy.

```
 revo.asrar.software ─▶ Cloudflare ─▶ Traefik :443 ─▶ web (Next :3000) ──┐   proxy network
                        (proxied)     (infra stack)                      │
 GitHub webhooks ──────────────────────────────────▶ /api/github/webhook │
                                                                         ▼
                                     worker ◀── redis (BullMQ) ◀──── web     backend network
                                        │                                │
                                        └────────── postgres ◀───────────┘   data network (infra)
                                        └──▶ GitHub API, Claude API
```

`migrate` runs `prisma migrate deploy` once per deploy; `web` and `worker` start only after it
succeeds. Only the infra stack's Traefik publishes ports.

Everything below is one-time setup.

## 1. Server

The infra stack must be running (it creates the `proxy` and `data` networks, the `postgres`
container, the `websecure` entrypoint, the `letsencryptresolver` and the `secure-headers@docker`
middleware). Revo adds about 450 MB of memory (web, worker, Redis); images are built on GitHub, not
on the server. Check with `free -m`; on a `t3.small` add 2 GB of swap if less than about 700 MB is
free:

```sh
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. DNS (Cloudflare)

Add an **A** record `revo` → the server's Elastic IP, **Proxied**. SSL/TLS mode stays **Full
(strict)**: Traefik gets a Let's Encrypt certificate through the Cloudflare DNS challenge.

## 3. Database

The infra's init script only runs on an empty volume, so create Revo's role and database by hand,
with the password you put in `REVO_DB_PASSWORD` (step 5):

```sh
docker exec -it postgres psql -U postgres \
  -c "CREATE ROLE revo LOGIN PASSWORD '<REVO_DB_PASSWORD>';" \
  -c "CREATE DATABASE revo OWNER revo;" \
  -c "REVOKE CONNECT ON DATABASE revo FROM PUBLIC;"
```

The infra's nightly backup dumps every database, `revo` included.

## 4. GitHub App

On your laptop, in a checkout of this repo (`npx -y pnpm@10.34.9 install` done):

```sh
npx -y pnpm@10.34.9 github:app --url https://revo.asrar.software --name "Revo by Asrar" --out .env.github-app.prod
```

Open `http://localhost:3832`, click the button, confirm on GitHub. The six `GITHUB_*` values are
printed and saved in `.env.github-app.prod`. The App is private: only your account can install it.
Don't install it yet (step 7).

## 5. App folder and `.env`

```sh
mkdir -p ~/revo
```

Copy [`.env.example`](./.env.example), filled in, to `~/revo/.env` (for example with
`scp .env.prod <user>@<host>:~/revo/.env`), then `chmod 600 ~/revo/.env`. Compose reads it to fill in
the compose file and passes it to `web` and `worker`. `docker-compose.yml` arrives with the first
deploy.

Use production-only values: new `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY`
(`openssl rand -base64 32`), and a separate `ANTHROPIC_API_KEY` with a monthly spend limit set in
console.anthropic.com.

`TOKEN_ENCRYPTION_KEY` must be the same for `web` and `worker` (both read it from this `.env`):
the web app encrypts the accounts' own Anthropic keys with it, and the worker decrypts them to run
their reviews. Changing it later makes every saved key unreadable (those accounts must save their
key again). Without it, both derive the key from `AUTH_SECRET`, so the worker gets that too; it
never gets `GITHUB_CLIENT_SECRET`.

### AI access and the free tier

Each GitHub account (user or organisation that installed the App) chooses who pays for Claude:

- **Free tier** (default): your `ANTHROPIC_API_KEY`, limited to `FREE_REVIEWS_PER_MONTH` reviews
  per account per calendar month (UTC, default 20; a "Review again" counts) and to Haiku and Sonnet
  (a repo set to Opus runs on Sonnet, and the comment says so). `FREE_MONTHLY_CAP_USD` (default 50)
  caps your total free-tier spend per month across every account: once reached, free accounts get a
  neutral "paused until next month" check.
- **Own key**: the account saves its Anthropic API key in Revo (**Repos → AI access**, stored
  encrypted). The web app checks it once with Anthropic (`models.list`, no tokens spent) before
  saving, so the web container needs outbound HTTPS to `api.anthropic.com`. Every model, no Revo
  limits; each repo's own monthly budget still applies. Only a user with the **Admin** role on at
  least one of the account's repos can add, replace or remove the key, or change who pays; the key
  is never shown again, only its last 4 characters.
- **Owner accounts**: `REVO_OWNER_ACCOUNTS=yourlogin,your-org` use your key with no free-tier
  limits (your own repos).
- **Claude subscription**: only with `REVO_ALLOW_CLAUDE_SUBSCRIPTION=1` on a self-hosted, single
  owner machine logged in to Claude Code. Leave it empty on this server. The worker then runs
  Claude Code through the Agent SDK, which is not in the Docker image: run the worker from source
  on that machine (`pnpm dev`, or `pnpm --filter @revo/worker build && … start`). Try the login first
  with `pnpm review:local --diff change.patch --engine claude-subscription`.

Set `CONTACT_EMAIL` in `.env` to show a contact address on `/privacy` and `/terms` (both public,
last updated 2026-11-22). Empty, they point to the GitHub issues of the source repository. Read
both pages once and adjust them if your hosting or analytics differ (they name AWS and PostHog).

### Let other people install the App

A new GitHub App can only be installed on the account that owns it. To offer Revo to everyone:
GitHub → **Settings** → **Developer settings** → **GitHub Apps** → the App → **Advanced** →
**Make public**. The landing page's **Install on GitHub** button (from `GITHUB_APP_SLUG`) then works
for any account, and new accounts start on the free tier. Put your own logins in
`REVO_OWNER_ACCOUNTS` first, so your repos are not counted against the free tier.

## 6. GitHub repository

1. **Deploy key**, on your laptop:
   ```sh
   ssh-keygen -t ed25519 -f revo_deploy -N "" -C "github-actions-revo"
   ```
   Append `revo_deploy.pub` to `~/.ssh/authorized_keys` on the server.
2. **Secrets** in **Settings → Secrets and variables → Actions**:

   | Secret        | Value                                     |
   | ------------- | ----------------------------------------- |
   | `EC2_HOST`    | Elastic IP or hostname                    |
   | `EC2_USER`    | `ubuntu` (or your user)                   |
   | `EC2_SSH_KEY` | contents of the private key `revo_deploy` |

3. **Optional, analytics:** in **Settings → Secrets and variables → Actions → Variables**, add
   `NEXT_PUBLIC_POSTHOG_KEY` with your PostHog project token (public and write-only, so a variable,
   not a secret). It is built into the web image; without it, Revo sends no analytics.
4. Push to `main`, or run **Deploy** from the **Actions** tab.

## 7. First run

1. Open `https://revo.asrar.software` and sign in with GitHub.
2. **Install App** → pick the repositories to review. Then set the model, threshold and monthly
   budget in each repo's settings, and check **Repos → AI access** (free tier, own key, or owner
   account).
3. If the same repos also have a development App installed, uninstall it there (or stop the local
   worker): both would review every push.
4. Push a commit to an open pull request: the "Revo" check and the summary comment appear within a
   minute or two.

If webhooks fail with 403 in the App's **Advanced → Recent deliveries**, look at Cloudflare →
Security → Events: Bot Fight Mode can challenge GitHub's requests. Add a WAF skip rule for the path
`/api/github/webhook`.

## Day to day

```sh
cd ~/revo
docker compose ps
docker compose logs -f worker     # reviews (one JSON line per event)
docker compose logs -f web        # webhooks, sign-in
docker compose logs migrate       # last deploy's migrations
```

Logs of every container are also in Dozzle, and the database in pgAdmin.

**Roll back:** set `IMAGE_TAG` in `~/revo/.env` to an earlier commit SHA, then
`docker compose up -d`. Run `docker login ghcr.io` first (a personal access token with
`read:packages`) if the packages are private.
