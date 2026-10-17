import { xProvider } from "../providers/x.ts";
import { xiaohongshuProvider } from "../providers/xiaohongshu.ts";
import { SocialAccessLayer } from "./social-access-layer.ts";

export const socialAccessLayer = new SocialAccessLayer([xProvider, xiaohongshuProvider]);
