# Social Signal System

## Roles

- Discovery: X, Xiaohongshu, Reddit, public Web community pages, GitHub Issues/Discussions, Hacker News, Stack Overflow, and other developer communities.
- Verification: official announcements, documentation, release notes, official GitHub Releases, regulators, and trusted media.

Social signals enter as leads, never as standalone facts:

```text
Raw signal → social evidence dedup → event clustering → claim extraction
→ primary/trusted verification → confidence and attention decision
```

## Evidence and deduplication

Social evidence uses a canonical claim fingerprint, canonical source URL when available, and an evidence chain ID. Reposts, copies, quotes, and repeated propagation increase `propagationCount`; they do not multiply independent evidence. Event-level independent evidence is computed from distinct evidence chains plus distinct non-social sources.

## Decisions

- `MUST_READ`: reliable, relevant, novel, and decision-changing.
- `WORTH_WATCHING`: an early, high-attention signal that is not fully verified.
- `LIBRARY_ONLY`: useful but not worth interrupting the user.
- `IGNORE`: duplicate, already known, low-value, unrelated, or unreliable.

Source Coverage reflects this run's execution, including successful results, successful zero results, unconfigured, unavailable, not searched, and failed sources.

## Zero-cost source behavior

- Public Web search can discover official pages, trusted media, and indexed public community pages. Indexing alone is discovery, not independent verification.
- GitHub Releases are queried without a user credential for mapped tracked entities and report their own execution outcome.
- Reddit search remains a discovery source and reports success, no-results, and failures independently.
- X being `not_configured` does not prevent GitHub, Reddit, Public Web, or optional local Xiaohongshu from contributing to the same research run.
- Imported public URLs remain a future discovery input; no separate UI or parallel pipeline is created until that input is wired to this same evidence flow.
