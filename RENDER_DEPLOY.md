# Deploy Quickboom Backend to Render

## Option 1: Blueprint (Fastest - 1 Click)

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Add Render deployment config"
   git push origin main
   ```

2. **Update `render.yaml`**
   - Replace `YOUR_USERNAME/YOUR_REPO` in `render.yaml` with your actual GitHub username and repository name.
   - Or remove the `repo` line and manually connect the repo in the Render dashboard.

3. **In Render Dashboard**
   - Go to **Blueprints** → **New Blueprint Instance**
   - Connect your GitHub repo
   - Render will auto-create:
     - Web service (`quickboom-backend`) with Docker
     - PostgreSQL database (`quickboom-db`)
   - `DATABASE_URL` and `JWT_SECRET` are auto-configured

4. **Done!** Render will build, run migrations, and deploy automatically on every push.

---

## Option 2: Manual Setup

### Step 1: Create PostgreSQL Database
- Dashboard → **New** → **PostgreSQL**
- Name: `quickboom-db`
- Plan: Starter (or higher)
- Region: Choose closest to your users
- Save the **Internal Database URL** for later

### Step 2: Create Web Service
- Dashboard → **New** → **Web Service**
- Connect your GitHub repo
- **Name**: `quickboom-backend`
- **Runtime**: Docker
- **Root Directory**: `./quickboom-backend` (if backend is in a subfolder)

### Step 3: Environment Variables
In the Web Service dashboard → **Environment** tab, add:

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `10000` | Render requires this |
| `HOST` | `0.0.0.0` | Required for containers |
| `DATABASE_URL` | *paste from DB dashboard* | From Step 1 |
| `JWT_SECRET` | *generate a strong secret* | Use `openssl rand -base64 32` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | *(optional)* | For push notifications |

### Step 4: Deploy
- Click **Deploy** or push to `main` branch
- Render builds the Docker image, runs `prisma migrate deploy`, and starts the server

---

## After Deployment

### Update Frontend API Base URL
Change your frontend `.env` or API config to point to your Render URL:

```
NEXT_PUBLIC_API_BASE_URL=https://quickboom-backend.onrender.com
```

### Health Check
Visit `https://quickboom-backend.onrender.com/` — should return the home route response.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ECONNREFUSED` on frontend | Backend URL is wrong or backend is sleeping (free tier) |
| Database connection failed | Check `DATABASE_URL` format. Must start with `postgresql://` |
| Prisma errors on deploy | Make sure `npx prisma migrate deploy` runs in startup (already in Dockerfile) |
| CORS errors | Backend `cors()` is enabled. Check `NEXT_PUBLIC_API_BASE_URL` matches exactly |

---

## Free Tier Limits (Render)
- Web service sleeps after 15 min of inactivity → ~30s cold start
- PostgreSQL: 1GB storage, shared CPU
- Upgrade to **Starter** ($7/mo) or **Standard** ($25/mo) for production
