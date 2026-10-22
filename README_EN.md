<!-- README_SYNC: source=eb6666d5a46c1cf42647840a7601c211e2c7e12e; updated=2026-10-22 -->
<p align="center"><a href="./README.md">简体中文</a> · English</p>

# Signal Map

An information-filtering tool for independent developers and creators: research a specific question across public sources, filter by date and relevance, and make evidence gaps visible.

[Star to bookmark](https://github.com/xiebenzhen-code/signal-map/stargazers) · [Try the app](https://signal.benzhenlab.com/) · [Report an issue](https://github.com/xiebenzhen-code/signal-map/issues)

![Stage](https://img.shields.io/badge/status-limited_trial-2457ff)
![Language](https://img.shields.io/badge/language-TypeScript-3178c6)
![Runtime](https://img.shields.io/badge/local_checks-Node.js_24%2B-43853d)
![Repository](https://img.shields.io/badge/repository-private-596473)

**Limited trial.** The repository is currently private and requires access to clone. It does not display unverifiable Star counts, CI-success badges or license badges.

[Watch the roughly 50-second live demo](docs/portfolio/signal-map-demo.mp4) · [Recording method and outcome](docs/portfolio/DEMO.md)

![Signal Map architecture and validation boundaries](docs/portfolio/signal-map-architecture.png)

## Why this tool exists

Following a product takes more than finding articles. You also need to know whether a source answers your question, fits the time window, or repeats information you already have.

Signal Map implements a bounded workflow:

- **Question-led retrieval:** turn entities, time windows and exclusions into a plan, then execute within budgets and deadlines.
- **Evidence processing:** read official updates, RSS/Atom feeds and configured channels; check dates and task relevance, deduplicate and aggregate events. Publication time stays distinct from retrieval time.
- **Execution visibility:** distinguish searched, not searched and failed sources. Later unexecuted rounds do not erase earlier history; bounded error codes retain diagnostic detail.
- **Explicit evidence gaps:** a run may return nothing, which does not prove nothing changed. False rejection by relevance rules remains a known problem.

Useful for following particular products, creative tools and public technical developments. It does not promise whole-web coverage, an answer every time, continuous autonomous monitoring, or a mature public SDK.

## Sources and domain coverage

The [source catalog](source-registry/feed-catalog.ts) registers **17 feeds, including 11 official publishers**. Each run selects at most three feeds by entity or topic, alongside existing search paths. Registration, successful reading and factual credibility are separate claims.

| Area | Registered sources | Scope |
|---|---|---|
| Film and creative software | Kdenlive, OBS, Krita | Software releases and tool changes, not the entire film industry |
| E-commerce and independent stores | Shopify, WooCommerce | Developer updates do not establish merchant policy or applicability by themselves |
| Programming and open source | Node.js, GitHub, Mozilla, Chrome | Reachability and validation differ by channel |
| AI products | OpenAI | Not comprehensive AI-industry coverage |
| Chinese-language media and communities | IT之家, 少数派, 机核, 阮一峰, InfoQ, 开源中国 | Articles still need original-source, date and task-relevance checks |
| Space and astronomy | NASA | A readable feed does not make every item relevant |

Historical cloud read-and-parse evidence exists for seven sources: IT之家, 少数派, NASA, Shopify, Krita, OBS and Kdenlive. This is not an uptime guarantee. The latest recorded Chrome/FeedBurner timeouts and WooCommerce address-preflight rejection have no confirmed recovery. AI-plus-education lacks sufficient dedicated sources and domain acceptance evidence.

## Implementation and validation status

Web: React / vinext. API: Node.js. Authentication: Supabase Auth. Account persistence: PostgreSQL.

```text
Question, time window and exclusions
  -> Retrieval planning / budgets / deadline
  -> Source reading / address checks / RSS or Atom parsing
  -> Date and task relevance / deduplication / evidence aggregation
  -> Today, Information and Library views
```

Endpoints include `POST /api/signals`, `POST /api/research/plan`, `/api/research/stream`, `/api/control/knowledge`, and `POST /api/sources/check`. These are internal product interfaces, not a stable public SDK. `sources/check` currently reads in page mode and does not replace Feed-mode acceptance.

| Capability | Existing evidence | Still outstanding |
|---|---|---|
| Source reading and filtering | Selected real-source probes, deterministic tests and execution logs | Broad domain coverage, sustained reachability and answer quality |
| Account persistence | Test-account API save, sign-out/sign-in read-back and browser rendering of the new record | Wider account, device and scope acceptance |
| Same-browser account switching | Local-draft isolation fix `130009a` and local counterexamples | Post-deployment A→B→A browser verification |
| Login navigation | Committed code and tests send authenticated `/control` visits home | Verification on the updated formal site |
| Memory influencing research | Storage and selection wiring exists; automatic participation is off by default | End-to-end cross-run influence validation |
| Proactive tracking and reminders | Scheduler and notification code exists | Not claimed as an accepted production capability |

At this documentation checkpoint, the last recorded formal deployment is **Sites53 + API019**. The update containing `130009a` and fixture-clock correction `eb6666d` remains recorded as blocked. **The newest GitHub code is not necessarily running online.**

### A demo that keeps the failure visible

On 2026-10-21, a real Kdenlive maintenance-update query scanned 20 items, aggregated 18 signals and displayed zero. Reading executed, but the question did not receive its requested answer: answer-quality acceptance failed. The recording preserves that outcome. It uses actual browser-frame capture, waiting sections at 2× speed and no audio; it is not native high-frame-rate continuous screen recording.

## Run locally

Use **Node.js 24+** for the documented checks. The package minimum is 22.13.0, but the full test command needs a newer runtime; the recorded gate used Node.js 24. Commands use PowerShell. Repository access is required.

```powershell
git clone --branch fix/stability-closeout-20261019 https://github.com/xiebenzhen-code/signal-map.git
Set-Location signal-map
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Edit your local copy of [.env.example](.env.example) first. Authentication needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; account persistence needs your own `DATABASE_URL` and matching database tables. Configure models and optional channels as needed. `npm run db:migrate` is the migration entry point; use only a dedicated development database you control.

Real research can contact external services and incur model or cloud charges. Do not test against a production database or commit `.env.local`, passwords, cookies or keys. Opening a local page does not validate authentication, database access or external sources.

Start the API in the first terminal; the default port is 8080:

```powershell
npm run api:build
node --env-file=.env.local dist-api/server.mjs
```

Start the Web app in a second terminal. Native Node mode avoids requiring a hosted-platform identity:

```powershell
$env:SIGNAL_MAP_FRONTEND_RUNTIME = "node"
$env:API_UPSTREAM_URL = "http://127.0.0.1:8080"
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open the [local app](http://127.0.0.1:3000). Requests proxy to the local API; account services still require valid configuration. Production proxying and source readers retain address and Origin checks; do not disable protections to work around connectivity problems.

## Tests and engineering records

```powershell
npm run quality
npm run build
npm run api:build
```

The latest recorded gate corresponds to `eb6666d`: **912 tests, 906 passed, zero failed, six skipped because the database test environment was absent**. Quality/build exited 0. The gate includes typecheck, lint, knip and dependency checks; lint retains 28 existing warnings. These are historical execution records, not checks rerun for this README edit. Test counts are not coverage percentages or real-user research counts.

The manually triggered [end-to-end workflow](.github/workflows/signal-map-agent-loop-e2e.yml) requires a dedicated test environment. Its existence is not evidence of a passing CI run.

- [README evidence record](docs/verification/readme-evidence-20261022.md)
- [Editable architecture SVG](docs/portfolio/signal-map-architecture.svg): status annotations reflect its recording date.
- [API019 release and diagnostics](docs/verification/api-repair-release-20261021.md)
- [OBS / Kdenlive cloud reads](docs/verification/other-feeds-cloud-probe-20261021.md)
- [Formal-domain and demo delivery](docs/verification/formal-portfolio-delivery-20261021.md)
- [Local-account isolation repair record](docs/verification/local-account-isolation-repair-20261021.md)

## Data, license and feedback

Server account records and browser drafts are separate paths. The latest source binds each account to distinct IndexedDB storage and preserves the anonymous legacy store. Unowned historical data is not automatically assigned to a signed-in account. Online acceptance is still outstanding; do not keep sensitive drafts on shared devices. Seeing a saved record does not prove it influenced research.

There is no project-level `LICENSE`. No MIT, open-source or commercial-use license is claimed here. Third-party dependencies and fonts have their own licenses.

For a reproducible [Issue](https://github.com/xiebenzhen-code/signal-map/issues), share a redacted request ID, timestamp, version and expected behavior, never credentials. If the project is useful as a reference, [Star to bookmark](https://github.com/xiebenzhen-code/signal-map/stargazers). Repository access remains unchanged.
