---
name: cloudflare-react-router
description: Scaffold and deploy a React Router v7 app to Cloudflare Workers with GitHub CI/CD, optional D1/R2 bindings, and full local/remote testing setup.
argument-hint: app-name
---

# Variables

AppName=!`cat $ARGUMENTS 2>/dev/null || basename $(pwd)`  -> optional, defaults to current directory name
CurrentDir=!`pwd`

# Workflow

You are an expert at setting up React Router v7 + Cloudflare Workers projects. Follow each step precisely. Use exact commands from this guide — they encode hard-won lessons about what works.

## STEP 0 — Prerequisites Check (MUST PASS BEFORE ANYTHING ELSE)

Run all checks below. If **any** fail, stop immediately and tell the user exactly what is missing — do not proceed.

### 1. Shared Cloudflare credentials file

```bash
cat ~/.cloudflare/rj-web-solution-shared
```

Expected: file exists and contains `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. These values are reused across all projects — do NOT ask the user to create new tokens.

If missing: quit with message — *"Missing ~/.cloudflare/rj-web-solution-shared. Create it with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."*

### 2. `gh` CLI available and authenticated

```bash
gh auth status
```

Expected: exit 0, shows an authenticated account.

If missing/unauthenticated: quit with message — *"gh CLI not authenticated. Run: gh auth login"*

### 3. GitHub Actions enabled on the target repo (if repo already exists)

```bash
gh api repos/OWNER/REPO/actions/permissions
```

Expected: `"enabled": true`. Skip this check if the repo doesn't exist yet (will be created in Step 14).

If disabled: quit with message — *"GitHub Actions is disabled for this repo. Enable it at: https://github.com/OWNER/REPO/settings/actions"*

### 4. Required CLI tools present

```bash
which wrangler || node22 npx wrangler --version
node22 --version
```

Expected: wrangler accessible (via npx is fine), node22 resolves to Node 22+.

If missing: quit with message listing what's absent.

---

Once all checks pass, proceed to Step 1.

## STEP 1 — Scaffold the Project

Run in the current directory (do NOT cd into a subdirectory):

```bash
npx create-react-router@latest . --no-git-init --package-manager npm -y
```

This creates a Node.js-based React Router v7 app. You will convert it to Cloudflare Workers next.

## STEP 2 — Install Cloudflare Dependencies

```bash
npm install @react-router/cloudflare
npm install --save-dev wrangler @cloudflare/vite-plugin @cloudflare/workers-types
npm uninstall @react-router/node @react-router/serve
```

## STEP 3 — Remove Node.js Artifacts

```bash
rm -f Dockerfile .dockerignore
```

## STEP 4 — Create the Worker Entry Point

Create `workers/app.ts`:

```ts
// workers/app.ts
import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
```

## STEP 5 — Create the Server Entry

Create `app/entry.server.tsx`:

```tsx
// app/entry.server.tsx
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        if (shellRendered) {
          console.error(error);
        }
      },
    }
  );
  shellRendered = true;

  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
```

## STEP 6 — Configure Wrangler

Create `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "APP_NAME_PLACEHOLDER",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./workers/app.ts",
  "observability": {
    "enabled": true
  }
}
```

Replace `APP_NAME_PLACEHOLDER` with the actual app name (lowercase, hyphens only).

**Critical warnings:**
- Do NOT set `"main"` to `"./build/server/index.js"` — that file doesn't exist before the build. Point to the source: `./workers/app.ts`
- Do NOT add `"assets": { "binding": "ASSETS" }` — the vite plugin handles asset configuration automatically

## STEP 7 — Configure Vite

Replace `vite.config.ts` entirely:

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
```

**Note:** `cloudflare()` must come before `reactRouter()` in the plugins array.

## STEP 8 — Configure React Router

Replace `react-router.config.ts`:

```ts
// react-router.config.ts
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
```

`v8_viteEnvironmentApi: true` is required for the Cloudflare vite plugin integration.

## STEP 9 — Configure TypeScript

Replace `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.cloudflare.json" }
  ],
  "compilerOptions": {
    "checkJs": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true
  }
}
```

Create `tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.json",
  "include": ["vite.config.ts"],
  "compilerOptions": {
    "composite": true,
    "strict": true,
    "types": ["node"],
    "lib": ["ES2022"],
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler"
  }
}
```

Create `tsconfig.cloudflare.json`:

```json
{
  "extends": "./tsconfig.json",
  "include": [
    ".react-router/types/**/*",
    "app/**/*",
    "app/**/.server/**/*",
    "app/**/.client/**/*",
    "workers/**/*",
    "worker-configuration.d.ts"
  ],
  "compilerOptions": {
    "composite": true,
    "strict": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "types": ["vite/client"],
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "baseUrl": ".",
    "rootDirs": [".", "./.react-router/types"],
    "paths": {
      "~/*": ["./app/*"]
    },
    "esmoduleinterop": true,
    "resolveJsonModule": true
  }
}
```

## STEP 10 — Update package.json Scripts

Merge these into the `scripts` field in `package.json`:

```json
{
  "scripts": {
    "build": "react-router build",
    "dev": "react-router dev",
    "deploy": "npm run build && wrangler deploy",
    "preview": "npm run build && vite preview",
    "typecheck": "npm run cf-typegen && react-router typegen && tsc -b",
    "cf-typegen": "wrangler types",
    "postinstall": "npm run cf-typegen"
  }
}
```

`postinstall` runs `wrangler types` automatically after `npm install`/`npm ci`, generating `worker-configuration.d.ts`.

## STEP 11 — Update .gitignore

Replace `.gitignore` with:

```gitignore
.DS_Store
.env
/node_modules/

# React Router
/.react-router/
/build/

# Cloudflare
.dev.vars
.wrangler/
```

## STEP 12 — Update Home Route to Show Branding

Update `app/routes/home.tsx` to display a React Router v7 + Cloudflare Workers welcome page:

```tsx
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "React Router v7 + Cloudflare Workers" },
    { name: "description", content: "Welcome to React Router v7 on Cloudflare Workers!" },
  ];
}

export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 2rem" }}>
      <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>
        React Router v7
      </h1>
      <p style={{ fontSize: "1.25rem", color: "#666" }}>
        Running on Cloudflare Workers
      </p>
    </main>
  );
}
```

## STEP 13 — Verify the Build

```bash
npm run build
```

Both client and server builds must succeed. Output:
- `build/client/` — static assets
- `build/server/` — worker bundle + generated `wrangler.json`

Test locally with the Workers runtime:

```bash
npm run preview
```

Fix any errors before proceeding.

## STEP 14 — Set Up Git and GitHub

Check if git is already initialized:

```bash
git status
```

If not initialized:

```bash
git init
git add -A
git commit -m "feat: React Router v7 + Cloudflare Workers setup"
```

Ask the user for their GitHub repo URL (or use `gh repo create` to create one):

```bash
# Option A: use existing repo
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin main

# Option B: create a new GitHub repo
gh repo create APP_NAME --public --source=. --push
```

## STEP 15 — Check GitHub Secrets

Run the following to verify the required secrets exist:

```bash
gh secret list --repo OWNER/REPO
```

Look for:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

If either is missing, read the values from `~/.cloudflare/rj-web-solution-shared` (verified in Step 0) and set them automatically:

```bash
source ~/.cloudflare/rj-web-solution-shared
gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO --body "$CLOUDFLARE_API_TOKEN"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo OWNER/REPO --body "$CLOUDFLARE_ACCOUNT_ID"
```

These are shared credentials — no need to generate new tokens.

## STEP 16 — Create GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    name: Build & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run typecheck
      - run: npm run build

  deploy:
    name: Deploy
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

## STEP 17 — Commit and Push CI/CD Workflow

```bash
git add -A
git commit -m "feat: add GitHub Actions CI/CD for Cloudflare Workers"
git push
```

Show the user how to monitor the deployment:

```bash
gh run list
gh run view --log-failed  # if something failed
```

## STEP 18 — Ask About D1/R2

Ask the user:

> Do you want to set up Cloudflare D1 (SQLite database) or R2 (object storage)?
> - Type `d1` to add D1
> - Type `r2` to add R2
> - Type `both` to add both
> - Type `no` or press Enter to skip

### If D1 is requested:

```bash
# Create the D1 database
wrangler d1 create DB_NAME
```

Note the database ID from the output, then add to `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "DB_NAME",
      "database_id": "DATABASE_ID_FROM_OUTPUT"
    }
  ]
}
```

For local development, D1 is automatically simulated by wrangler's local mode (miniflare). No extra config needed — `wrangler dev` and `npm run preview` will use a local SQLite file at `.wrangler/state/v3/d1/`.

Update `worker-configuration.d.ts` types:

```bash
npm run cf-typegen
```

### If R2 is requested:

```bash
# Create the R2 bucket
wrangler r2 bucket create BUCKET_NAME
```

Add to `wrangler.jsonc`:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "BUCKET_NAME",
      "preview_bucket_name": "BUCKET_NAME-preview"
    }
  ]
}
```

For local development, R2 is automatically simulated by wrangler's local mode at `.wrangler/state/v3/r2/`.

```bash
npm run cf-typegen
```

## STEP 19 — Set Up Local Environment

Create `.dev.vars` for local secrets (git-ignored):

```bash
# .dev.vars — local development secrets (DO NOT commit)
# Add your local secrets here, e.g.:
# MY_SECRET=local_value
```

Remind user: `.dev.vars` is already in `.gitignore`. For CI/CD, add secrets via `gh secret set` or the GitHub UI.

If the user has a `.env` file for API tokens (multi-account wrangler setup):

```bash
# .env — project-level Cloudflare credentials (DO NOT commit)
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
```

**Security reminder:** Never commit `.env` or `.dev.vars`.

## STEP 20 — Test Locally

Run the local dev server (with HMR):

```bash
npm run dev
```

Or run with the actual Workers runtime (recommended for testing bindings):

```bash
npm run preview
```

Verify:
- App loads in browser
- No console errors
- If D1 added: test a simple query from a route loader
- If R2 added: test a simple put/get from a route

## STEP 21 — Test Remote Deployment

After CI/CD completes, verify the live URL:

```bash
# Get your worker URL
wrangler deployments list
```

Or check the GitHub Actions output for the deployed URL.

Visit `https://APP_NAME.SUBDOMAIN.workers.dev` and confirm the app is live.

To manually deploy without CI/CD:

```bash
npm run deploy
```

## Common Errors Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `main field doesn't point to an existing file` | `wrangler.jsonc` points `main` to build output | Set `"main": "./workers/app.ts"` (source file) |
| `Cannot use assets with a binding in an assets-only Worker` | `assets.binding` set without a `main` entry | Remove `binding` from assets; let vite plugin handle it |
| `Could not route to .../workers/services/... [code: 7003]` | Wrong `CLOUDFLARE_ACCOUNT_ID` | Verify Account ID in Cloudflare dashboard |
| `Authentication error [code: 10000]` | Wrong or expired `CLOUDFLARE_API_TOKEN` | Regenerate with "Edit Cloudflare Workers" template |
| `Could not determine server runtime` | Missing `entry.server.tsx` or `@react-router/cloudflare` | Ensure both exist |

## Final Project Structure

```
my-app/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── app/
│   ├── app.css
│   ├── entry.server.tsx       ← required for Cloudflare SSR
│   ├── root.tsx
│   ├── routes.ts
│   └── routes/
│       └── home.tsx
├── public/
│   └── favicon.ico
├── workers/
│   └── app.ts                 ← Cloudflare Worker entry point
├── .dev.vars                  ← local secrets (git-ignored)
├── .gitignore
├── package.json
├── react-router.config.ts
├── tsconfig.json              ← composite root
├── tsconfig.cloudflare.json   ← app + workers types
├── tsconfig.node.json         ← vite config types
├── vite.config.ts
├── worker-configuration.d.ts  ← auto-generated by `wrangler types`
└── wrangler.jsonc             ← Cloudflare Workers config
```
