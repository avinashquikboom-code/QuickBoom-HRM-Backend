# Deploy Quickboom Backend to Render

## Prerequisites

You need:
- A **GitHub** repository with your code pushed
- A **Supabase** (or other) PostgreSQL database URL
- A **Google Maps API Key** (for geocoding/location features)

---

## Option 1: Blueprint (Fastest)

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Add Render deployment config"
   git push origin main
   ```

2. **Update `render.yaml`**
   - Replace `YOUR_USERNAME/YOUR_REPO` with your actual GitHub path.

3. **In Render Dashboard**
   - Go to **Blueprints** → **New Blueprint Instance**
   - Select your GitHub repo
   - Render creates the web service automatically

4. **Set Secret Environment Variables**
   After the service is created, go to the **Environment** tab and add:

   | Key | Value | Where to get it |
   |-----|-------|-----------------|
   | `DATABASE_URL` | `postgresql://postgres...` | Supabase → Settings → Database → Connection String |
   | `JWT_SECRET` | *strong random string* | Run: `openssl rand -base64 32` |
   | `GOOGLE_MAPS_API_KEY` | `AIzaSy...` | Google Cloud Console → APIs & Services → Credentials |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | *(optional)* | Firebase Console → Project Settings → Service Accounts |

5. **Deploy**
   - Click **Manual Deploy** → **Deploy latest commit**
   - Render builds the Docker image, runs `prisma migrate deploy`, and starts the server

---

## Option 2: Manual Setup

### Step 1: Create Web Service
- Dashboard → **New** → **Web Service**
- Connect your GitHub repo
- **Name**: `quickboom-backend`
- **Runtime**: Docker
- **Root Directory**: `./quickboom-backend` (if backend is in a subfolder)

### Step 2: Environment Variables
In the Web Service dashboard → **Environment** tab, add:

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `10000` | Render requires this |
| `HOST` | `0.0.0.0` | Required for containers |
| `DATABASE_URL` | *your Supabase URL* | Must start with `postgresql://` |
| `JWT_SECRET` | *strong random string* | Generate with `openssl rand -base64 32` |
| `GOOGLE_MAPS_API_KEY` | *your API key* | For address geocoding in location page |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | *(optional)* | For push notifications |

### Step 3: Deploy
- Click **Deploy** or push to `main` branch
- Render builds the Docker image, runs `prisma migrate deploy`, and starts the server

---

## After Deployment

### Update Frontend API Base URL
Change your frontend `.env` or API config to point to your Render URL:

```bash
# HRM-Admin-Pannel/.env.local
NEXT_PUBLIC_API_URL=https://quickboom-backend.onrender.com
```

Also update `next.config.ts` if you hardcoded the fallback URL anywhere.

### Health Check
Visit `https://quickboom-backend.onrender.com/` — should return the home route response.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ECONNREFUSED` on frontend | Backend URL is wrong or backend is sleeping (free tier spins down) |
| Database connection failed | Check `DATABASE_URL` is correct. Supabase requires pooling mode or direct connection |
| Prisma errors on deploy | Make sure `npx prisma migrate deploy` runs at startup (already in Dockerfile) |
| CORS errors | Backend `cors()` is enabled. Ensure `NEXT_PUBLIC_API_URL` matches exactly |
| Port already in use | Render sets `PORT=10000`. Don't override to 5003 on Render. |

---

## Free Tier Limits (Render)
- Web service sleeps after 15 min of inactivity → ~30s cold start
- Upgrade to **Starter** ($7/mo) for always-on, or **Standard** ($25/mo) for production traffic
