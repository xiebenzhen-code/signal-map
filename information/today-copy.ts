export function todayResultCopy(displayedCount: number, retrievedCount: number) {
  if (displayedCount > 0) {
    return {
      headline: `今天只需阅读 ${displayedCount} 条。`,
      supporting: "只保留可能改变你判断、且有证据支持的新变化。",
    };
  }
  if (retrievedCount > 0) {
    return {
      headline: "今天没有需要你关注的新变化。",
      supporting: `检索到 ${retrievedCount} 条，但都未通过验证（内容不足 / 可信度不够）。`,
    };
  }
  return {
    headline: "今天没有需要你关注的新变化。",
    supporting: "本次已完成来源检查，暂未找到足够证据支持的新变化。",
  };
}
