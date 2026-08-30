# Signal Map Engineering Workflow

Before multi-file changes, review `package.json`, affected types, existing tests, and `git status`.

- Regressions: use `systematic-debugging` before proposing a fix.
- Medium or larger changes: confirm design, then use `writing-plans`.
- Non-trivial implementation: use `test-driven-development`; observe red before production code.
- Social signal research: follow `social-signal-research` and preserve provenance.
- Qodo rules: use only when configured; never fabricate unavailable organization rules.
- Completion: use `verification-before-completion`, then run `npm run quality` and `npm run build`.
- Preserve unrelated working-tree changes and avoid UI or pipeline rewrites unless explicitly requested.
