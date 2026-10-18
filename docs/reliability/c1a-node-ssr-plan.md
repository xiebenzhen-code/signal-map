# C1a Node SSR implementation plan

Goal: run the unchanged frontend using installed vinext's native Node production server.
Architecture: select the Node plugin path explicitly; retain default Sites build. Keep API ownership and API_UPSTREAM_URL unchanged. Separate frontend Dockerfile from the API image.
Baseline: e15eabea03fd4c49c31261ea3fb03d5a7b9695d2. Work only in the migration worktree. No dependency or lockfile changes, no commit/push/deployment, no real research/auth/database access.

- [ ] Protect original directory/index, archive and migration source hashes before changes.
- [ ] Add behavior tests loading real Vite configuration: Node plugin selection, default build preservation, invalid target rejection. Observe red in network=none Linux container.
- [ ] Change vite.config.ts to defer Sites/hosting/Cloudflare consumption to legacy branch. Add scripts/frontend-node.mjs and build:node/start:node scripts; register tests.
- [ ] Add Dockerfile.frontend using existing locked Linux dependencies and native vinext build/start. Keep API Dockerfile unchanged.
- [ ] Run quality, api:build, legacy build, Node build in proved network=none containers; test production Node22 start, HTML/routes/resources and unavailable-upstream behavior.
- [ ] Browser QA only after proving browser external traffic blocked. If unsupported, record incomplete, never navigate in an unisolated browser.
- [ ] Compare all protected source files/lockfile/archive/original directory and write c1a-node-ssr-report.md. Remove only this round's test containers.

Rollback: select existing build/start scripts and discard only reviewed C1a changes in migration worktree; never reset original worktree or frozen tag.
