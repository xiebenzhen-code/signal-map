# A6 Read and Try Implementation Plan

> **For agentic workers:** Follow this approved A6 specification task-by-task with red/green tests and independent final review.

**Goal:** Separate evidence-backed reading priority from immediate testability without changing numeric thresholds.
**Architecture:** Keep candidate scoring and bounds intact. Assign reading attention after candidate selection; attach independently qualified same-entity messages under one main card. Preserve child evidence and trace records while counting only main cards toward five.
**Tech Stack:** TypeScript, React, Node 24, existing frozen feed replay.
**Spec:** User A6 task, develop 8432322ebbd1771e6a67914bac55deb90e1cb731.

## Global Constraints
No deployment, online research, paid models, secrets, schema changes, history rewrite or master push. Existing numeric thresholds unchanged. Item-level evidence stays outside the repository in PRIVATE files. WORTH_WATCHING retains existing 24h gate; MUST_READ uses requested-window eligibility.

- [x] Freeze before-results for both existing complete snapshots and both plan modes.
- [x] RED: official no-entry reading, entity grouping, ineligible siblings, verification, window boundaries, five-main cap, testability ranking and collapsed rendering.
- [x] GREEN: actionability selection helper, pipeline wiring, additive typed child messages, accepted evidence/count accounting, card rendering.
- [x] Re-run frozen comparisons including nested dates; document any old assertion changes.
- [x] Independent review, quality/build/api:build, then local commit and closeout.
