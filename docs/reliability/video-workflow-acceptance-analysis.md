# 阶段漏斗（本次请求）
- 来源原始结果 (scanned/raw admitted candidates): 12
- 聚合后事件 (events): 0
- 证据产生 (producedEvidence): 16
- 证据评估 (evaluatedEvidence): 16
- 证据通过 (acceptedEvidence): 0
- 证据拒绝 (rejectedEvidence): 16
- 最终页面展示 (signals): 0
- 正文补全: detailAttempted=5 detailSucceeded=5 detailFailed=0 stillInsufficient=1

# 拒绝原因分布 (rejectionReasons)
{
  "stale": 1,
  "duplicate": 0,
  "lowReliability": 0,
  "insufficientVerification": 0,
  "background": 0,
  "lowNovelty": 0,
  "unresolvedConflict": 0,
  "lowActionability": 0,
  "noInformationGain": 0,
  "insufficientContent": 6
}

# 逐 Provider 结果 (sourceOutcomes)
- primary-web-search | sourceType=PRIMARY | executed=true | resultCount=0 | requestCount=2
- company-registry | sourceType=OFFICIAL | executed=true | resultCount=0 | requestCount=1
- github-releases | sourceType=OFFICIAL | executed=false | resultCount=0 | requestCount=0
- official-update-pages | sourceType=OFFICIAL | executed=false | resultCount=0 | requestCount=0
- trusted-media | sourceType=INDEPENDENT_MEDIA | executed=false | resultCount=0 | requestCount=0
- industry-media | sourceType=INDEPENDENT_MEDIA | executed=false | resultCount=0 | requestCount=0
- public-web | sourceType=GENERAL_WEB | executed=true | resultCount=6 | requestCount=4
- product-hunt | sourceType=SOCIAL_SIGNAL | executed=true | resultCount=8 | requestCount=1
- hacker-news | sourceType=SOCIAL_SIGNAL | executed=true | resultCount=2 | requestCount=1
- huggingface | sourceType=GENERAL_WEB | executed=true | resultCount=0 | requestCount=1
- arxiv | sourceType=PRIMARY | executed=true | resultCount=0 | requestCount=1
- public-web | sourceType=SOCIAL_SIGNAL | executed=false | resultCount=0 | requestCount=0
- reddit | sourceType=SOCIAL_SIGNAL | executed=false | resultCount=0 | requestCount=0

# 逐 Provider 诊断 (sourceDiagnostics)
- product-hunt | raw=8 | normalized=8 | rejectedRaw=0 | admissionRejected={} | admitted=8 | enrichmentEligible=8 | displayed=0
- hacker-news | raw=2 | normalized=2 | rejectedRaw=0 | admissionRejected={} | admitted=2 | enrichmentEligible=2 | displayed=0
- huggingface | raw=0 | normalized=0 | rejectedRaw=0 | admissionRejected={} | admitted=0 | enrichmentEligible=0 | displayed=0
- company-registry | raw=0 | normalized=0 | rejectedRaw=0 | admissionRejected={} | admitted=0 | enrichmentEligible=0 | displayed=0
- product-hunt | raw=0 | normalized=0 | rejectedRaw=0 | admissionRejected=undefined | admitted=0 | enrichmentEligible=0 | displayed=0
- arxiv | raw=8 | normalized=8 | rejectedRaw=0 | admissionRejected={"TOPIC_MISMATCH":8} | admitted=0 | enrichmentEligible=0 | displayed=0
    sample: Point2Part: Unified 3D Partitioning from Point Prompts | stage=candidate_admission | reason=TOPIC_MISMATCH | urlPresent=true
    sample: Skill-Space Shooting for Autonomous Robot Policy Improvement | stage=candidate_admission | reason=TOPIC_MISMATCH | urlPresent=true
    sample: Imagine3D-LLM: Teaching MLLMs to Imagine 3D Scenes Before Answering | stage=candidate_admission | reason=TOPIC_MISMATCH | urlPresent=true

# 查询计划 (queryPlan)
```
{
  "requestedFreshnessWindow": "30d",
  "entities": [],
  "resolvedEntities": [],
  "topicAnchors": [
    "AI video editing",
    "automated rough cut",
    "multi-asset understanding",
    "shot selection",
    "batch processing",
    "commercial workflow"
  ],
  "topicKeywords": [
    "AI video editing",
    "automated rough cut",
    "multi-asset understanding",
    "shot selection",
    "batch processing",
    "commercial workflow",
    "AI 视频与创作者工具",
    "AI 视频工具 AI 模型 AI 产品",
    "多素材理解",
    "自动粗剪",
    "镜头选择",
    "批量处理和可商用工作流。"
  ],
  "topicProfile": {
    "domainAnchors": [
      "AI 视频与创作者工具",
      "AI 视频工具 AI 模型 AI 产品",
      "视频与创作者工具",
      "video",
      "视频工具"
    ],
    "taskAnchors": [
      "AI video editing",
      "automated rough cut",
      "multi-asset understanding",
      "shot selection",
      "batch processing",
      "多素材理解",
      "自动粗剪",
      "镜头选择",
      "批量处理和可商用工作流。"
    ],
    "genericTerms": [
      "ai",
      "artificial intelligence",
      "model",
      "models",
      "multimodal",
      "multi modal",
      "observation",
      "observations",
      "workflow",
      "automation",
      "research",
      "paper",
      "dataset",
      "method",
      "system"
    ]
  },
  "searchCombinations": [
    "AI video editing automated rough cut multi-asset understanding shot selection official changelog release notes latest",
    "AI video editing automated rough cut multi-asset understanding shot selection GitHub releases official announcement",
    "AI video editing automated rough cut multi-asset understanding shot selection product update documentation",
    "AI video editing product launch release",
    "automated rough cut multi-asset understanding workflow tool"
  ],
  "selectedSourceType": "PRIMARY",
  "allowedProviderIds": [
    "primary-web-search",
    "reverse-primary",
    "arxiv"
  ],
  "sourceSelectionReason": "PRODUCT_UPDATE + INITIAL 无明确实体，先使用 PRIMARY 发现候选，再用 OFFICIAL / PRIMARY 验证"
}
```

# 逐条筛选链路 (filteringDetails)
- decision=filtered | Launch HN: Mosaic (YC W25) – Agentic Video Editing
  expl: 内容太少，无法验证
  source: Hacker News | https://mosaic.so
- decision=filtered | Digital Nirvana Launches RoughCut AI Video Editing Platform
  expl: 内容太少，无法验证
  source: DuckDuckGo | https://digital-nirvana.com/news/digital-nirvana-launches-roughcut-ai-video-editing-platform/
  source: DuckDuckGo | https://chimneymedia.com/articles/digital-nirvana-debuts-roughcut-ai/
- decision=filtered | Automated AI Video Editing Workflows: The 2026 Guide
  expl: 内容太少，无法验证
  source: DuckDuckGo | https://resource.digen.ai/automated-ai-video-editing-workflows-2026/
- decision=filtered | AI Video Editing Software That Actually Works in 2026 (Full Demo)
  expl: 内容太少，无法验证
  source: DuckDuckGo | https://www.youtube.com/watch?v=grfIUCG3IHs
- decision=filtered | mer stories Events & webinars Ebooks & reports Business insights GitHub Skills S
  expl: 暂未满足展示条件
  source: Hacker News | https://github.com/palmier-io/palmier-pro
- decision=filtered | Selects by Cutback: AI Rough Cut for Video Editors
  expl: 内容太少，无法验证
  source: DuckDuckGo | https://cutback.video/blog/cutback-selects-ai-rough-cut-tool-for-video-editors-using-davinci-premiere-pro-final-cut
- decision=filtered | AutoKut - Revolutionary AI-Powered Video Editing
  expl: 内容太少，无法验证
  source: DuckDuckGo | https://autokut.com/
- decision=filtered | Product Hunt lists Lovable as a product discovery item.
  expl: 与当前问题主题不匹配
  source: Product Hunt | https://www.producthunt.com/products/lovable
  source: Product Hunt | https://www.producthunt.com/products/n8n-io
  source: Product Hunt | https://www.producthunt.com/products/attio
  source: Product Hunt | https://www.producthunt.com/products/posthog
  source: Product Hunt | https://www.producthunt.com/products/vapi
  source: Product Hunt | https://www.producthunt.com/products/granola
  source: Product Hunt | https://www.producthunt.com/products/raycast
  source: Product Hunt | https://www.producthunt.com/products/supabase

# 检索到的证据记录标题（evidenceRecords，最多 16 条）
total: 16
1. Hacker News | pub=2025-11-19T15:28:04.000Z | unverified
   url: https://mosaic.so/
   snippet: 正文提取不足，无法生成可验证事实。
2. DuckDuckGo | pub=未知 | partially_verified
   url: https://digital-nirvana.com/news/digital-nirvana-launches-roughcut-ai-video-editing-platform/
   snippet: 正文提取不足，无法生成可验证事实。
3. DuckDuckGo | pub=未知 | partially_verified
   url: https://chimneymedia.com/articles/digital-nirvana-debuts-roughcut-ai/
   snippet: 正文提取不足，无法生成可验证事实。
4. DuckDuckGo | pub=未知 | partially_verified
   url: https://resource.digen.ai/automated-ai-video-editing-workflows-2026/
   snippet: 正文提取不足，无法生成可验证事实。
5. DuckDuckGo | pub=未知 | partially_verified
   url: https://www.youtube.com/watch?v=grfIUCG3IHs
   snippet: 正文提取不足，无法生成可验证事实。
6. Hacker News | pub=2026-07-23T15:11:37.000Z | unverified
   url: https://github.com/palmier-io/palmier-pro
   snippet: GitHub - palmier-io/palmier-pro: macOS video editor built for AI · GitHub Skip to content Navigation Menu Sign in Appearance settings Platfo
7. DuckDuckGo | pub=未知 | partially_verified
   url: https://cutback.video/blog/cutback-selects-ai-rough-cut-tool-for-video-editors-using-davinci-premiere-pro-final-cut
   snippet: 正文提取不足，无法生成可验证事实。
8. DuckDuckGo | pub=未知 | partially_verified
   url: https://autokut.com/
   snippet: 正文提取不足，无法生成可验证事实。
9. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/lovable
   snippet: Product Hunt lists Lovable as a product discovery item.
10. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/n8n-io
   snippet: Product Hunt lists n8n as a product discovery item.
11. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/attio
   snippet: Product Hunt lists Attio as a product discovery item.
12. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/posthog
   snippet: 正文提取不足，无法生成可验证事实。
13. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/vapi
   snippet: 正文提取不足，无法生成可验证事实。
14. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/granola
   snippet: 正文提取不足，无法生成可验证事实。
15. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/raycast
   snippet: 正文提取不足，无法生成可验证事实。
16. Product Hunt | pub=未知 | unverified
   url: https://www.producthunt.com/products/supabase
   snippet: 正文提取不足，无法生成可验证事实。

# filteringSummary 概览
{
  "retrievedCount": 16,
  "clusteredCount": 8,
  "displayedCount": 0,
  "summaryText": "检索到 16 条信息，聚合为 8 个信号；当前主要因6 条 内容太少，无法验证、1 条 时间较旧，没有达到展示门槛的可靠新信号。"
}

# failures
- Primary Sources: 扩展查询未命中可识别的监管文件、公司 IR 或官方公告，已继续搜索可信媒体。
- Trusted Media: Reuters、Bloomberg、FT、WSJ、CNBC 索引未返回匹配结果。
- Primary Sources: 扩展查询未命中可识别的监管文件、公司 IR 或官方公告，已继续搜索可信媒体。
- Trusted Media: Reuters、Bloomberg、FT、WSJ、CNBC 索引未返回匹配结果。
- Result: 四级来源均未返回与扩展关键词相关的资料；建议加入公司名、人物名、产品名或监管机构名后重试。