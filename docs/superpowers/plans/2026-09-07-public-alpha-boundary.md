# Public Alpha Boundary Implementation Plan

**Goal:** Repair existing account boundaries before deploying and evaluating Signal Map at https://signal.benzhenlab.com.

**Architecture:** Reuse Supabase SSR sessions and the existing handlers/repositories. Keep Guest Demo local and reject guest identity on private APIs. Preserve all research and scoring rules.

**Tech Stack:** Next App Router via vinext, Supabase SSR, PostgreSQL, Node tests.

**Spec:** Current user request: public deployment and backend-evidence acceptance, not localhost acceptance.

## Constraints

- Never deploy the previously exposed database/model credentials. Rotation and hosting access must be confirmed externally.
- No public signup, Magic Link work, new Agent capabilities, UI redesign, or scoring changes.
- Existing uncommitted work stays intact. No automatic Git commits.

## 1. Auth request boundary

Files: auth/session.ts, backend/handlers.ts, backend/node-server.ts, app/control/page.tsx, tests/auth-tenant-boundary.test.ts, tests/control-plane.test.ts.

- [ ] Write regressions asserting `resolveAuthContext(new Request('https://signal.benzhenlab.com/api/control/goals?guest=true')) === null`, signup rejection, invalid-session fail-closed, and cookie login/restore/logout.
- [ ] Run the tests and observe the current failures.
- [ ] Replace legacy synthetic identity with verified Supabase identity; persist/refresh session cookies through response headers. All private endpoints require verified identity. Default filters are user-scoped.
- [ ] Use the same cookie session on every Control request. Remove signup and private Guest controls; clear old data on logout or invalid session.
- [ ] Repeat tests with two controlled Auth transport fixtures and cross-filter access attempts. These are unit/integration tests, not public account acceptance.

## 2. Build and deployment gate

- [ ] Run quality, build, api:build; inspect output for server secrets without printing values.
- [ ] Confirm rotated secrets, hosting project/DNS authority, and two precreated test accounts via secure configuration.
- [ ] Deploy only a server-capable runtime with production secrets server-side; configure domain and Supabase Site URL without weakening auth.

## 3. Public acceptance

- [ ] Capture public HTTP/browser availability and session refresh/logout.
- [ ] Execute A/B isolation checks on private data and RAG retrieval.
- [ ] Execute three research rounds and retain sanitized plans, retrieval, sources, comparisons, writes and attention evidence.
- [ ] Report each requested capability PASS/PARTIAL/FAIL, distinguishing code findings from public execution evidence. Missing environment access is a blocker, never a passing result.
