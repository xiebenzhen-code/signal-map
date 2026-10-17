# Signal Map Product Principles

Signal Map is an evidence-first personal information filter, not a search engine, news feed, social feed, or recommendation feed.

- Filter first; summarize second.
- Personal Knowledge State determines novelty and relevance. Engagement history does not.
- Evidence comes before AI interpretation. A claim without reliable evidence cannot be presented as fact.
- Freshness is the time since an event occurred or was published. Novelty is what is new to this user; they are independent.
- Social and community sources discover early claims. Official sources, documentation, official GitHub Releases, regulators, and trusted media verify them. GitHub Issues/Discussions remain discovery signals.
- Unverified does not mean useless. A high-value early signal may be Worth Watching, but cannot be promoted to a fact.
- Attention Saved is more important than engagement created. Today contains only the smallest set of important changes.
- `MUST_READ = 0` does not mean no information exists. Today presents Must Read first, then Worth Watching; only if both are empty can it show at most two fresh, novel, evidence-qualified `LIBRARY_ONLY` peripheral changes. This is presentation selection, never a new attention decision or an engagement feed.
- Source coverage reports what was actually searched, unavailable, unconfigured, skipped, or failed. It never treats an unsearched source as empty.
