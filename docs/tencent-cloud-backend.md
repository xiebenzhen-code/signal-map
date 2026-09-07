# Tencent Cloud Backend

Signal Map's full live research mode needs a server runtime for `/api/*`.

Recommended alpha deployment:

- Frontend: EdgeOne Pages or Drop
- Backend: Tencent CloudBase / cloud hosting
- Domain routing: `/api/*` or `api.example.com` points to the backend

Build and run:

```bash
npm run api:build
PORT=8787 node dist-api/server.mjs
```

Required server-only secrets:

```bash
X_BEARER_TOKEN=
```

Optional runtime configuration:

```bash
SIGNAL_MAP_ALLOWED_ORIGIN=https://your-frontend-domain.example
XHS_SERVICE_URL=http://127.0.0.1:18080
```

Do not put `X_BEARER_TOKEN`, cookies, sessions, browser profiles, or OAuth secrets in the frontend build, ZIP files, Git, or public logs.
