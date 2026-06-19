# Operations Runbook — QuickBoom HRM (voxiqai.com)

How to ship code changes and operate the live server. Read this before touching production.

## What's where

| Thing | Value |
|-------|-------|
| Admin panel | https://voxiqai.com |
| Backend API | https://api.voxiqai.com (health: `/api/health`) |
| Server | Hostinger VPS `69.62.80.20` — SSH alias `GSRKHVK_HRM`, user `root` |
| Deploy dir on server | `/opt/quickboom` |
| Container registry | AWS ECR `546941058055.dkr.ecr.ap-south-1.amazonaws.com` (`hrm-backend`, `hrm-admin`) |
| Database | PostgreSQL **on the server host** (`quickboom` DB, `quickboom_user`), reached by containers via `host.docker.internal` |

## How deployment works (the mental model)

```
git push main ──▶ GitHub Actions builds the Docker image ──▶ pushes to AWS ECR
                                                                    │
        you SSH to the server ◀─────────────────────────────────────┘
        run a deploy script ──▶ pulls :latest from ECR ──▶ restarts the container
```

**CI only builds and pushes the image. It does NOT deploy to the server.** Deployment is a manual step you run over SSH. This is intentional.

---

## Shipping a change (the normal flow)

### 1. Push your code
```bash
git push origin main
```
This triggers the GitHub Actions workflow (`Build & Push`). Wait for it to go green:
- Backend: https://github.com/avinashquikboom-code/QuickBoom-HRM-Backend/actions
- Admin:   https://github.com/avinashquikboom-code/HRM-Admin-Pannel/actions

> ⏳ The image isn't ready until CI is green. Deploying before that pulls the *old* image.

### 2. SSH into the server
```bash
ssh GSRKHVK_HRM          # alias → root@69.62.80.20
cd /opt/quickboom
```

### 3. Deploy
```bash
./deploy-backend.sh      # backend only (after a backend push)
./deploy-admin.sh        # admin only (after an admin push)
./deploy-all.sh          # both
```
Each script: logs in to ECR → pulls `:latest` → stops the old container → starts the new one with CPU/RAM limits → prunes old images → prints status.

The **backend deploy automatically runs database migrations** (`prisma migrate deploy`) on container start.

### 4. Verify
```bash
./status.sh              # container status + live CPU/mem
./status.sh backend      # + tail backend logs
./status.sh admin        # + tail admin logs
```
Then hit the live URLs:
```bash
curl -s https://api.voxiqai.com/api/health   # {"status":"healthy",...}
curl -sI https://voxiqai.com/                # HTTP/2 200
```

That's it. A normal change is: **push → wait for green CI → SSH → `./deploy-X.sh` → verify.**

---

## Common operations

### Restart a container without redeploying (no code change)
```bash
ssh GSRKHVK_HRM
docker restart hrm-backend     # or hrm-admin
```

### View logs
```bash
docker logs --tail 100 -f hrm-backend     # follow live
docker logs --tail 100 hrm-admin
```

### Restart everything after a server reboot
Containers have `--restart unless-stopped`, so they come back automatically. Postgres and Nginx are systemd services (auto-start). If something didn't:
```bash
ssh GSRKHVK_HRM
systemctl start postgresql nginx docker
cd /opt/quickboom && ./deploy-all.sh
```

### Change an app secret / env var
Edit the env file on the server, then recreate the container so it picks it up:
```bash
ssh GSRKHVK_HRM
nano /opt/quickboom/backend.env     # or frontend.env
cd /opt/quickboom && ./deploy-backend.sh   # recreates the container
```
- `backend.env` → `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_MAPS_API_KEY`, Firebase/Supabase
- `frontend.env` → `BACKEND_API_URL` (the admin proxies `/api/*` here), `HOSTNAME`, `PORT`

> Secrets live ONLY on the server (`chmod 600`). They are never in GitHub. Don't commit them.

### Rollback to a previous version
Every image is also tagged with the git commit SHA. To roll back:
```bash
ssh GSRKHVK_HRM
nano /opt/quickboom/deploy.env       # set IMAGE_TAG=<old-git-sha>
cd /opt/quickboom && ./deploy-all.sh
# when done, set IMAGE_TAG=latest again
```

---

## Database

```bash
ssh GSRKHVK_HRM
# psql shell (password is in /root/.hrm_db_pass)
PGPASSWORD=$(cat /root/.hrm_db_pass) psql -h localhost -U quickboom_user -d quickboom
```
Migrations run automatically on backend deploy. To run them manually:
```bash
docker exec hrm-backend npx prisma migrate deploy
```

### Backups
An **hourly cron** dumps the DB and (once `S3_BUCKET` is set) uploads to `s3://<bucket>/hrm/YYYY/MM/DD/`.
```bash
cat /opt/quickboom/backup/.env        # set S3_BUCKET here to enable S3 upload
tail -f /var/log/db-backup.log        # backup activity
/opt/quickboom/backup/db-backup.sh    # run a backup right now
ls /opt/quickboom/backup/dumps/       # local dumps (kept 2 days)
```

---

## TLS / domains

HTTPS is handled by **Nginx + Let's Encrypt (certbot)**, auto-renewing. Nginx routes:
`voxiqai.com` + `www` → admin (`:3000`), `api.voxiqai.com` → backend (`:5004`).

```bash
ssh GSRKHVK_HRM
nginx -t && systemctl reload nginx          # after editing /etc/nginx/sites-available/hrm.conf
certbot renew --dry-run                      # test renewal
certbot certificates                         # see expiry
```
Adding a new domain: point DNS at `69.62.80.20`, add a server block to the nginx config, then
`certbot --nginx -d <domain>`.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Site returns **502 Bad Gateway** | Container is down. `docker ps` → if missing, `cd /opt/quickboom && ./deploy-X.sh`. Check `docker logs`. |
| Backend crash-loops with **P1010 / access denied** | Postgres `pg_hba.conf` doesn't allow the docker subnet. Rule must cover `172.16.0.0/12` with `scram-sha-256`; `listen_addresses` must include the docker gateways. Restart postgres. |
| Backend: **"datasource.url required"** | `prisma.config.ts` or the prisma CLI missing from the image — rebuild from latest `Dockerfile.deploy` (it copies both). |
| Admin container shows **unhealthy** but site works | Next.js bound to eth0 only. Ensure `HOSTNAME=0.0.0.0` (baked into the admin Dockerfile; also in `frontend.env`). |
| Admin loads but **API calls fail** | `BACKEND_API_URL` in `frontend.env` wrong, or `api.voxiqai.com` TLS down. The admin proxies `/api/*` to that URL. |
| **Deploy pulls old code** | CI wasn't green yet, or you deployed the wrong service. Re-check Actions, re-run `./deploy-X.sh`. |
| ECR login fails on the server | `aws configure` creds expired/rotated. Re-run `aws configure` (region `ap-south-1`). |
| Out of memory | Box is 1 vCPU / 3.8 GB + 2 GB swap. Check `free -h` and `docker stats`. Limits: backend 640m, admin 512m. |

---

## One-time setup (already done — reference only)

The server was provisioned with: Docker + compose, PostgreSQL 16, Nginx, certbot, AWS CLI, a 2 GB swapfile, the `/opt/quickboom` toolkit, env files, the backup cron, and TLS certs. To reproduce on a fresh box, see `deploy/README.md` and `deploy/setup-server.sh`.
