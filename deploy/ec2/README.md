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

3. Push to `main`, or run **Deploy** from the **Actions** tab.

## 7. First run

1. Open `https://revo.asrar.software` and sign in with GitHub.
2. **Install App** → pick the repositories to review. Then set the model, threshold and monthly
   budget in each repo's settings.
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
