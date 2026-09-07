import { localBrowserAdapter } from "../connections/xiaohongshu/local-browser-adapter.ts";
import { officialOAuthAdapter } from "../connections/xiaohongshu/official-oauth-adapter.ts";
import type {
  SocialProvider,
  XiaohongshuConnectionAdapter,
} from "./types.ts";

function connection(): XiaohongshuConnectionAdapter {
  return process.env.XHS_CONNECTION_ADAPTER === "oauth"
    ? officialOAuthAdapter
    : localBrowserAdapter;
}

export const xiaohongshuProvider: SocialProvider = {
  id: "xiaohongshu",
  label: "Xiaohongshu",
  search: ({ industry }) => connection().search(industry),
  getPost: (id) => connection().getPost(id),
  getProfile: (id) => connection().getProfile(id),
  getConnectionStatus: () => connection().getConnectionStatus(),
};
