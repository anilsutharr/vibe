---
title: Local Setup on Windows
sidebar_position: 3
---

This guide sets up ViBe on a Windows machine for local development, step by step and without the interactive setup script. Everything runs locally: the Firebase **Auth emulator** instead of a real Firebase project, and a local **MongoDB replica set** instead of a shared database. No credentials from a maintainer are needed.

It was written while setting up a fresh Windows 10 machine and lists every problem hit along the way, with its fix. Commands are for **PowerShell** unless marked otherwise.

---

## 1. Prerequisites

| Tool | Version | Check | Notes |
|---|---|---|---|
| Node.js | 23 or newer (an LTS release such as 24 works) | `node -v` | From [nodejs.org](https://nodejs.org) |
| pnpm | 10.x (the repo pins `pnpm@10.12.1`) | `pnpm -v` | See below |
| Git | any recent | `git --version` | From [git-scm.com](https://git-scm.com/download/win) |
| Java | 21 or newer | `java -version` | Needed by the Firebase emulator |
| MongoDB | 7 or newer, optional | `mongod --version` | Only its `mongod.exe` is reused; see step 5 |

Install pnpm and give it a folder for global tools:

```powershell
npm install -g pnpm@10.12.1
pnpm setup        # sets PNPM_HOME and adds it to your user PATH
```

**Open a new terminal** after `pnpm setup`. Without it, `pnpm add -g` and `pnpm link --global` fail with `ERR_PNPM_NO_GLOBAL_BIN_DIR`.

:::tip
Keep the repository **outside OneDrive** (for example `C:\dev\vibe`). OneDrive tries to sync the hundreds of thousands of files in `node_modules`, which makes `pnpm install` take many times longer.
:::

---

## 2. Get the code

```powershell
git clone https://github.com/<your-username>/vibe.git
cd vibe
git remote add upstream https://github.com/vicharanashala/vibe.git
git fetch upstream main
```

:::caution
Fetch **only `main`** from upstream. A plain `git fetch upstream` fails on Windows with `cannot lock ref 'refs/remotes/upstream/fix/stop-api'`: upstream has two branches whose names differ only in letter case (`fix/Stop-API` and `fix/stop-api`), and Windows cannot store both.
:::

---

## 3. Install dependencies

```powershell
pnpm install
pnpm add -g firebase-tools tsx
cd cli; pnpm link --global; cd ..
```

- `pnpm install` may change `pnpm-lock.yaml`. Don't commit that change with your work; restore it with `git checkout -- pnpm-lock.yaml`.
- The warning about ignored build scripts (`bcrypt`, `sharp`, `mongodb-memory-server` and others) can be ignored for local development.
- Run `pnpm link --global` **inside `cli/`**. Run from the repository root it links the wrong package and prints `vibe has no binaries`.

---

## 4. Environment files

### `backend/.env`

```bash
# Must NOT be "development": that mode requires a real Firebase service-account key.
NODE_ENV="local"
APP_PORT="3141"
APP_MODULE="all"
APP_URL="http://localhost:3141"
APP_ORIGINS="http://localhost:5173"
FRONTEND_URL="http://localhost:5173"

# Local replica set from step 5
DB_URL="mongodb://127.0.0.1:27018/?replicaSet=rs0"
DB_NAME="vibe"

# Firebase Auth emulator. A "demo-" project id never contacts real Firebase.
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
FIREBASE_EMULATOR_HOST="127.0.0.1:4000"
GCLOUD_PROJECT="demo-vibe"
FIREBASE_API_KEY="fake-api-key"

# No AI keys locally
SCREENING_ENABLED=false
```

- `APP_MODULE` must be `all`. The example file's `auth` loads only the auth module.
- `NODE_ENV="development"` crashes at startup with `Cannot read properties of undefined (reading 'replace')`, because that mode reads `FIREBASE_PRIVATE_KEY`.

### `frontend/.env`

```bash
VITE_BASE_URL=http://localhost:3141/api
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-vibe.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-vibe
VITE_FIREBASE_STORAGE_BUCKET=demo-vibe.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000
VITE_FIREBASE_MEASUREMENT_ID=
VITE_IS_RECAPTCHA_ENABLED=false
```

Both files are ignored by git.

---

## 5. A local MongoDB replica set

The backend uses multi-document transactions, which need a **replica set**. A default MongoDB installation runs as a standalone server and will not work.

The simplest option uses `mongodb-memory-server`, which the CLI already depends on. Keep personal helper scripts in a folder git ignores, for example `.local-dev/`, and add that folder to `.git/info/exclude`. Save this as `.local-dev/mongo-rs.mjs`:

```js
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../cli/package.json', import.meta.url));
const {MongoMemoryReplSet} = require('mongodb-memory-server');

// Optional: reuse an installed MongoDB instead of downloading one.
// process.env.MONGOMS_SYSTEM_BINARY ??= 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';

// Keep the data outside OneDrive so it survives restarts.
const dbPath = path.join(process.env.LOCALAPPDATA, 'vibe-dev', 'mongo-data');
fs.mkdirSync(dbPath, {recursive: true});

const replSet = await MongoMemoryReplSet.create({
  replSet: {name: 'rs0', count: 1, storageEngine: 'wiredTiger'},
  instanceOpts: [{port: 27018, ip: '127.0.0.1', dbPath}],
});
console.log(`MongoDB replica set ready: ${replSet.getUri()}`);

const stop = async () => {
  await replSet.stop({doCleanup: false});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

Stop it with `Ctrl+C` rather than closing the window. Otherwise a leftover `mongod` keeps the data folder locked and the next start fails with `DBPathInUse`.

---

## 6. Email login against the emulator

`POST /auth/login` checks passwords by calling `https://identitytoolkit.googleapis.com` directly, which ignores `FIREBASE_AUTH_EMULATOR_HOST`. Against the emulator, every email login fails with **"Incorrect email or password"**, even though signup works.

Until the backend handles this itself, a small preload script redirects that call to the emulator. Save it as `.local-dev/emulator-fetch.mjs`:

```js
const GOOGLE = 'https://identitytoolkit.googleapis.com/';
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  // Read per call: the backend loads .env after this preload runs.
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const isRequest = typeof input !== 'string' && !(input instanceof URL);
  const url = isRequest ? input?.url : String(input);
  if (host && typeof url === 'string' && url.startsWith(GOOGLE)) {
    const rewritten = `http://${host}/identitytoolkit.googleapis.com/${url.slice(GOOGLE.length)}`;
    return realFetch(isRequest ? new Request(rewritten, input) : rewritten, init);
  }
  return realFetch(input, init);
};
```

It is loaded when starting the backend in step 7.

---

## 7. Start everything

Use four terminals, all in the repository root, started in this order:

```powershell
# 1. MongoDB (wait for "replica set ready")
node .local-dev/mongo-rs.mjs

# 2. Firebase Auth emulator (wait for "All emulators ready!")
cd backend
firebase emulators:start --only auth --project demo-vibe --import ..\.local-dev\firebase-data --export-on-exit

# 3. Backend on http://localhost:3141/api
cd backend
pnpm build      # first time only
$env:NODE_OPTIONS = "--import ../.local-dev/emulator-fetch.mjs"
pnpm dev

# 4. Frontend on http://localhost:5173
cd frontend
pnpm dev
```

- Pass `--project demo-vibe` to the emulator. `vibe start auth` uses the project in `backend/.firebaserc`, which does not match the `.env` files.
- The first `pnpm build` is needed because `pnpm dev` starts `nodemon` before `tsc` has created `build/`, and on Windows nodemon then never restarts.
- `--import`/`--export-on-exit` keep emulator accounts between restarts. Press `Ctrl+C` **once** in the emulator window and wait, so it can save them.

---

## 8. Point the browser at the emulator

The frontend has no emulator setting of its own, but the Firebase SDK switches to the emulator when it finds a `__FIREBASE_DEFAULTS__` cookie. Add it once per browser profile:

1. Open `http://localhost:5173` and press **F12**.
2. Go to **Application → Storage → Cookies → http://localhost:5173**.
3. Add a row with **Name** `__FIREBASE_DEFAULTS__` and **Value**
   `eyJlbXVsYXRvckhvc3RzIjp7ImF1dGgiOiIxMjcuMC4wLjE6OTA5OSJ9fQ==`
   (the base64 of `{"emulatorHosts":{"auth":"127.0.0.1:9099"}}`).
4. Reload the page.

Each Chrome profile and every new incognito window needs the cookie again. Without it, login fails with **"Login failed. Please try again."**

The red *Analytics* and *Installations* errors about an invalid API key in the console are expected with the placeholder config, and harmless.

---

## 9. Test accounts

Create a student and a teacher with the **Sign up** form, or with the API:

```powershell
curl.exe -X POST http://localhost:3141/api/auth/signup -H "Content-Type: application/json" `
  -d '{\"email\":\"student@vibe.test\",\"password\":\"Student@123\",\"firstName\":\"Test\",\"lastName\":\"Student\"}'
```

Teacher and student are not account types. Every account is a `user`, and roles such as instructor or student belong to an enrollment in a course. **Only admins can create courses**, so for a local teacher account set `roles` to `"admin"` on that user in the `users` collection, for example with MongoDB Compass connected to `mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true`.

Then, as the teacher, create a course with at least one module, section and item, and invite the student. Invitation emails are not sent locally, but the invite is still recorded.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_PNPM_NO_GLOBAL_BIN_DIR` | pnpm has no global folder | `pnpm setup`, then a new terminal |
| `cannot lock ref ... fix/stop-api` on fetch | Branch names differing only in case | `git fetch upstream main` |
| `Cannot find module ...\backend\build\index.js` | First run of `pnpm dev` | `pnpm build`, then `pnpm dev` |
| Backend errors about transactions or `replicaSet` | MongoDB is a standalone server | Use the replica set from step 5 |
| `DBPathInUse` when starting MongoDB | A previous `mongod` is still running | Wait a few seconds, or stop the leftover `mongod.exe` |
| "Incorrect email or password" for a valid account | `/auth/login` calls real Google | Start the backend with the preload from step 6 |
| "Login failed. Please try again." | Browser is not using the emulator | Add the cookie from step 8 in that profile |
| "Could not load the default credentials" when uploading a video | Uploads need Google Cloud Storage | Use a YouTube link in a video item instead |
| Students never receive invitation emails | No mail service locally | Expected; the invite is still created |
