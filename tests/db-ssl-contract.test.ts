// RED tests for the database SSL config contract (offline: fictional connection
// strings, constructed pg.Client, NEVER connect()).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";

import { resolveDriverSsl, buildPoolOptions, createPostgresPool } from "../backend/postgres.ts";

const { Client } = pg;

const savedEnv = { ...process.env };

function withEnv(seed: Record<string, string | undefined>, run: () => void) {
  const original = { ...process.env };
  for (const key of Object.keys(seed)) {
    if (seed[key] === undefined) delete process.env[key];
    else process.env[key] = seed[key]!;
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(seed)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key]!;
    }
  }
}

const FICTIONAL_URL = "postgres://user:secret@db.example.test:6543/db";

// ---- Task 1: TLS on + no CA path → explicit config error, never rejectUnauthorized:false ----

test("RED 1: TLS enabled without POSTGRES_CA_PATH is a configuration error, not rejectUnauthorized:false", () => {
  withEnv({ POSTGRES_CA_PATH: undefined, POSTGRES_SSL: undefined, PGSSLMODE: undefined }, () => {
    assert.throws(
      () => resolveDriverSsl({ connectionString: FICTIONAL_URL, ssl: true }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /POSTGRES_CA_PATH/, "the error must name the missing CA path setting");
        assert.doesNotMatch(message, /rejectUnauthorized:\s*false/, "the error must not suggest disabling validation");
        return true;
      },
    );
  });
});

test("RED 1b: pool construction with TLS-on/no-CA also fails (no silent rejectUnauthorized:false pool)", () => {
  withEnv({ POSTGRES_CA_PATH: undefined, POSTGRES_SSL: undefined, PGSSLMODE: undefined }, () => {
    assert.throws(
      () => buildPoolOptions({ connectionString: FICTIONAL_URL, ssl: true }),
      /POSTGRES_CA_PATH/,
    );
  });
});

// ---- Task 2: unreadable/invalid CA keeps hard failure ----

test("RED 2a: an unreadable CA file still fails hard", () => {
  withEnv({ POSTGRES_CA_PATH: "certs/does-not-exist.pem" }, () => {
    assert.throws(
      () => resolveDriverSsl({ connectionString: FICTIONAL_URL, ssl: true }),
      /POSTGRES_CA_PATH/,
    );
  });
});

test("RED 2b: an invalid CA PEM still fails hard", () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-map-ca-"));
  const file = join(dir, "bad.pem");
  writeFileSync(file, "this is not a certificate");
  try {
    withEnv({ POSTGRES_CA_PATH: file }, () => {
      assert.throws(
        () => resolveDriverSsl({ connectionString: FICTIONAL_URL, ssl: true }),
        /INVALID_CA|POSTGRES_CA_PATH/,
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Task 3: explicit SSL config vs connection-string conflict → reject, never driver override ----

test("RED 3a: app TLS object vs URL sslmode=disable is a rejected conflict (no silent driver override)", () => {
  withEnv({ POSTGRES_CA_PATH: undefined }, () => {
    // The old behavior: pg merges connectionString params OVER the app ssl object,
    // ending with driver ssl=false. The contract: refuse loudly at config time.
    assert.throws(
      () => resolveDriverSsl({ connectionString: `${FICTIONAL_URL}?sslmode=disable`, ssl: true }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /sslmode|SSL/i, "the error must describe the SSL conflict");
        // The message must not leak the connection string or credentials.
        assert.doesNotMatch(message, /postgres:\/\//, "error must not contain the connection string");
        assert.doesNotMatch(message, /secret/, "error must not contain credentials");
        return true;
      },
    );
  });
});

test("RED 3b: app ssl=false vs URL sslmode=require is a rejected conflict (no silent TLS re-enable)", () => {
  withEnv({ POSTGRES_CA_PATH: undefined }, () => {
    assert.throws(
      () => resolveDriverSsl({ connectionString: `${FICTIONAL_URL}?sslmode=require`, ssl: false }),
      /sslmode|SSL/i,
    );
  });
});

test("RED 3c: the conflict error message stays redacted (no connection string, no credentials)", () => {
  withEnv({ POSTGRES_CA_PATH: undefined }, () => {
    try {
      resolveDriverSsl({ connectionString: "postgres://alice:hunter2@db.example.test:6543/db?sslmode=disable", ssl: true });
      assert.fail("expected a conflict error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.doesNotMatch(message, /postgres:\/\//);
      assert.doesNotMatch(message, /hunter2/);
      assert.doesNotMatch(message, /alice/);
      assert.match(message, /sslmode/i);
    }
  });
});

test("RED 3d: pool options inherit the conflict rejection", () => {
  withEnv({ POSTGRES_CA_PATH: undefined }, () => {
    assert.throws(
      () => buildPoolOptions({ connectionString: `${FICTIONAL_URL}?sslmode=disable`, ssl: true }),
      /sslmode|SSL/i,
    );
  });
});

// ---- Task 4: verify the DRIVER-effective config via constructed pg.Client (no connect) ----

test("RED 4: a valid TLS+CA config yields a driver ssl object with rejectUnauthorized=true and the CA", () => {
  // Repo CA fixture: a real parseable PEM chain (offline; no network use).
  withEnv({ POSTGRES_CA_PATH: "certs/supabase-ca.pem" }, () => {
    const options = buildPoolOptions({ connectionString: FICTIONAL_URL, ssl: true });
    // Construct a driver Client from the SAME option shape (no connect()).
    const client = new Client(options as never);
    assert.equal(typeof client.ssl, "object", "driver ssl must be a TLS object");
    const driverSsl = client.ssl as unknown as { rejectUnauthorized: boolean; ca?: string };
    assert.equal(driverSsl.rejectUnauthorized, true, "driver must enforce certificate validation");
    assert.ok(driverSsl.ca?.includes("BEGIN CERTIFICATE"), "driver must carry the CA chain");
    assert.notEqual(client.ssl, false, "driver ssl must not be disabled");
  });
});

test("RED 4b: disabled SSL yields driver ssl=false exactly (no empty TLS object from the URL)", () => {
  withEnv({ POSTGRES_CA_PATH: undefined }, () => {
    const options = buildPoolOptions({ connectionString: FICTIONAL_URL, ssl: false });
    const client = new Client(options as never);
    assert.equal(client.ssl, false, "driver must see an explicit ssl=false");
  });
});

// ---- Task 5: probe and pool share the same rule ----

test("RED 5: the diagnostic probe path resolves SSL through the same rules (no separate code path)", async () => {
  const { readDatabaseConfig } = await import("../backend/postgres.ts");
  withEnv({ DATABASE_URL: FICTIONAL_URL, POSTGRES_SSL: "true", POSTGRES_CA_PATH: undefined }, () => {
    const config = readDatabaseConfig();
    assert.ok(config);
    assert.throws(
      () => resolveDriverSsl(config),
      /POSTGRES_CA_PATH/,
      "probe and pool share resolveDriverSsl, so the no-CA error must fire there too",
    );
  });
});

test("pool construction is deterministic and offline (no connect() in these tests)", () => {
  // Guard: ensure the Pool built for config purposes is never connected by this suite.
  withEnv({ DATABASE_URL: undefined }, () => {
    assert.throws(() => createPostgresPool(), /PostgreSQL is not configured/);
  });
});
