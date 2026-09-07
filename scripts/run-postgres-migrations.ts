import {
  closePostgresPool,
  databaseConfigured,
  runRagCoreMigration,
} from "../backend/postgres.ts";

if (!databaseConfigured()) {
  console.error("DATABASE_URL is not configured. Migration was not run.");
  process.exitCode = 1;
} else {
  try {
    await runRagCoreMigration();
    console.log("PostgreSQL migrations completed.");
  } catch {
    console.error("PostgreSQL migration failed.");
    process.exitCode = 1;
  } finally {
    await closePostgresPool();
  }
}
