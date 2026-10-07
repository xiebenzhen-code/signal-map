type AuthErrorLike = { code?: string; message?: string; name?: string; status?: number; cause?: unknown };

export function mapAuthError(error: AuthErrorLike, action: "login" | "signup") {
  const code = String(error.code || "").toLowerCase();
  const message = String(error.message || "").toLowerCase();
  if (/user_already|email_exists|already registered/.test(`${code} ${message}`)) {
    return { status: 409, code: "user_exists", error: "该邮箱已注册，请直接登录。" };
  }
  if (/invalid_credentials|invalid login/.test(`${code} ${message}`)) {
    return { status: 401, code: "invalid_credentials", error: "邮箱或密码不正确。" };
  }
  if (/email_address_invalid|invalid email/.test(`${code} ${message}`)) {
    return { status: 400, code: "invalid_email", error: "邮箱格式无效，请检查后重试。" };
  }
  if (/weak_password|password/.test(code)) {
    return { status: 400, code: "password_policy", error: "密码不符合安全要求，请使用至少 6 位密码。" };
  }
  if (error.status === 429 || /rate_limit|over_email_send/.test(code)) {
    return { status: 429, code: "rate_limited", error: "尝试过于频繁，请稍后重试。" };
  }
  if (code === "email_not_confirmed") {
    return { status: 401, code, error: "邮箱尚未验证，请完成注册验证后登录。" };
  }
  if (code === "signup_disabled") {
    return { status: 403, code, error: "当前站点尚未开放注册。" };
  }
  const transportFailure = error.status === 0 && /fetch failed|failed to fetch|networkerror|network request failed|load failed|econn(?:refused|reset|timedout)|enotfound|etimedout/i.test(message);
  if ((error.status || 0) >= 500 || error.status === 0 || error.name === "AuthRetryableFetchError" || transportFailure) {
    return { status: 503, code: "provider_unavailable", error: "认证服务暂时不可用，请稍后重试。" };
  }
  return {
    status: action === "signup" ? 400 : 401,
    code: "auth_failed",
    error: action === "signup" ? "注册未完成，请检查填写内容。" : "登录未完成，请检查邮箱和密码。",
  };
}
