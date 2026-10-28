<!-- README_SYNC: source=p2n/stability-and-diagnosis-N4-working-tree; review-draft=v2; updated=2026-10-26 -->
<p align="center"><a href="./README.md">简体中文</a> · English</p>

# Signal Map

Start from a question, read public material, filter by date and relevance, and keep the source and the reason for each decision. Uncertain items go into "Possibly related" and are never treated as conclusions. When there is nothing to show, the app says why.

Built for independent developers and creators who need a first-pass judgment across a lot of public information.

**Highlights**

- **A research workflow with a budget and a deadline**: plans entities, time window and exclusions; fetching and processing run within an execution budget and deadline.
- **Safe public-web fetching**: public-address pre-checks, DNS results pinned to the validated address, per-hop redirect validation, and relay credentials sent only in same-origin headers, never in URLs.
- **UNCERTAIN routing, an "Unconfirmed" label and zero-result explanations**: uncertain material goes into a collapsed-by-default "Possibly related" group labeled "Unconfirmed", is excluded from formal results, and an empty display comes with a categorized reason.

[Trial site](https://signal.benzhenlab.com/) · [Report an issue](https://github.com/xiebenzhen-code/signal-map/issues)

**Status:** limited trial. This draft describes the local N4 candidate; whether the live site includes these changes depends on the release record. Other caveats are in [Known limitations](#known-limitations).

## Demo

The repository contains a real recorded demo video: [`signal-map-demo.mp4`](https://github.com/xiebenzhen-code/signal-map/blob/5142a6705b7cdb5f3b133d6a9567da9256019182/docs/portfolio/signal-map-demo.mp4) (1920×1080, about 50 s, no audio). Notes are in [`DEMO.md`](https://github.com/xiebenzhen-code/signal-map/blob/5142a6705b7cdb5f3b133d6a9567da9256019182/docs/portfolio/DEMO.md) (written in Chinese).

| Item | Detail |
|---|---|
| Recorded on / version | 2026-10-21; production domain, Sites53 + API019. Recorded before the N4 candidate, so it does **not** show the N4 "Possibly related" group or zero-result explanations |
| Question | Kdenlive maintenance updates in the past 30 days (release date, applicable version, official link) |
| Result | 20 items scanned, 18 signals aggregated, **0 displayed**; 5 detail fetches, 4 succeeded. Final answer quality for this question did not pass |
| Nature of footage | Real browser footage of one research submission; no fabricated candidates or counts; waiting segments sped up 2× |

There is no new recording or GIF for the N4 candidate, and no mock-up stands in for one. The N4 UI snapshots are static test fixtures, not production screenshots.

## Evaluation and engineering verification

These are two different kinds of evidence and do not substitute for each other.

### Human evaluation of effectiveness

**No human gold labels exist yet**, so there is no false-zero rate, miss rate, display precision or inter-annotator agreement to report. No user study shows that the tool reduces information anxiety.

- One historical domestic-AI run: 30 GeekPark and 5 36Kr items, 34 after deduplication, 2 signals returned. A single run shows neither sustained reliability nor correct answers.
- A compression ratio (items in vs. items shown) only reflects a change in count; on its own it proves neither effective filtering nor reduced anxiety.

### Software tests (local N4 candidate)

On 2026-10-26, on Node.js 24, `npm run quality`, `npm run build` and `npm run api:build` all exited 0 for the N4/N5 candidate (commit `cf16408`). The suite had **979 tests: 973 passed, 0 failed, 6 skipped** because of database-environment conditions. These are regression results, not coverage and not a production success rate.

- **D06 presentation-gate unit test**: a frozen Chrome RSS body yields 25 UNCERTAIN items; the other scores are controlled inputs used to exercise the two real presentation gates. Result: 0 formal results, 25 possibly related, original URLs preserved. This is not production end-to-end acceptance and does not measure filtering quality.
- Six static render snapshots of the UI component cover the six zero-result reasons, the collapsed default and the "Unconfirmed" label.

Evidence: `docs/verification/n4-closeout-20261026.md`. This document is a rewrite only; tests and product features were not re-run for it.

## Quick start

<!-- Pre-release: branch pushed (cf16408); test the commands below in a fresh clone and decide whether to pin with git switch --detach cf16408. -->

Running the app requires Node.js ≥ 22.13 (`package.json`); the full test suite (`npm test` / `npm run quality`) needs Node.js 24, because Node 22 does not support the `--test-isolation=none` flag the test script uses. You must supply your own authentication and database configuration. Real research runs may incur external-service charges; do not test against a production database.

<details open>
<summary>PowerShell</summary>

```powershell
git clone https://github.com/xiebenzhen-code/signal-map.git
Set-Location signal-map
git fetch origin
git switch --track origin/p2n/stability-and-diagnosis
npm ci
if (!(Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath .env.example -Destination .env.local
}
npm run api:build
```

Terminal 1 (API, default port 8080):

```powershell
node --env-file=.env.local dist-api/server.mjs
```

Terminal 2 (web app):

```powershell
$env:SIGNAL_MAP_FRONTEND_RUNTIME = "node"
$env:API_UPSTREAM_URL = "http://127.0.0.1:8080"
npm run dev -- --hostname 127.0.0.1 --port 3000
```

</details>

<details open>
<summary>bash</summary>

```bash
git clone https://github.com/xiebenzhen-code/signal-map.git
cd signal-map
git fetch origin
git switch --track origin/p2n/stability-and-diagnosis
npm ci
[ -e .env.local ] || cp .env.example .env.local   # keeps an existing file
npm run api:build
```

Terminal 1 (API, default port 8080):

```bash
node --env-file=.env.local dist-api/server.mjs
```

Terminal 2 (web app):

```bash
SIGNAL_MAP_FRONTEND_RUNTIME=node API_UPSTREAM_URL=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

</details>

Open http://127.0.0.1:3000. A page that loads does not mean authentication, the database or external sources are configured correctly. Database migration is a separate command (`npm run db:migrate`); run it only once you know which database it targets. Internal endpoints are not a stable public SDK.

## Architecture and model usage

```text
Question, time window and exclusions
  → Planning and budget
  → Safe fetching / RSS and Atom parsing
  → Dates, relevance, deduplication and signal aggregation
  → Formal results / Possibly related / Items awaiting judgment
  → Original text, per-source fetch status and filtering explanations
```

The web app uses React / vinext, a separate Node.js API handles requests, Supabase Auth handles authentication, and PostgreSQL stores account data. Deterministic code does most of the date validation, deduplication and safety checks.

**Model roles (from source)**

- **Planning**: produces a compact JSON research plan (at most 5 queries), merged with the deterministic plan and deduplicated.
- **Synthesis**: produces evidence-bound conclusions; factual conclusions must cite existing evidence IDs and are validated; if validation finds a problem, synthesis is retried at most once.
- **Configuration**: `MODEL_PROVIDER` (`openai` by default, or `deepseek`); planning and synthesis models are set by `OPENAI_MODEL` / `OPENAI_SYNTHESIS_MODEL` or `DEEPSEEK_MODEL` / `DEEPSEEK_SYNTHESIS_MODEL`; the per-request timeout is `MODEL_REQUEST_TIMEOUT_MS`, default 8000 ms.
- **Failure fallback**: if no key is configured, or a call times out, errors or returns invalid output, planning keeps the deterministic plan and synthesis uses the deterministic fallback. An unrecognized `MODEL_PROVIDER` yields a configuration error, and planning is also bounded by the remaining budget. Synthesis is normally skipped when there is no reliable evidence, but it can still run when an unresolved evidence conflict exists, so the conflict state is preserved.
- These are source defaults and configuration entry points, not the models used in production.

**Long-term memory**: saving account knowledge, wiring it into selection during research, and the real cross-run effect on result quality are three separate things. The first two are implemented and tested; the third has not been validated.

**Source catalog**: 18 static feeds plus 1 RSSHub relay enabled by configuration. The count is not the number of consistently available sources, nor of independent fact-checking organizations.

| Focus | Example sources | Current boundary |
|---|---|---|
| Chinese AI products and industry | GeekPark, 36Kr flash news | Current trial focus; single real fetch records exist, long-term stability is not shown |
| Film and creative software | Kdenlive, OBS, Krita | Covers release information for these tools only |
| E-commerce and developer tools | Shopify, WooCommerce, Node.js, GitHub, Chrome | Validation differs per source; developer announcements are not business-relevance conclusions |
| Tech, games and space | IT Home, SSPAI, InfoQ, OSChina, Gcores, NASA, etc. | Registered; this does not establish effectiveness in those fields |

- **GeekPark**: read through its official RSS endpoint; a media report is not automatically a confirmed fact.
- **36Kr flash news**: has a history of successful runs; reached through an independent RSSHub service behind an authenticated HTTPS gateway. **Current relay availability needs re-verification.** It returns only the latest 5 items and does not represent everything from the past 7 days.

## Known limitations

- **Status and release**: the local N4 candidate does not mean the live site is updated; historical deployment records do not show the version currently serving traffic, network configuration or diagnostic-endpoint state.
- **Evaluation**: no human gold labels; false-zero rate, miss rate and display precision are unknown. D06 is a presentation-gate unit test, not production acceptance.
- **Sources**: availability is uneven and differs per source; the 36Kr relay needs re-verification; new industries need suitable sources and separate acceptance.
- **Behavior change**: UNCERTAIN items no longer appear in formal results, so formal counts may drop while material moves to "Possibly related". A lower count should not be read as a regression or an improvement by itself.
- **Memory**: whether cross-run memory improves research quality has not been validated.
- **Runtime**: the production Dockerfile still uses Node.js 22; the full test script needs Node.js 24 and cannot run on Node 22.
- **Scope**: editorial topic selection and broad social-media collection are future directions, not delivered. Continuous autonomous operation is not promised; optional model features need separate configuration and may incur charges.
- **Demo**: the existing video was recorded before N4 and shows a zero-result case from the older version.

## Maintenance and license

The plan is to freeze a portfolio baseline after a controlled release and one browser re-check, then maintain it alongside a job search: log issues, validate on development branches, then decide whether to update the frozen version. No update schedule is promised.

The repository is public but has **no project-level `LICENSE`**; public source is not an open-source grant, and this draft claims neither MIT nor any other license. Third-party dependencies and assets keep their own terms. Please send sanitized versions, request IDs and expected behavior with issue reports, and never passwords, cookies or keys.
