# HRM Deploy Toolkit

Server-side scripts to pull images from ECR and run the HRM stack with resource
limits behind Nginx. Lives on the VPS at `/opt/quickboom/`.

## Layout

| File | Purpose |
|------|---------|
| `deploy.env` | Tunable config — region, repos, ports, **CPU/RAM limits** (copy from `deploy.env.example`) |
| `config.sh` | Shared helpers (ECR login, image URIs, resource-limited `run_service`) — sourced, not run |
| `deploy-backend.sh` | Pull + (re)start backend (`hrm-backend`) on :5004 |
| `deploy-admin.sh` | Pull + (re)start admin panel (`hrm-admin`) on :3000 |
| `deploy-all.sh` | Both, backend first |
| `status.sh` | Container status + live CPU/mem + recent logs |
| `setup-server.sh` | One-time: swapfile + Nginx + certbot + site config (`sudo`) |
| `nginx/hrm.conf` | Reverse proxy: `voxiqai.com`→admin, `api.voxiqai.com`→backend |

## First-time setup (on the VPS)

```bash
cd /opt/quickboom
cp deploy.env.example deploy.env        # adjust limits/tag if needed
# create backend.env and frontend.env (app secrets) — see ../DEPLOY.md
sudo ./setup-server.sh                   # swap + nginx + certbot + site
./deploy-all.sh                          # pull from ECR + start both
sudo certbot --nginx -d voxiqai.com -d www.voxiqai.com -d api.voxiqai.com
```

## Day-to-day

```bash
./deploy-backend.sh     # ship new backend image (after CI pushes :latest)
./deploy-admin.sh       # ship new admin image
./status.sh             # see what's running + resource usage
./status.sh backend     # + tail backend logs
```

## Resource limits

Host is 2 vCPU / ~1.9 GB RAM. Defaults in `deploy.env`:

- backend: `1.0` CPU, `640m` RAM (reserve `320m`)
- admin:   `0.75` CPU, `512m` RAM (reserve `256m`)

Containers also get a 2 GB swapfile (added by `setup-server.sh`) as OOM headroom,
and JSON log rotation (10 MB × 3 files).

## Rollback

Set `IMAGE_TAG=<git-sha>` in `deploy.env` (CI tags every image with the commit
SHA), then re-run the deploy script.
