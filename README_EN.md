<!-- README_SYNC: source=develop@e7d1b2b; updated=2026-10-28 -->
<p align="center"><a href="./README.md">简体中文</a> · English</p>

# Signal Map

An information-filtering and decision-support tool for independent developers and creators. Start with a specific question, read public sources, filter by date and relevance, and keep the original links and the reasons behind each filtering decision. Uncertain material goes into a "Possibly related" group, and an empty result comes with an explanation.

[Try the app](https://signal.benzhenlab.com/) · [Report an issue](https://github.com/xiebenzhen-code/signal-map/issues)

![Stage](https://img.shields.io/badge/status-limited_trial-2457ff)
![Language](https://img.shields.io/badge/language-TypeScript-3178c6)
![Runtime](https://img.shields.io/badge/local_checks-Node.js_24%2B-43853d)
![Repository](https://img.shields.io/badge/repository-public-2ea44f)

[Watch the roughly 50-second live demo](docs/portfolio/signal-map-demo.mp4) · [Recording method and outcome](docs/portfolio/DEMO.md)

> The recording is from 2026-10-21 and corresponds to Sites53 + API019. It shows behaviour at that time and cannot be used as evidence for later versions.

![Signal Map architecture and validation boundaries](docs/portfolio/signal-map-architecture.png)

**Status: limited trial, preparing a frozen portfolio baseline.** The repository remains public. This text describes the `develop` branch. What is live depends on the release records; the latest code on GitHub is not necessarily what is running online.

## Why

More information has not made decisions easier. Repeated reporting, speculation and promotion arrive together, and reading more can make it harder to decide what to trust and what deserves attention.

Signal Map tries to make that process inspectable: define the question, gather material, filter by time and relevance, and keep the original text available for checking. The goal is to reduce low-value intake and support judgment. No user study yet shows that this goal has been reached.

## Highlights

- **Question-led retrieval:** turn entities, time windows and exclusions into a plan, then execute it within a budget and a deadline.
- **Safe fetching:** public-address checks, pinned connection addresses, per-hop redirect validation and TLS verification. Relay credentials travel in same-origin headers, never in URLs.
- **Uncertainty as a first-class state:** uncertain material goes into a "Possibly related" group that is closed by default and labelled unconfirmed. It does not count as a formal result. An empty display comes with one of six reasons.
- **Honest execution records:** searched, not searched and failed sources are recorded separately. Failures keep bounded error codes. Publication time is never mixed with retrieval time.
- **Evaluation in progress:** human gold labels do not exist yet, so false-zero rate and display precision are not published.

This is a bounded research workflow, not an autonomous agent. Deterministic code handles dates, deduplication, filtering and safety checks.

## Capabilities and evidence

| Capability | Evidence | Not yet done |
|---|---|---|
| Source reading and filtering | Limited real reads, deterministic tests, execution logs | Cross-industry coverage, sustained availability, answer quality |
| Uncertain-material routing | Gate unit test: a frozen D06 Chrome RSS body yields 25 UNCERTAIN items, 0 formal results and 25 possibly related; static render snapshots ([n4-closeout](docs/verification/n4-closeout-20261026.md)) | Live-page verification; human labels to check whether the folded group hides must-read items |
| Zero-result reasons and coverage notices | Per-source read notices and six zero-result reasons, with unit tests and render snapshots | Live-page verification |
| Diagnostic-endpoint token gate | Unconfigured returns 404; missing token or session returns 401; red-then-green tests (`tests/backend-server.test.ts`) | Not deployed; production still has the old behaviour |
| Account record persistence | Test-account save, sign-out and sign-in read-back, new record visible in the browser | More accounts and devices |
| Account switching in one browser | Local draft isolation repair `130009a` with local counter-examples ([record](docs/verification/local-account-isolation-repair-20261021.md)) | A→B→A page check after deployment |
| Long-term memory affecting research | Account storage and memory-selection wiring exist; automatic use is off by default | Whether memory improves research; new evidence that contradicts an old conclusion is stored only as evidence and does not update the knowledge layer |
| Proactive tracking and reminders | Scheduling and notification code exists | Not a verified production commitment |

## Sources and scope

The [source catalog](source-registry/feed-catalog.ts) registers **18 static feeds plus 1 configuration-gated RSSHub relay, 19 in total, 10 of them official publishers** (counted by script from the catalog). Registered, successfully read and factually reliable are three different states; the count is not the number of sources that are reliably available. Each run selects all feeds matching the entity or topic, without the former three-feed cap; exclusions, source-type restrictions and relay configuration gates still apply.

| Area | Example sources | Current boundary |
|---|---|---|
| Domestic Chinese AI products and industry | GeekPark, 36Kr flashes | Current trial focus; single real reads on record, sustained reliability not shown |
| Film and creative software | Kdenlive, OBS, Krita | Tool releases only, not the whole film industry |
| E-commerce and developer tools | Shopify, WooCommerce, Node.js, GitHub, Chrome | Availability differs by channel; developer notices are not business conclusions |
| Tech, games and space news | IT Home, SSPAI, InfoQ, OSChina, Gcores, NASA and others | Registered only; no claim of effectiveness across these areas |

GeekPark is read from its own RSS endpoint; media claims still need evidence checks. 36Kr flashes come through an independent RSSHub server behind an authenticated HTTPS gateway and currently return only the latest 5 items, **so they do not represent the past 7 days**. The relay's current availability still needs to be re-checked. Historical cloud reads are in [other-feeds-cloud-probe-20261021.md](docs/verification/other-feeds-cloud-probe-20261021.md). New areas need suitable sources and separate acceptance.

## Architecture

```text
Question, time window and exclusions
  → Planning and budget
  → Safe fetching / RSS and Atom parsing
  → Dates, relevance, deduplication and aggregation
  → Formal results / Possibly related / Observation material
  → Original sources, acquisition status and filtering explanations
```

Web: React / vinext. API: a separate Node.js process. Authentication: Supabase Auth. Account data: PostgreSQL. Main endpoints: `POST /api/signals`, `POST /api/research/plan`, `/api/research/stream`, `/api/control/knowledge`, `POST /api/sources/check`. They are internal endpoints, not a stable public SDK.

**Model usage:** planning and synthesis are two optional model calls, configured through environment variables (see [.env.example](.env.example)). A planning timeout falls back to a deterministic plan (`agent/runner.ts`). Retrieval, filtering, deduplication, date handling and safety checks do not depend on a model. According to the maintainer's production configuration report as of 2026-10-28, no model keys are currently configured, so planning and synthesis follow deterministic paths (production configuration was not queried again for this update).

**Test isolation:** tests use frozen snapshots through injected request and address-resolution functions. They make no real network calls and do not depend on the current time.

## Verification and evidence

For the file contents of `develop` commit `e7d1b2b`, `quality`, `build` and `api:build` each exited 0 on Node.js 24.21.0: **1035 tests, 1029 passed, 0 failed, 6 skipped because the database test environment is absent**. Evidence: [develop gate record](docs/verification/develop-e7d1b2b-gates-20261028.md). Lint reports no errors but still has existing warnings. Skips do not count as passes; these figures are neither coverage nor production success rates.

The D06 check uses a frozen Chrome RSS body; the remaining scores are controlled so that the real display gates can be isolated. It shows the display contract, not a production end-to-end run or a quality benchmark.

A historical domestic AI run retrieved 30 GeekPark and 5 36Kr items, deduplicated them to 34 and returned 2 signals. A single run establishes neither sustained reliability nor answer correctness.

### A failure the demo does not hide

On 2026-10-21, a Kdenlive maintenance-update question on the live site retrieved 20 items, aggregated 18 signals and displayed 0. The reads ran, but the original question was not answered, so answer quality did not pass. The [historical demonstration and limitations](https://github.com/xiebenzhen-code/signal-map/blob/5142a6705b7cdb5f3b133d6a9567da9256019182/docs/portfolio/DEMO.md) keep that result and do not claim that all current features are validated.

**Version note:** the latest release record that can be checked in this repository is Sites53 + API019 ([api-repair-release-20261021.md](docs/verification/api-repair-release-20261021.md)). API 027 was released according to [api027-release-manual-20261026.md](docs/verification/api027-release-manual-20261026.md), but its live acceptance record is not in the repository, so this text cites no 027 demo or figures.

## Known limitations

This section collects the current boundaries so that "implemented" is not read as "verified".

- **Effects are unproven.** Reduced information anxiety and better judgment are goals without user-study evidence. The tool cannot guarantee that information is true.
- **No human gold labels yet.** False-zero rate, display precision and miss rate cannot be computed. Whether the "Possibly related" group hides must-read items can only be answered after labelling.
- **False rejections remain a known problem.** An empty result means no displayable evidence this run, not that nothing changed.
- **Cross-language matching is weak.** A Chinese constraint against English body text is often judged uncertain.
- **Coverage is limited.** There is no promise of full-web coverage, an answer every time, continuous autonomous monitoring or a mature public SDK.
- **Some channels have not recovered.** Chrome / FeedBurner timeouts and WooCommerce address-check rejections have no recovery evidence; the 36Kr relay's current availability is unverified.
- **Memory limits.** "A record is visible" does not mean "it affected the research". New evidence that contradicts an old conclusion is stored only in the evidence layer and does not update the knowledge layer.
- **Account isolation is not re-verified online.** The local multi-account draft isolation is repaired, but the live-site check is pending. Do not store sensitive drafts on a shared device.
- **Some changes are not live yet.** The uncertain-material group, zero-result reasons and the diagnostic token gate exist in code and tests; deployment and page checks are pending.
- **Editorial topic selection and broad social-media collection** are future directions, not delivered capabilities.
- **There is no project-level `LICENSE`.** No open-source or commercial licence is granted. Third-party dependencies and fonts keep their own terms.

## Local setup

Node.js 24+ is recommended. The package declares a minimum of 22.13.0, but the full test suite uses Node.js 24. The production Dockerfile still uses Node.js 22 and has not been upgraded.

PowerShell:

```powershell
git clone https://github.com/xiebenzhen-code/signal-map.git
Set-Location signal-map
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

bash:

```bash
git clone https://github.com/xiebenzhen-code/signal-map.git
cd signal-map
npm ci
cp -n .env.example .env.local
```

Edit `.env.local` first. Authentication needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; account persistence needs your own `DATABASE_URL` and matching tables; models and optional channels are configured as needed. Run `npm run db:migrate` only against a database dedicated to development. Real research may call external services and incur model or cloud charges. Do not test against a production database, and never commit `.env.local`, passwords, cookies or keys.

Start the API in the first terminal (default port 8080):

```bash
npm run api:build
node --env-file=.env.local dist-api/server.mjs
```

Start the Web app in the second terminal:

```powershell
$env:SIGNAL_MAP_FRONTEND_RUNTIME = "node"
$env:API_UPSTREAM_URL = "http://127.0.0.1:8080"
npm run dev -- --hostname 127.0.0.1 --port 3000
```

```bash
SIGNAL_MAP_FRONTEND_RUNTIME=node API_UPSTREAM_URL=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open http://127.0.0.1:3000 . A running page does not establish that authentication, the database or external sources work. Address and Origin checks stay enabled; do not turn them off to work around network problems.

## Tests

```bash
npm run quality
npm run build
npm run api:build
```

The 6 conditionally skipped tests do not count as passes. The number of tests is neither coverage nor a count of real user studies. The repository has a manually triggered [end-to-end workflow](.github/workflows/signal-map-agent-loop-e2e.yml) that needs a dedicated test environment; the file's existence is not evidence that CI passes.

## Maintenance, data and feedback

The plan is to freeze a portfolio baseline after a controlled deployment and one page-level acceptance run, then keep maintaining on development branches while job hunting: record issues, verify improvements, then decide whether to update the frozen version. No release schedule is promised. Next priorities are human evaluation, source reliability, false rejections and the actual value of memory.

Server-side account records and local drafts are separate paths. The latest source binds a separate IndexedDB store to each account and keeps the anonymous legacy store; history without an owner is not assigned to a signed-in account automatically.

More records: [README fact check](docs/verification/readme-evidence-20261022.md) · [Editable architecture SVG](docs/portfolio/signal-map-architecture.svg) · [OBS / Kdenlive cloud reads](docs/verification/other-feeds-cloud-probe-20261021.md) · [Formal domain and demo delivery](docs/verification/formal-portfolio-delivery-20261021.md)

Report issues through [Issues](https://github.com/xiebenzhen-code/signal-map/issues) with sanitized request IDs, times, versions and expected behaviour. Never include passwords, cookies or keys.
