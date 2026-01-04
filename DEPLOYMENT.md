# Deployment Guide for Railway 🚀

This guide will walk you through deploying the Barber Shop application (Database, Backend, and Frontend) to [Railway.app](https://railway.app/).

## Prerequisites

* A Railway account (GitHub login recommended).
* This repository pushed to your GitHub.

---

## 1. Create a Project & Database

1. Click **"New Project"** > **"Provision PostgreSQL"**.
2. Once created, click on the **PostgreSQL** card > **Variables**.
3. Copy the `DATABASE_URL`. You will need this for the Backend.

---

## 2. Deploy Backend

1. Click **"New"** > **"GitHub Repo"** > Select your repository.
2. **Configuration (Before Deploying):**
    * Click on the new Service card (it might fail initially, that's okay/normal until configured).
    * Go to **Settings** > **Root Directory**: Set to `/backend`.
    * **Build Command**: `npm install && npm run build` (Railway usually auto-detects `npm install`, but ensure `npm run build` runs).
    * **Start Command**: `npx prisma migrate deploy && npm start` (IMPORTANT: this runs database migrations before starting).
3. **Variables:**
    * Go to the **Variables** tab.
    * Add the following:
        * `DATABASE_URL`: (Paste the value from Step 1)
        * `PORT`: `5100` (or `8080`, Railway usually overrides this but good to set)
        * `JWT_SECRET`: (Generate a random secure string)
        * `STRIPE_SECRET_KEY`: (Your Stripe Secret Key `sk_...`)
        * `STRIPE_WEBHOOK_SECRET`: (Your Stripe Webhook Signing Secret `whsec_...`)
        * `FRONTEND_URL`: (Leave empty for now, we will fill this after deploying Frontend)
4. **Networking:**
    * Go to **Settings** > **Networking**.
    * Click "Generate Domain". Copy this domain (e.g., `backend-production.up.railway.app`). Update your Stripe Webhook endpoint to use this domain (`https://<BACKEND_DOMAIN>/api/webhooks`).

---

## 3. Deploy Frontend

1. Click **"New"** > **"GitHub Repo"** > Select your repository **again**.
2. **Configuration:**
    * Click on the *new* Service card (rename it to "Frontend" in Settings to avoid confusion).
    * Go to **Settings** > **Root Directory**: Set to `/frontend`.
    * **Build Command**: `npm install && npm run build`.
    * **Output Directory**: `dist` (This tells Railway to serve the static files from this folder).
3. **Variables:**
    * Go to **Variables** tab.
    * Add:
        * `VITE_API_URL`: `https://<YOUR_BACKEND_DOMAIN>/api` (Paste the Backend domain from Step 2.4, append `/api`).
4. **Networking:**
    * Go to **Settings** > **Networking**.
    * Click "Generate Domain". This is your live website URL!

---

## 4. Final Connections

1. **Update Backend Variable:**
    * Go back to your **Backend Service** > **Variables**.
    * Add/Update `FRONTEND_URL` with your **Frontend Domain** (e.g., `https://frontend-production.up.railway.app`). This is important for CORS.
2. **Redeploy:**
    * Redeploy both services to ensure all variable changes take effect.

## Troubleshooting

* **Database Connection Error:** Ensure `DATABASE_URL` is correct in Backend variables.
* **Build Failed:** Check the "Build Logs". Ensure `tsc` runs without errors (local types must match).
* **CORS Error:** Ensure `FRONTEND_URL` in backend matches the exact Frontend domain (no trailing slash usually, dependent on your code logic).
