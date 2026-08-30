# Development Workflow

1. Inspect the relevant code, types, tests, and working tree before changing files.
2. For a regression: reproduce it, write a failing test, make the smallest fix, then verify.
3. For a feature: confirm scope, write an implementation plan, follow TDD, and preserve unrelated changes.
4. Keep credentials in runtime environment variables only. Never add tokens, cookies, sessions, passwords, or secrets to source, fixtures, documentation, prompts, logs, or Git.
5. Before completion run `npm run quality`, `npm run build`, and a secrets scan.

Do not rely on a specific coding agent. Product decisions, architecture, tests, and data contracts belong in the repository; Skills are optional workflow enhancements.
