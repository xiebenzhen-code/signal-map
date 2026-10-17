// Counterexamples for the SSL connection-config precedence and failure
// semantics. Pure-config tests: no real database connection, no network.
// env is a seeded record so these tests are hermetic.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDriverSsl, buildPoolOptions } from "../backend/postgres.ts";

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

test("RED: an explicit config.ssl=false must not be overridden by POSTGRES_SSL=true", () => {
  withEnv({ POSTGRES_SSL: "true" }, () => {
    const option = resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: false });
    assert.equal(option, false, "explicit ssl:false must win over the env switch");
  });
});

test("RED: a disabled SSL config must yield an explicit false (URL sslmode cannot sneak in)", () => {
  withEnv({ POSTGRES_SSL: "false" }, () => {
    const option = resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: false });
    assert.equal(option, false);
    const poolConfig = buildPoolOptions({ connectionString: "postgres://u:p@h/db", ssl: false });
    assert.equal(poolConfig.ssl, false, "driver ssl must be explicitly false, not undefined");
  });
});

test("config.ssl=true with a CA path enables certificate validation", () => {
  withEnv({ POSTGRES_CA_PATH: "certs/supabase-ca.pem" }, () => {
    const option = resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: true });
    assert.equal(typeof option, "object");
    assert.equal((option as { rejectUnauthorized: boolean }).rejectUnauthorized, true);
    assert.ok((option as { ca?: string }).ca && (option as { ca: string }).ca.includes("BEGIN CERTIFICATE"));
  });
});

test("config.ssl=true without a CA path is a configuration error (contract: never rejectUnauthorized:false)", () => {
  withEnv({ POSTGRES_CA_PATH: undefined }, () => {
    assert.throws(
      () => resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: true }),
      /POSTGRES_CA_PATH/,
    );
  });
});

test("RED: an unreadable CA file must fail hard, not silently disable validation", () => {
  withEnv({ POSTGRES_CA_PATH: "certs/does-not-exist.pem" }, () => {
    assert.throws(
      () => resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: true }),
      /POSTGRES_CA_PATH/,
    );
  });
});

test("RED: an invalid CA PEM must fail hard, not silently disable validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-map-ca-"));
  const file = join(dir, "bad.pem");
  writeFileSync(file, "this is not a certificate");
  try {
    withEnv({ POSTGRES_CA_PATH: file }, () => {
      assert.throws(
        () => resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: true }),
        /INVALID_CA|POSTGRES_CA_PATH/,
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the app pool options always carry the resolved ssl (same rule set, no silent URL sslmode)", () => {
  withEnv({ POSTGRES_SSL: "false", POSTGRES_CA_PATH: undefined }, () => {
    const poolConfig = buildPoolOptions(readConfigLike());
    assert.equal(poolConfig.ssl, false);
  });
});

function readConfigLike() {
  return {
    connectionString: "postgres://u:p@h/db",
    ssl: process.env.PGSSLMODE === "require" || process.env.POSTGRES_SSL === "true",
  };
}

test("TLS is never configured to fall back to plaintext: enabled requires a CA (error otherwise), disabled an explicit false", () => {
  withEnv({ POSTGRES_CA_PATH: undefined }, () => {
    assert.throws(
      () => resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: true }),
      /POSTGRES_CA_PATH/,
      "enabled TLS without a CA must not silently degrade to unvalidated",
    );
  });
  assert.equal(resolveDriverSsl({ connectionString: "postgres://u:p@h/db", ssl: false }), false);
});