# Going live — step by step

Written for someone who has not done this before. Follow it in order. Nothing
here needs Android Studio, a server, or any HTTPS certificate work.

---

## Read this first: two things that will trip you up

**1. Your code is not on `main`.**

All the work lives on the branch `claude/cin-repo-code-review-j3zlww`. Your
`main` branch still has the original 3 commits from when the project started.
Vercel and most hosts deploy `main` by default — so if you skip this, you will
deploy the old app and spend an hour wondering why nothing works.

Fix it before anything else, on GitHub:

1. Go to `https://github.com/raaedalhakim97/cin`
2. Click **Pull requests** → **New pull request**
3. base: `main` ← compare: `claude/cin-repo-code-review-j3zlww`
4. **Create pull request**, then **Merge pull request**

(I have not done this for you — merging into `main` is your call, not mine.
Say the word and I will open the PR.)

**2. You never touch HTTPS.**

Vercel, Netlify and Cloudflare Pages all issue and renew the certificate
automatically, free, including on your own domain. There is no step where you
buy or install one. If you find yourself reading about certificates, you have
wandered off the path.

---

## Part 1 — Web app live with HTTPS (about 10 minutes)

### Step 1: get your two Supabase values

Supabase dashboard → your project → **Project Settings** (gear icon) →
**API keys**.

Copy these two:

| What | Looks like |
|---|---|
| Project URL | `https://rxkgnbvjywiqkgbbypfs.supabase.co` |
| Publishable / anon key | a long string starting `sb_publishable_` or `eyJ...` |

Both of these are **safe to be public** — they ship inside the app that runs in
people's browsers either way. What must never leave the dashboard is the
**service_role** key. If you ever paste that into the app, rotate it.

### Step 2: sign up for Vercel

1. Go to `vercel.com` → **Sign Up** → **Continue with GitHub**
2. Authorise it to see your repositories

### Step 3: import the project

1. **Add New** → **Project**
2. Find `cin` in the list → **Import**
3. Vercel will detect Vite automatically. Leave the build settings alone —
   `vercel.json` in the repo already sets the build command, output directory,
   the single-page-app routing, and the security headers.

### Step 4: add the two environment variables

Still on the import screen, expand **Environment Variables** and add:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | the Project URL from step 1 |
| `VITE_SUPABASE_ANON_KEY` | the publishable key from step 1 |

These must be set here, not just in your local `.env` — your local file is
gitignored and Vercel never sees it. If you forget this step the site will
load and then fail to sign anyone in.

### Step 5: deploy

Click **Deploy**. Two or three minutes later you get a live URL like
`byond-hr.vercel.app`, already on HTTPS.

### Step 6: check the production branch

Vercel → your project → **Settings** → **Git** → **Production Branch**.

If you merged to `main` in the section above, leave it as `main`. If you did
not, set it to `claude/cin-repo-code-review-j3zlww` — otherwise you are
deploying the old code.

### Step 7 (optional): your own domain

Settings → **Domains** → add `app.yourdomain.com`. Vercel shows you the DNS
record to create at your registrar. The certificate appears by itself within a
few minutes of the DNS resolving.

### Step 8: tell Supabase about the new address

Supabase dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: your Vercel URL (or custom domain)
- **Redirect URLs**: add the same URL plus `/**`

Skip this and password-reset and invite links will send people to the wrong
place. This is the most commonly missed step of the whole process.

---

## Part 2 — Android APK (about 20 minutes, mostly waiting)

The build happens on Expo's servers. You do not need Android Studio, a JDK, or
a fast computer.

### Step 1: install the build tool

```bash
npm install -g eas-cli
```

### Step 2: make an Expo account and log in

```bash
eas login
```

Sign up at `expo.dev` first if you have not.

### Step 3: fill in your Supabase values

Open `mobile/eas.json`. In both the `preview` and `production` sections, fill
in the two empty strings with the same values from Part 1 Step 1:

```json
"env": {
  "EXPO_PUBLIC_SUPABASE_URL": "https://rxkgnbvjywiqkgbbypfs.supabase.co",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "sb_publishable_..."
}
```

They go here rather than in `mobile/.env` because EAS builds from your Git
repository and `.env` is gitignored — the build server would never see it. It
is safe to commit these two; they are the same public values that already ship
inside the app bundle.

### Step 4: link the project

```bash
cd mobile
eas init
```

This attaches the folder to a project on your Expo account.

### Step 5: build the APK

```bash
eas build --platform android --profile preview
```

Two things will happen the first time:

- **"Generate a new Android Keystore?"** → answer **Yes**. This is the signing
  key for your app; EAS stores it for you. Do not lose access to that Expo
  account — if you later publish to the Play Store, updates must be signed with
  this same key.
- The build queues on Expo's servers. On the free plan you may wait in a queue;
  the build itself takes 10–15 minutes.

When it finishes the terminal prints a download link, and it also appears at
`expo.dev` → your project → **Builds**.

### Step 6: install it on a phone

Open the link on the Android phone and download it. Android will warn about
installing from outside the Play Store — allow it for your browser. The app
installs like any other.

To share with your team, send them that same link.

### Why `--profile preview` matters

Plain `eas build --platform android` produces an **.aab** — a Play Store upload
bundle that will *not* install on a phone. The `preview` profile in `eas.json`
sets `"buildType": "apk"`, which is the installable file you actually want for
testing and for handing to colleagues. Use `production` only when you are
uploading to the Play Store.

---

## What to test the moment it is live

In this order, because each depends on the last:

1. **Sign in** — if this fails, the environment variables are wrong or the
   Supabase Site URL is not set.
2. **Clock in** on the phone — this needs GPS. Android will ask for location
   permission; the app already declares it correctly in `app.json`.
3. **Clock out early** — you should see the "Leaving Xh Ym early" warning.
4. **Request leave** — confirm the balance moves and the entitlement check
   fires if you ask for more days than you have.
5. **Open the KPI screen** — attendance and Hours Completed should be filled in
   automatically.

---

## Before a real customer uses this

These are not optional, and `docs/deployment.md` explains each one:

- **Custom SMTP.** The built-in mailer sends only a handful of emails per hour.
  Your whole onboarding is invite-based, so a real company cannot be onboarded
  without this. Do it first.
- **A backup you have actually restored.** The free plan has none.
- **Delete the six `ByondTest#2026` accounts.**
- **Turn on leaked-password protection** in the dashboard.
- **Decide about the region.** The database is in Mumbai and holds Emirates ID
  numbers, IBANs and salaries. A project's region cannot be changed after it is
  created, so moving means a new project and a migration — cheap now at 17 MB,
  expensive once you have customers.
