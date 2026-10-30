# Sensitive Data Scanner - Project Plan

Oct 30, 2026 · @Naftali

A small full-stack web app, built in TypeScript, that scans text for sensitive data and uses an LLM to judge the unclear cases, so you can show Cyera-relevant, working code that exercises the JS topics they will ask about.

## Goal and scope

**What it does.** You paste or upload text. The server finds likely sensitive items with fast rules (emails, phone numbers, card numbers, API keys, ID-like numbers). For ambiguous snippets it asks an LLM to classify them and explain why. The page shows the text with highlights, a risk summary, and results streaming in as they finish.

**What it proves in the interview.**

- You can ship TypeScript, Node and React end to end, not just talk about them.
- You understand async in practice: concurrency limits, retries, cancellation, streaming, and keeping the event loop free.
- You can use an LLM responsibly: bounded cost, evaluated output, no real sensitive data sent out.

**In scope.**

- One page UI, one API, one background worker thread, one LLM provider.
- Synthetic sample data only, clearly stated in the UI and README.
- A small labeled test set with a precision and recall number.
- A public URL and a README with an architecture diagram.

**Out of scope (deliberately).** User accounts, a database, multi-tenant anything, file types beyond plain text and CSV, and any real customer data. Cutting these keeps the project near 12 hours and leaves time to practice explaining it.

**Time budget.** About 12 hours of building and 2 hours of rehearsal. Infra is held to about 1 hour because the section "Infra on autopilot" automates it.

## Capabilities

Each feature is chosen because it forces you to use one interview topic for real; the right column is what you can say about it.

| # | Capability | What it does | Interview topic it practices |
| --- | --- | --- | --- |
| 1 | Rule-based scan | Regex and checksum rules (for example Luhn for cards) find candidates fast | Keeping the event loop free; regex backtracking risk |
| 2 | Worker thread scan | Large input is scanned in a `worker_threads` worker, not on the main thread | Threads vs event loop, message passing |
| 3 | LLM classification | Ambiguous snippets go to the LLM with a strict JSON output schema | Promises, error handling, structured output |
| 4 | Concurrency limit | At most N LLM calls in flight (a small `mapLimit` or `p-limit`) | Bounded concurrency, rate limits |
| 5 | Retry with backoff | Transient failures retry with exponential backoff, then give up cleanly | `async/await`, `try/catch`, `sleep` |
| 6 | Streaming results | Findings stream to the browser as they finish (Server-Sent Events) | Async iteration, long-lived connections |
| 7 | Cancel button | `AbortController` stops the request and the in-flight LLM calls | Cancellation, cleanup |
| 8 | Highlighted results UI | React page with highlights, filters, loading and error states | Hooks, effect cleanup, race conditions |
| 9 | Input validation | Request schema validation and a body size limit | Backend hygiene, TypeScript types at the boundary |
| 10 | Evaluation script | Runs the scanner against a labeled set and prints precision and recall | Not trusting LLM output without measuring it |
| 11 | Privacy guard | Redacts or masks obvious secrets before anything is sent to the LLM; logs never contain input text | Security mindset (Cyera's domain) |

**Minimum viable version.** Capabilities 1, 3, 8 and 9. Everything else is added in the order above only if time allows; 2, 6 and 7 are the most valuable for the interview, so do those before 10.

## Tech stack

One language (TypeScript) and one deployable unit: the Node server also serves the built React files, so there is one URL, no CORS setup, and one thing to host.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict mode) | The "typed JS" most teams expect; one language front and back |
| Runtime | Node.js 24 LTS | Matches the role (Node/TypeScript backend); see Infra for the version pin |
| Server framework | Express | The most recognized Node framework in interviews; easy to explain middleware (compare with servlet filters) |
| Validation | Zod | Runtime validation that also gives you TypeScript types |
| Frontend | React + Vite | The role asks for React; Vite gives a fast dev server and a simple production build |
| Streaming | Server-Sent Events (SSE) | Simple one-way streaming over plain HTTP, no extra library |
| Parallel work | `worker_threads` (built in) | Shows real thread usage without extra dependencies |
| Concurrency limit | `p-limit` (or your own `mapLimit` from the mock questions) | Writing your own is a stronger interview story |
| LLM access | One provider's official SDK (Anthropic API or Azure OpenAI, your choice; see open decisions) | You already used Azure OpenAI at work, so either is a credible story |
| Tests | Vitest | Same config as Vite, quick to set up |
| Lint and format | ESLint + Prettier | Standard; run in CI |
| Package manager | npm | Zero extra setup |

**Repo layout.**

```text
scanner/
  server/          Express API, SSE, worker, LLM client
  web/             React app (Vite)
  eval/            labeled samples and the precision/recall script
  Dockerfile       builds web, then runs server
  .github/workflows/ci.yml
  README.md        what it is, diagram, how to run, trade-offs
```

## Architecture

&#91;embedded content: architecture · 4 parts, 1 container\]

Text goes in over HTTP and findings stream back; CPU-heavy scanning is handed to a worker thread so the event loop stays free, and LLM calls are capped and retried. The highlighted box is the one to be able to explain in the interview.

## Infra on autopilot

A Node app is just a long-running process that listens on a port; all the "infra" is packaging it, giving it a URL, and redeploying when you push code. The plan below makes the tools do all of that, so you write about 4 small config files once and then only run `git push`.

**Decision: host it as one Docker container on Render.** You connect your GitHub repo once; Render builds the Dockerfile and redeploys on every push to `main`, gives you an HTTPS `onrender.com` URL, and shows logs in a dashboard.

| Option | Setup effort | Fits this project? | Verdict |
| --- | --- | --- | --- |
| Render (Docker web service) | Lowest: connect repo, set one secret | Yes: long-lived connections (SSE) and worker threads just work in a normal container | **Use this** |
| Serverless functions (Vercel, Netlify) | Low | Awkward: request time limits and no long-lived background threads suit this app badly | Skip |
| Railway or Fly.io | Low to medium | Yes, similar idea | Reasonable alternative; not checked here |
| AWS EC2 or ECS | High: networking, TLS, deploy pipeline | Yes | Skip for time. You have EC2 experience at work, so say that in the interview if asked "why not AWS?" |

**Free tier trade-off.** From the guides I found, Render's free plan puts a web service to sleep after 15 minutes without traffic, and the first request afterwards takes roughly 30 to 60 seconds. Fine for development; for the days around your interview, either use a paid always-on plan (check current price on Render) or open the URL a few minutes before you demo.

**What gets automated, and by what.**

| Task | How it is automated | Written once in |
| --- | --- | --- |
| Install, build, run identically everywhere | Multi-stage Docker image: build the React app, then run the Node server that serves it | `Dockerfile` |
| Create the service and its settings | Render Blueprint (infrastructure as code) | `render.yaml` |
| Redeploy on every push | Render auto-deploy from GitHub | Render settings (on by default) |
| Lint, typecheck, test, build on every push and PR | GitHub Actions | `.github/workflows/ci.yml` |
| Secrets (LLM API key) | Environment variable in Render's dashboard, never in git | `.env.example` lists names only |
| Health check and restarts | `GET /health` returns 200; Render restarts the service if it fails | `render.yaml` + one route |
| Logs | Write to stdout; read them in Render | nothing to set up |

**Rules the app must follow so hosting just works.**

- Read the port from `process.env.PORT` and listen on `0.0.0.0`, not `localhost`.
- Keep all secrets in environment variables; commit `.env.example` and add `.env` to `.gitignore`.
- Pin the Node version in one place (`.nvmrc` and the Dockerfile base image) to a current LTS: Node 24 is LTS now, and Node 26 is scheduled to reach LTS in October 2026, per the [Node.js releases page](https://nodejs.org/about/releases/).
- The public URL can spend your LLM credit, so add: a max input size, a per-IP rate limit, and a monthly spend cap on the LLM key.
- Use synthetic data only; the page should say so.

**Let Claude Code write the boring files.** You already list it as a skill. Once the app runs locally, ask it to generate the four files above from this plan and read what it produced before committing. A prompt you can paste is in the next section.

## Build, run and publish

From an empty folder to a live URL. Steps 1 to 3 are one-time setup; after that, shipping is `git push`.

**Accounts and tools you need.** Node 24 (install with `nvm`), Git, a GitHub account, a Render account (sign in with GitHub), and an API key for your chosen LLM provider. Docker Desktop is optional: it only lets you test the production image on your own machine.

1. **Create the project skeleton.**

```bash
mkdir scanner && cd scanner && git init
npm create vite@latest web -- --template react-ts
mkdir server && cd server && npm init -y
npm i express zod
npm i -D typescript tsx vitest @types/node @types/express
```

2. **Run it locally while developing.** Two terminals: `npm --prefix server run dev` (uses `tsx watch` so the server restarts on save) and `npm --prefix web run dev` (Vite dev server; proxy `/api` to the Node server in `vite.config.ts`). The LLM key goes in a local `.env` file that is git-ignored.
3. **Ask Claude Code to generate the infra files** from this plan (prompt below), then read them.
4. **Run the production build locally once** (optional, needs Docker):

```bash
docker build -t scanner .
docker run --rm -p 3000:3000 -e PORT=3000 -e LLM_API_KEY=your-key scanner
```

Open `http://localhost:3000`; the Node server should serve the React app and `/health` should return 200.

5. **Publish.** Create an empty GitHub repo, then `git add . && git commit -m "first version" && git push -u origin main`. In Render choose New, then Blueprint, pick the repo, enter `LLM_API_KEY` when asked, and deploy. Open the `onrender.com` URL and check `/health`.
6. **From now on:** `git push` runs CI in GitHub Actions and Render redeploys automatically. Put the live URL and the repo link at the top of the README and on your CV.

**Prompt to paste into Claude Code** (adjust names as needed):

```text
Read PLAN.md. The app is a TypeScript monorepo with /server (Express) and /web (Vite React).
Create: (1) a multi-stage Dockerfile on node:24-slim that builds web and server, then runs
node server/dist/index.js with only production deps; (2) a .dockerignore; (3) render.yaml for a
Docker web service named scanner with healthCheckPath /health and LLM_API_KEY as a secret
(sync: false); (4) .github/workflows/ci.yml that runs on push and pull_request: checkout, setup-node 24,
install both packages, lint, typecheck, test, build; (5) .env.example with variable names only and
a .gitignore that excludes .env and node_modules. The server must read PORT from the environment,
listen on 0.0.0.0, serve web/dist as static files in production, and expose GET /health.
Explain each file in two lines. Do not commit any secret.
```

**Expected shape of the Dockerfile** (so you can sanity-check what Claude Code writes):

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm --prefix web ci && npm --prefix web run build
RUN npm --prefix server ci && npm --prefix server run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
CMD ["node", "server/dist/index.js"]
```

**Expected shape of `render.yaml`:**

```yaml
services:
  - type: web
    name: scanner
    runtime: docker
    plan: free
    healthCheckPath: /health
    envVars:
      - key: LLM_API_KEY
        sync: false
```

**If something fails.** Build errors show in Render's build logs, runtime errors in its runtime logs. The three usual causes: the server listens on a fixed port instead of `PORT`, a dev dependency is needed at runtime, or the static path to `web/dist` is wrong inside the container. Paste the log into Claude Code and ask for the fix.

## Milestones and definition of done

Each milestone ends with something you can run. Hours are estimates for a developer new to this stack; infra is deliberately a small slice.

| # | Milestone | Done when | Est. hours |
| --- | --- | --- | --- |
| 0 | Save this plan as `PLAN.md` in the repo; create the skeleton | Both dev servers start | 0.5 |
| 1 | Rule-based scan API (capabilities 1, 9) | `POST /api/scan` returns findings for sample text; invalid input is rejected | 1.5 |
| 2 | LLM classification with concurrency cap and retry (3, 4, 5) | Ambiguous snippets get a label and reason; failures don't crash the request | 2 |
| 3 | React page (8) | Paste text, see highlights, loading and error states | 2 |
| 4 | Streaming and cancel (6, 7) | Results appear one by one; Cancel stops the server work | 2 |
| 5 | Worker thread (2) | A large input is scanned without freezing other requests (test by hitting `/health` during a scan) | 1.5 |
| 6 | Deploy (infra section) | Live `onrender.com` URL; a push redeploys | 1 |
| 7 | Evaluation and privacy guard (10, 11), README with diagram | Precision and recall printed; README explains trade-offs | 1.5 |
| 8 | Rehearse the 3-minute walkthrough out loud | You can explain every file and answer "what would you change for production?" | 2 |

**Definition of done.**

- Live URL and repo link work, and the app says it uses synthetic data only.
- You can explain, without notes, why the worker thread and the concurrency limit exist.
- The README has an architecture diagram, how to run it, and a short "what I'd do next" list (database, auth, queue, observability).
- No secret is in git history.

**If you run out of time.** Stop after milestone 4 plus deploy. A smaller project you fully understand is worth more than a bigger one you can't explain.

## Open decisions

Four choices change the plan; my default is in the second column, so you can ignore any you don't care about.

| Decision | Default | Change it if |
| --- | --- | --- |
| Interview date | Unknown, so plan for the full 12 build hours | It is under a week away: stop after milestone 4 plus deploy |
| LLM provider | Whichever key you already have; Azure OpenAI gives you the strongest "I've used this at work" story | You prefer one provider's SDK or pricing |
| Server framework | Express | You want built-in schema validation and speed: Fastify, at the cost of being less familiar to interviewers |
| Repo visibility | Public, with no secrets and synthetic data only | You'd rather share it privately on request |

**Sources and caveats.** Node release status comes from the [Node.js releases page](https://nodejs.org/about/releases/) (Node 24 LTS; Node 26 due to enter LTS in October 2026). The Render details (15-minute sleep on the free plan, roughly 30 to 60 second wake-up, Blueprint file, Docker build, auto-deploy on push) come from third-party guides found in search, such as [this Render deploy guide](https://docs.openclaw.ai/platforms/render); confirm current plans and prices on Render's own pages before relying on them.
