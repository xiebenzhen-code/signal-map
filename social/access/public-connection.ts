import type { ConnectionState, SocialProviderStatus } from "../providers/types.ts";

export type PublicConnectionStatus = {
  id: SocialProviderStatus["id"];
  label: string;
  state: ConnectionState;
  capabilities: string[];
  publicMessage?: string;
};

const messageByState: Record<ConnectionState, string | undefined> = {
  connected: undefined,
  login_required: "需要完成桌面连接器登录",
  not_configured: "当前未配置",
  unavailable: "当前暂不可用",
  error: "当前连接检查失败",
};

export function toPublicConnectionStatus(status: SocialProviderStatus): PublicConnectionStatus {
  return {
    id: status.id,
    label: status.label,
    state: status.state,
    capabilities: status.id === "x"
      ? ["公开信号发现", "只读"]
      : ["早期信号发现", "可选桌面连接器"],
    publicMessage: messageByState[status.state],
  };
}
