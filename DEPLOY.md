# Deploying Revo on EC2

> This guide runs Revo alone on a fresh server, built there. To deploy it with GitHub Actions next
> to other apps that share one Traefik and Postgres (how revo.asrar.software runs), see
> [deploy/ec2/README.md](./deploy/ec2/README.md).

Revo runs as six containers from `docker-compose.yml` on one server:

| Service    | What it does                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------- |
| `traefik`  | HTTPS on 443 with a Let's Encrypt certificate, redirects 80 to 443, routes to `web`.         |
| `web`      | Next.js: dashboard, `/api/github/webhook`, sign-in with GitHub.                              |
| `worker`   | BullMQ consumer: fetches the PR, runs the two Claude passes, posts the check and comments.   |
| `postgres` | Postgres 17 (named volume `pgdata`).                                                         |
| `redis`    | Redis 8 for the review queue (AOF on, `noeviction`).                                         |
| `migrate`  | Runs `prisma migrate deploy` once, then exits. `web` and `worker` start only after it works. |

Only Traefik publishes ports. Postgres and Redis are reachable only on the private `revo_backend`
network.

> These files were written and checked without Docker (it is not installed on the machine they were
> written on): the Compose file validates against the Compose specification, and each Dockerfile's
> steps (turbo prune, frozen install, build, standalone server, worker bundle, migrations) were run
> by hand outside Docker. The first `docker compose up --build` on the server is the first real
> container build: watch its output.

## 1. The server

1. **Instance:** Ubuntu 24.04 LTS, `t3.medium` (2 vCPU, 4 GB) or larger. The Next.js build needs
   about 2 GB of memory; on a smaller instance add swap first
   (`sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`).
   Disk: 30 GB gp3.
2. **Elastic IP:** allocate one and associate it with the instance, so the IP survives a stop.
3. **Security group:** inbound 22 (your IP only), 80 and 443 (anywhere). Nothing else.
4. **Docker:**

   ```sh
   sudo apt-get update && sudo apt-get install -y ca-certificates curl git
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   sudo systemctl enable docker   # containers come back after a reboot
   docker compose version         # v2.x
   ```

## 2. DNS

Create an **A record** for your domain (for example `revo.example.com`) pointing at the Elastic IP.
Check it before the first start, because Let's Encrypt validates over HTTP on port 80:

```sh
dig +short revo.example.com   # must print the Elastic IP
```

## 3. Register the GitHub App

Revo is a GitHub App: it reads PRs, posts checks and comments, and its OAuth client signs users in to
the dashboard.

### Option A: from a manifest (recommended)

On your laptop, in a checkout of this repo (Node 24, `npx -y pnpm@10.34.9 install` done):

```sh
npx -y pnpm@10.34.9 github:app --url https://revo.example.com            # personal account
npx -y pnpm@10.34.9 github:app --url https://revo.example.com --org acme # or an organization
```

Open http://localhost:3832 and click **Create the GitHub App**. GitHub shows the app with every
setting below already filled in; confirm it. You come back to the local page, and the terminal prints
the six lines for `.env` (also written to `.env.github-app`, mode 600, gitignored):
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY`. The code GitHub returns expires after an hour.

### Option B: by hand

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App** (or the organization's
settings):

| Field                                                  | Value                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| GitHub App name                                        | `Revo` (must be unique on GitHub; add a suffix if taken)                                                           |
| Homepage URL                                           | `https://revo.example.com`                                                                                         |
| Callback URL                                           | `https://revo.example.com/api/auth/callback/github`                                                                |
| Expire user authorization tokens                       | on (Revo refreshes them)                                                                                           |
| Request user authorization (OAuth) during installation | off                                                                                                                |
| Setup URL                                              | `https://revo.example.com/repos`, with **Redirect on update** on                                                   |
| Webhook                                                | Active                                                                                                             |
| Webhook URL                                            | `https://revo.example.com/api/github/webhook`                                                                      |
| Webhook secret                                         | `openssl rand -hex 32` (keep it for `GITHUB_WEBHOOK_SECRET`)                                                       |
| Repository permissions                                 | **Checks:** read and write · **Contents:** read-only · **Metadata:** read-only · **Pull requests:** read and write |
| Subscribe to events                                    | **Pull request** (installation events are always sent)                                                             |
| Where can this GitHub App be installed?                | Only on this account                                                                                               |

After creating it: note the **App ID** and the slug (the end of its public page URL), click
**Generate a new client secret**, and **Generate a private key** (a `.pem` download). Put the key on
one line for `.env`:

```sh
awk 'NF {printf "%s\\n", $0}' revo.*.private-key.pem   # paste inside double quotes
```

## 4. Configure

On the server:

```sh
git clone <your fork of this repo> revo && cd revo
cp .env.example .env && chmod 600 .env
```

Fill in `.env`:

| Variable                                                                                                                          | Value                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                                                                                                                          | `revo.example.com`                                                                                                                                                                                                            |
| `ACME_EMAIL`                                                                                                                      | your email (certificate notices)                                                                                                                                                                                              |
| `POSTGRES_PASSWORD`                                                                                                               | `openssl rand -hex 24`                                                                                                                                                                                                        |
| `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`                                                                                             | `openssl rand -base64 32` each                                                                                                                                                                                                |
| `ANTHROPIC_API_KEY`                                                                                                               | your Claude API key                                                                                                                                                                                                           |
| `REVO_OWNER_ACCOUNTS`                                                                                                             | your GitHub login and orgs, comma-separated: their repos review with no monthly limit and may use every model. Every other account gets the free tier (`FREE_REVIEWS_PER_MONTH`, 20; `FREE_MONTHLY_CAP_USD`, $50) on your key |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY` | from step 3                                                                                                                                                                                                                   |
| `REVO_ENGINE`                                                                                                                     | set to `claude` by docker-compose.yml; the worker refuses `fake` in production                                                                                                                                                |
| `REVIEW_DEBOUNCE_SECONDS`, `WORKER_CONCURRENCY`, `LOG_LEVEL`                                                                      | `90`, `2`, `info`                                                                                                                                                                                                             |

Leave the "local tests only" block empty (`GITHUB_OAUTH_BASE_URL`, `GITHUB_API_URL`,
`REVO_TEST_MODE`, `MOCK_WEBHOOK_URL`, `REVO_ENABLE_DEV_KIT`). Compose sets `DATABASE_URL`,
`REDIS_URL` and `APP_URL` itself, gives the Claude key only to the worker and the sign-in secrets
only to the web app.

## 5. First start

```sh
docker compose up -d --build
docker compose ps                         # traefik, postgres, redis, web, worker: healthy; migrate: exited (0)
docker compose logs migrate               # "All migrations have been successfully applied"
docker compose logs -f traefik            # certificate obtained for revo.example.com
curl -s https://revo.example.com/api/health   # {"ok":true}
```

Then:

1. Open `https://revo.example.com` and **Sign in with GitHub**.
2. On **Repos**, click **Install on GitHub**, choose the account and the repos. GitHub sends the
   `installation` webhook; the repos appear with "Waiting for the first PR" (each enabled, Sonnet
   5.5, threshold 70, budget $20 a month).
3. Open a PR on one of them. The check **Revo: reviewing…** appears at once; after the 90-second
   debounce the worker posts the score check, one summary comment and inline comments for blockers
   and majors. The PR shows up in the dashboard.

## 6. Logs

```sh
docker compose logs -f web worker         # JSON lines (pino)
docker compose logs -f worker | grep '"claude call"'   # per-call tokens, model, stop reason, duration
```

- Logs never contain code, prompts, model answers, tokens or keys. The worker logs, per Claude
  call, the pass, model, stop reason, token counts and duration. Traefik's access log drops headers.
- Each container's log is rotated by Docker (10 MB × 5 files).
- GitHub keeps every webhook delivery (App settings → Advanced → Recent deliveries) and can redeliver
  one. Revo stores each delivery id, so a redelivery is handled once.

## 7. Backups

Postgres holds everything worth keeping (installations, PRs, reviews, findings, feedback). Redis
only holds the queue. A daily dump, kept 14 days:

```sh
sudo mkdir -p /var/backups/revo && sudo chown $USER /var/backups/revo
crontab -e
# 03:15 every day: dump, then delete dumps older than 14 days
15 3 * * * cd ~/revo && docker compose exec -T postgres pg_dump -U revo -Fc revo > /var/backups/revo/revo-$(date +\%F).dump && find /var/backups/revo -name '*.dump' -mtime +14 -delete
```

Copy them off the server (for example `aws s3 sync /var/backups/revo s3://<bucket>/revo/`), or
enable EBS snapshots for the volume. Restore:

```sh
docker compose stop web worker
docker compose exec -T postgres pg_restore -U revo -d revo --clean --if-exists < /var/backups/revo/revo-2026-11-21.dump
docker compose start web worker
```

## 8. Updates

```sh
cd ~/revo
docker compose exec -T postgres pg_dump -U revo -Fc revo > /var/backups/revo/pre-update.dump
git pull
docker compose up -d --build              # migrate runs first; web and worker are recreated after it
docker image prune -f
```

The worker gets SIGTERM and up to 2 minutes to finish the reviews it is running; queued reviews
wait in Redis and run on the new worker. Migrations only move forward: to roll back code, check out
the previous commit and rebuild; to roll back data, restore the dump taken before the update.

## 9. Restarts

Every long-running service has `restart: unless-stopped` and Docker starts at boot, so
`sudo reboot` brings Revo back by itself. Check with `docker compose ps` after the reboot. Reviews
queued during the downtime are kept by Redis (AOF) and run when the worker is back.

## 10. Troubleshooting

| Symptom                                         | Look at                                                                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No certificate                                  | Port 80 open to the internet? `dig` returns the Elastic IP? `docker compose logs traefik`.                                                                                                   |
| Webhook deliveries answer 401                   | `GITHUB_WEBHOOK_SECRET` differs from the app's webhook secret.                                                                                                                               |
| Sign-in fails                                   | The app's Callback URL must be exactly `https://<DOMAIN>/api/auth/callback/github`; `GITHUB_CLIENT_ID`/`SECRET` from the same app.                                                           |
| Check stays on "Revo: reviewing…"               | `docker compose logs worker`; is the worker healthy?                                                                                                                                         |
| Neutral check "Revo couldn't review this PR"    | The review failed after its retries (Claude unavailable, key rejected…). The reason is on the PR page in the dashboard; use **Review again**.                                                |
| Neutral check "Monthly budget reached"          | The repo spent its monthly budget. Raise it in the repo settings.                                                                                                                            |
| Neutral check "Free reviews used up this month" | The account is on the free tier and used `FREE_REVIEWS_PER_MONTH`. Add it to `REVO_OWNER_ACCOUNTS` (then `docker compose up -d`), or save its own Anthropic key under **Repos → AI access**. |

## 11. Data and security

- Uninstalling the app (or removing a repo from it) deletes that installation's repos, PRs, reviews,
  findings and feedback (spec 14).
- Webhooks are verified with `X-Hub-Signature-256`; invalid ones get 401.
- The webhook route (120 requests a minute per IP) and **Review again** (5 per user per 10 minutes)
  are rate limited. The counters are in memory, which is right for the single `web` container; move
  them to Redis before running several web replicas.
- Traefik replaces any `X-Forwarded-For` sent by clients, so the per-IP limit sees the real address.
- Only findings and snippets of at most 30 lines are stored, never whole files. Code goes only to the
  Claude API.
