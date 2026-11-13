# HRM — `/var/www/hrm`

QuickBoom HRM on the shared AWS server (`ubuntu@3.24.20.182`, ap-southeast-2).
Same layout and scripts as `/var/www/qbunify`.

| What | Where |
|------|-------|
| Backend API (Node 22, Express, Prisma 7, socket.io) | container `hrm-backend`, `127.0.0.1:8110 -> 5004` |
| Admin panel (Next.js standalone) | container `hrm-admin`, `127.0.0.1:8111 -> 3000` |
| Database | shared RDS `main-postgresql`, database `hrm`, role `hrm_user` (own credentials) |
| Images | Sydney ECR `211107604014.dkr.ecr.ap-southeast-2.amazonaws.com/hrm-backend` and `/hrm-admin` |
| Public domains | `voxiqai.com` -> admin (no `www`); `api.voxiqai.com` -> backend (incl. `/socket.io/`) |
| nginx | only public entry (80/443); sites copied from `nginx/` to `/etc/nginx/sites-available/` |

Containers publish on `127.0.0.1` only — nothing but nginx is reachable from outside.

## Files

| File | Purpose |
|------|---------|
| `config.sh` | All non-secret settings (domains, ports, limits, ECR + image tags). CI pins the `ECR_REGISTRY` / `*_IMAGE_TAG` lines here. |
| `.env` | Secrets (mode 600, **not in git**): `DATABASE_URL`, `JWT_SECRET`, `REFRESH_SECRET`, optional Firebase / Maps. Template: `.env.example`. |
| `secrets/firebase-service-account.json` | Optional. Mounted read-only into the backend if present. |
| `_lib.sh` | Shared helpers (ECR login, network, vhost install). |
| `bootstrap.sh` | Idempotent one-time installer (docker, nginx, aws cli, folders). |
| `backend.sh` | pull -> `migrate.sh` -> vhost -> `start-api.sh` -> prune. Called by backend CI. |
| `admin.sh` | pull -> vhost -> `start-admin.sh` -> prune. Called by admin CI. |
| `deploy.sh` | Manual: `backend.sh` + `admin.sh`. |
| `setup-domain.sh` | One-time: Let's Encrypt cert for all three names (checks DNS first). |
| `nginx/*.conf` | HTTP-only vhosts; certbot adds TLS and the redirect. |

## Deploy

```bash
cd /var/www/hrm
./backend.sh      # API only
./admin.sh        # admin only
./deploy.sh       # both
docker logs -f hrm-backend
```

CI (`sed` the pinned lines in `config.sh`, then run `./backend.sh` or `./admin.sh`) is the normal path;
the scripts are also safe to run by hand.

## First-time setup / cutover runbook

The old VPS database could not be recovered, so this install started from a **fresh database** (no old users, employees
or attendance). Done so far: `.env` with new `JWT_SECRET` / `REFRESH_SECRET` (all old tokens are invalid), `./backend.sh`
(applies every Prisma migration to the empty `hrm` db), `./admin.sh`, and `./create-admin.sh`.

1. `./create-admin.sh [email]` — first SUPER_ADMIN (default `admin@hrm.com`, random password printed once and saved in
   `secrets/initial-admin.txt`) plus the Basic/Pro/Enterprise pricing plans. Change the password after the first login and delete
   that file. Do **not** run `prisma/seed.ts`: it is demo data, wipes every table and uses fixed passwords.
   Everything else (offices, employees, ...) is created in the admin panel; the mobile app users must be re-added.
2. Test before DNS moves (on the server, or from anywhere using the server IP):
   ```bash
   curl -H 'Host: api.voxiqai.com' -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}' http://127.0.0.1/api/auth/login
   curl --resolve voxiqai.com:80:3.24.20.182 http://voxiqai.com/
   ```
3. DNS (Hostinger hPanel): A records `@` and `api` -> `3.24.20.182` (no `www`) (no AAAA/CAA records exist today).
4. HTTPS: `nohup ./setup-domain.sh --wait >> logs/setup-domain.log 2>&1 &` waits for both names to resolve here (checked on
   1.1.1.1 and 8.8.8.8), then runs certbot and a smoke test by itself. It was started on 2026-11-13 and gives up after 3 days;
   check `logs/setup-domain.log`. Without `--wait`, run `./setup-domain.sh` yourself once DNS has moved.
5. Smoke test: `https://voxiqai.com` (admin login), `https://api.voxiqai.com/`, and a socket.io connection from the app.

## CI (GitHub Actions)

Both repos (`avinashquikboom-code/QuickBoom-HRM-Backend`, `.../HRM-Admin-Pannel`) build the image, push it to the Sydney ECR and
deploy over SSH: the job rewrites the pinned lines in the server's `config.sh`, runs `./backend.sh` / `./admin.sh` and fails
if the container does not come up healthy.

| Secret | Value |
|--------|-------|
| `EC2_HOST`, `EC2_USER`, `EC2_DEPLOY_DIR` | `3.24.20.182`, `ubuntu`, `/var/www/hrm` |
| `EC2_SSH_KEY` | private key of the dedicated deploy key; its public half (comment `github-actions-hrm-deploy`) is one line in `/home/ubuntu/.ssh/authorized_keys` — delete that line to revoke |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | IAM user of the Sydney account (211107604014) that can push to `hrm-backend` / `hrm-admin` |

The old `VPS_*`, `AWS_REGION` and `ECR_REPOSITORY` secrets are unused now and can be deleted.
`config.sh` on the server is edited by CI (image tags), so change other settings there in place or keep the repo copy in sync;
the other toolkit files are copied by hand (`scp`), CI does not sync them.

## Rollback

Change `API_IMAGE_TAG` / `ADMIN_IMAGE_TAG` in `config.sh` to a previous tag and re-run `./backend.sh` / `./admin.sh`.
Migrations are forward-only: roll back the schema from a database backup, not from the image.

## Notes

- Host ports `8110` / `8111` are registered in `/var/www/_server/docs/ports.md`.
- The server is small (≈2 GB RAM + swap) and shared. Backend memory guard (all in `config.sh`):
  hard cap 448 MB **with swap disabled** (`--memory-swap` = `--memory`), soft reservation 256 MB, Node heap capped at 320 MB
  (`NODE_OPTIONS=--max-old-space-size`), `--oom-score-adj 500` and a PID limit. If the backend ever leaks, docker kills and
  restarts only `hrm-backend`; the host and the other projects keep running. The one-off migrate container is capped at 384 MB.
  Admin: 512 MB / 0.75 CPU. Check usage with `docker stats --no-stream hrm-backend`; raise `API_MEMORY`, `API_MEMORY_SWAP`
  and `API_NODE_HEAP_MB` together (keep heap about 70% of the cap) if it is OOM-killed (`docker inspect -f '{{.State.OOMKilled}}' hrm-backend`).
- `sslmode=no-verify` in `DATABASE_URL` is intentional: the `pg` pool lets the URL override its own `ssl` option,
  and plain `require` would reject the RDS certificate chain.
- The old VPS scripts in `deploy/` (`/opt/quickboom`, local Postgres, Mumbai ECR) are obsolete for this server.
