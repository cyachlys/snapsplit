# 🚀 Deploying SplitWoi! to Vercel (Step-by-Step Guide)

This project has been restructured to deploy seamlessly to **Vercel Serverless Functions** while preserving 100% compatibility with local development.

---

## 🏗️ Architecture Overview

* **Frontend**: Served automatically by Vercel's global CDN from `public/index.html`.
* **Backend**: Serverless Function at `api/index.js` routed via `vercel.json`.
* **Cloud Database**: **[Turso](https://turso.tech)** (Serverless SQLite over HTTPS via `@libsql/client`).
* **Local Fallback**: When `TURSO_DATABASE_URL` is omitted, it automatically falls back to local `snapsplit.db`.

---

## 📋 Step 1: Create a Free Turso Database (2 minutes)

Since Vercel functions have an ephemeral filesystem, we store data in a free, serverless SQLite database on Turso.

1. Go to **[turso.tech](https://turso.tech)** and sign in (GitHub or email).
2. Create a new database named `snapsplit` (via the web dashboard or CLI):
   * **Via Web Dashboard**:
     - Click **Create Database** -> Name it `snapsplit` -> Select the region closest to you (e.g. `sin` Singapore, `hkg`, `fra`, etc.).
     - Copy the **Database URL** (e.g. `libsql://snapsplit-yourname.turso.io`).
     - Click **Generate Token** -> Copy the Auth Token.
   * **Or Via Turso CLI**:
     ```bash
     # Install CLI (optional)
     # macOS/Linux: curl -sSfL https://get.tur.so/install.sh | bash
     # Windows PowerShell: irm https://get.tur.so/install.ps1 | iex

     turso auth login
     turso db create snapsplit
     turso db show snapsplit --url
     turso db tokens create snapsplit
     ```

---

## 📦 Step 2 (Optional): Migrate Your Local Data to Turso

If you have existing users, receipts, and debts in `snapsplit.db` that you want to transfer to your new cloud database:

1. Create a `.env` file in the project root:
   ```env
   TURSO_DATABASE_URL=libsql://snapsplit-yourname.turso.io
   TURSO_AUTH_TOKEN=your_auth_token_here
   ```
2. Run the migration script:
   ```bash
   npm run migrate:turso
   ```
   All users, sessions, receipts, friends, and debts will be copied to Turso.

---

## 🚀 Step 3: Deploy to Vercel

### Option A: Deploy via GitHub (Recommended)
1. Initialize git and push this folder to your GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: prepare for vercel deployment"
   git branch -M main
   git remote add origin https://github.com/<your-username>/snapsplit.git
   git push -u origin main
   ```
2. Go to **[vercel.com/new](https://vercel.com/new)**.
3. Import your GitHub repository.
4. In the **Environment Variables** section, add:
   * `TURSO_DATABASE_URL`: Your Turso database URL (`libsql://...`)
   * `TURSO_AUTH_TOKEN`: Your Turso token
   * `ADMIN_KEY`: (Optional) Your secret master admin passkey (e.g. `splitwoi#admin`)
   * `ANTHROPIC_API_KEY`: (Optional) For AI receipt OCR scanning
5. Click **Deploy**.

---

### Option B: Deploy via Vercel CLI
1. Run:
   ```bash
   npx vercel
   ```
2. Follow the prompts to log in and select your project settings.
3. Add environment variables when prompted or run:
   ```bash
   npx vercel env add TURSO_DATABASE_URL
   npx vercel env add TURSO_AUTH_TOKEN
   ```
4. Deploy to production:
   ```bash
   npx vercel --prod
   ```

---

## 🛠️ Verification & Testing
Once deployed:
1. Open your `*.vercel.app` URL.
2. Register a new user or log in.
3. Add a test receipt and split it.
4. Access the Secret Vault by pressing `Ctrl + Shift + A` (or typing `admin` on screen) and entering your `ADMIN_KEY` to verify database connectivity and live stats.
