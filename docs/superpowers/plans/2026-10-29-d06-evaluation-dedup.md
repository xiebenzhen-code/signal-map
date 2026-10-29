# D06 evaluation and candidate identity implementation plan

Goal: replay complete frozen and rebuilt plans separately, correct result counters, retain distinct same-title releases. No relevance or date-rule changes.

Architecture: an internal debug-only frozen plan injection preserves the full QueryPlan; execution allowlisting remains separate. Candidate deduplication uses normalized URL identity with title/date fallback. Reports distinguish formal attention, library and uncertain groups.

- [ ] Evaluation commit: failing offline script contract test; add internal plan replay; two-mode JSON/Markdown; verify fixture canaries and zero network/model calls.
- [ ] Dedup commit: red D06 Oct13/Oct15 regression plus same-URL control; minimum identity change; replay and compare all 25 source entries.
- [ ] Documentation commit: bilingual D06 wording, date-path source evidence and residual risks; validate local links.
- [ ] Node24 quality/build/api:build, record separate exits and database skips; review exact diff; normal push develop and remote readback.

Evidence is stored outside the repository under the sibling d06-eval-dedup-repair-20261029 directory. Each commit is independently revertible; no deployment or live research.
