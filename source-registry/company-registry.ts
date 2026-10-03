import type { CompanySourceProfile } from "./types.ts";
import { loadSourceExtensions, mergeCompanyRegistry } from "./config-loader.ts";

const defaultCompanySourceRegistry: CompanySourceProfile[] = [
  {
    company: "OpenAI",
    aliases: ["openai", "codex", "chatgpt"],
    domains: ["openai.com", "platform.openai.com", "help.openai.com"],
    changelogUrls: ["https://help.openai.com/en/articles/6825453-chatgpt-release-notes"],
    newsroomUrls: ["https://openai.com/news/"],
    docsUrls: ["https://platform.openai.com/docs"],
    githubOrgs: ["openai"],
  },
  {
    company: "Anthropic",
    aliases: ["anthropic", "claude", "claude code"],
    domains: ["anthropic.com", "docs.anthropic.com", "code.claude.com"],
    changelogUrls: ["https://code.claude.com/docs/en/changelog"],
    newsroomUrls: ["https://www.anthropic.com/news"],
    docsUrls: ["https://docs.anthropic.com"],
    githubOrgs: ["anthropics"],
  },
  {
    company: "Google DeepMind",
    aliases: ["google", "deepmind", "gemini"],
    domains: ["deepmind.google", "developers.googleblog.com", "ai.google.dev"],
    changelogUrls: ["https://ai.google.dev/gemini-api/docs/changelog"],
    newsroomUrls: ["https://deepmind.google/discover/blog/"],
    docsUrls: ["https://ai.google.dev/gemini-api/docs"],
    githubOrgs: ["google-gemini"],
  },
  {
    company: "Meta",
    aliases: ["meta", "llama"],
    domains: ["ai.meta.com", "about.fb.com"],
    changelogUrls: [],
    newsroomUrls: ["https://ai.meta.com/blog/"],
    docsUrls: ["https://llama.meta.com/docs/"],
    githubOrgs: ["facebookresearch", "meta-llama"],
  },
  {
    company: "Microsoft",
    aliases: ["microsoft", "copilot"],
    domains: ["microsoft.com", "learn.microsoft.com", "github.blog"],
    changelogUrls: ["https://learn.microsoft.com/en-us/copilot/release-notes"],
    newsroomUrls: ["https://news.microsoft.com/"],
    docsUrls: ["https://learn.microsoft.com/en-us/copilot/"],
    githubOrgs: ["microsoft"],
  },
  {
    company: "NVIDIA",
    aliases: ["nvidia", "cuda", "nemo"],
    domains: ["nvidia.com", "developer.nvidia.com"],
    changelogUrls: [],
    newsroomUrls: ["https://nvidianews.nvidia.com/"],
    docsUrls: ["https://docs.nvidia.com/"],
    githubOrgs: ["NVIDIA"],
  },
  {
    company: "Hugging Face",
    aliases: ["hugging face", "huggingface", "hf"],
    domains: ["huggingface.co"],
    changelogUrls: ["https://huggingface.co/blog"],
    newsroomUrls: ["https://huggingface.co/blog"],
    docsUrls: ["https://huggingface.co/docs"],
    githubOrgs: ["huggingface"],
  },
  {
    company: "DeepSeek",
    aliases: ["deepseek", "deep seek"],
    domains: ["deepseek.com", "api-docs.deepseek.com"],
    changelogUrls: ["https://api-docs.deepseek.com/quick_start/intro"],
    newsroomUrls: ["https://www.deepseek.com/"],
    docsUrls: ["https://api-docs.deepseek.com/"],
    githubOrgs: ["deepseek-ai"],
  },
  {
    company: "ComfyUI",
    aliases: ["comfyui", "comfy ui", "comfyanonymous"],
    domains: ["comfy.org"],
    changelogUrls: ["https://github.com/comfyanonymous/ComfyUI/releases"],
    newsroomUrls: [],
    docsUrls: ["https://docs.comfy.org/"],
    githubOrgs: ["comfyanonymous"],
  },
];

// Merge user-configured source extensions (source-registry/sources.json) into
// the default registry. Config is loaded once at module import time; changes
// require a restart or rebuild to take effect. Invalid or missing config
// falls back to defaults only.
const extensions = loadSourceExtensions();
export const companySourceRegistry: CompanySourceProfile[] = mergeCompanyRegistry(
  defaultCompanySourceRegistry,
  extensions.entities,
);
