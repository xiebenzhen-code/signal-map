"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { goalStatusLabel, resumeConditionLabel, userFacingLabel, userFacingReason, verificationStatusLabel } from "@/lib/user-facing-labels";

type ControlGoal = {
  id: string;
  objective: string;
  status: string;
  completedCriteria: string[];
  remainingCriteria: string[];
  waitingOrBlockedReason?: string;
  nextCheckAt?: string;
  watch?: {
    resumeCondition?: { type: string; reason: string; target: string };
    watchStatus: string;
    lastCheckedAt?: string;
    nextCheckAt?: string;
    consecutiveNoChangeCount: number;
    lastCheckOutcome?: string;
    schedulerFailureCount?: number;
  };
};

type NotificationItem = {
  id: string;
  attention: string;
  deliveryAction: string;
  status: string;
  unread?: boolean;
  readAt?: string;
  createdAt: string;
  deliveredAt?: string;
  relatedGoalId?: string;
  relatedRevisionId?: string;
  relatedEvidenceIds: string[];
};

type KnowledgeItem = {
  id: string;
  type: string;
  currentValue: string;
  updatedAt: string;
  revision: { previousRevision?: number; currentRevision?: number; revisionReason?: string };
  provenance: { verificationStatus?: string; reliabilityScore?: number; sourceAgentRunId?: string };
  supportingEvidence: Array<{ id: string; publisher: string; sourceUrl: string; verificationStatus: string }>;
};

type AgentRunItem = {
  id: string;
  userQuery?: string;
  status?: string;
  rounds?: number;
  selectedStrategies: string[];
  selectedSources: Array<{ selectedSourceType?: string }>;
  evidenceCount: number;
  knowledgeChanges: unknown[];
  finalAttention: string[];
  startedAt?: string;
  completedAt?: string;
  trace: Array<{ state: string; action: string; result: string; reason?: string; timestamp: string }>;
};

type DashboardState = {
  goals: ControlGoal[];
  notifications: NotificationItem[];
  knowledge: KnowledgeItem[];
  agentRuns: AgentRunItem[];
};

type CurrentUser = { id: string; mode: "authenticated" } | null;

const emptyState: DashboardState = {
  goals: [],
  notifications: [],
  knowledge: [],
  agentRuns: [],
};

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${path}`);
  }
  return response.json() as Promise<T>;
}

async function loadDashboardState(): Promise<DashboardState> {
  const [goals, notifications, knowledge, agentRuns] = await Promise.all([
    readJson<{ goals: ControlGoal[] }>("/api/control/goals"),
    readJson<{ notifications: NotificationItem[] }>("/api/control/notifications"),
    readJson<{ knowledge: KnowledgeItem[] }>("/api/control/knowledge"),
    readJson<{ agentRuns: AgentRunItem[] }>("/api/control/agent-runs"),
  ]);
  return {
    goals: goals.goals,
    notifications: notifications.notifications,
    knowledge: knowledge.knowledge,
    agentRuns: agentRuns.agentRuns,
  };
}

export default function ControlDashboard() {
  const [state, setState] = useState<DashboardState>(emptyState);
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState<CurrentUser>(null);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [resetMode, setResetMode] = useState(false);

  async function load() {
    setStatus("loading");
    try {
      const session = await readJson<{ user: CurrentUser }>("/api/auth/me");
      setUser(session.user);
      if (!session.user) { setState(emptyState); setStatus("signed_out"); return; }
      setState(await loadDashboardState());
      setStatus("ready");
    } catch {
      setState(emptyState);
      setStatus("error");
    }
  }

  async function authenticate(action: "login" | "signup") {
    setStatus("loading");
    setState(emptyState);
    try {
      const result = await readJson<{ user: CurrentUser; status?: string }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginName.trim(), password, action }),
      });
      setPassword("");
      if (result.status === "verification_required") {
        setStatus("注册成功，请先完成邮箱验证再登录");
        return;
      }
      await load();
      window.location.assign("/");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : action === "signup" ? "注册失败" : "登录失败");
    }
  }

  async function requestPasswordReset() {
    setStatus("loading");
    try {
      await readJson("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginName.trim() }),
      });
      setStatus("重置邮件已发送，请检查邮箱中的链接");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "暂时无法发送重置邮件，请稍后重试");
    }
  }

  async function logout() {
    setState(emptyState);
    try {
      await readJson("/api/auth/logout", { method: "POST" });
      setUser(null);
      setStatus("signed_out");
    } catch {
      setStatus("退出失败，请重试");
    }
  }

  async function control(goalId: string, action: "resume" | "pause" | "abandon") {
    try {
      await readJson(`/api/control/goals/${encodeURIComponent(goalId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry: "AI developer tools", currentQuestions: "Continue this goal" }),
      });
      await load();
    } catch { setStatus("操作失败，请刷新登录状态后重试"); }
  }

  async function markRead(notificationId: string) {
    try {
      await readJson(`/api/control/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST" });
      await load();
    } catch { setStatus("操作失败，请刷新登录状态后重试"); }
  }

  useEffect(() => {
    let active = true;
    readJson<{ user: CurrentUser }>("/api/auth/me")
      .then(async (session) => {
        if (!active) return;
        setUser(session.user);
        if (!session.user) {
          setStatus("signed_out");
          return;
        }
        const dashboard = await loadDashboardState();
        if (active) { setState(dashboard); setStatus("ready"); }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const activeGoals = state.goals.filter((goal) => ["active", "waiting", "blocked"].includes(goal.status));
  const recentNotifications = state.notifications.slice(0, 6);
  const recentKnowledge = state.knowledge.slice(0, 6);

  if (!user) return (
    <div className="signal-shell">
      <header className="signal-topbar border-b px-6 py-5"><a href="/" className="flex items-center gap-3 font-semibold"><span className="signal-mark grid h-10 w-10 place-items-center rounded-xl text-xs text-white">SM</span>Signal Map</a></header>
      <main className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <p className="signal-eyebrow">个人信息雷达</p>
        <h1 className="signal-display mt-4 text-4xl leading-tight">{authMode === "login" ? "继续你的探索。" : "建立你的知识地图。"}</h1>
        <p className="mt-4 text-sm leading-7 text-[#657080]">登录后检索实时来源。每条结论都需要证据，研究结果随你的认知持续积累。</p>
        <form className="signal-surface mt-8 grid gap-5 rounded-3xl p-6" onSubmit={(event) => { event.preventDefault(); void (resetMode ? requestPasswordReset() : authenticate(authMode)); }}>
          {resetMode ? <p className="text-sm leading-6 text-[#657080]">输入注册邮箱，我们会发送一次性密码重置链接。</p> : null}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#f5f0e6] p-1">{(["login", "signup"] as const).map((mode) => <button key={mode} type="button" onClick={() => { setAuthMode(mode); setStatus("signed_out"); }} className={`min-h-11 rounded-lg text-sm font-semibold ${authMode === mode ? "bg-white text-[#2457ff] shadow-sm" : "text-[#657080]"}`}>{mode === "login" ? "登录" : "注册"}</button>)}</div>
          <label className="grid gap-2 text-sm font-semibold">邮箱<input required type="email" autoComplete="email" value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="you@example.com" className="min-h-12 w-full rounded-xl border bg-white px-4 font-normal" /></label>
          {!resetMode ? <label className="grid gap-2 text-sm font-semibold">密码<input required minLength={6} type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" className="min-h-12 w-full rounded-xl border bg-white px-4 font-normal" /></label> : null}
          <button disabled={status === "loading"} className="min-h-12 rounded-xl bg-[#2457ff] font-semibold text-white disabled:opacity-50">{status === "loading" ? "正在连接…" : resetMode ? "发送重置邮件" : authMode === "login" ? "登录并开始研究" : "创建账户"}</button>
          {!resetMode && authMode === "login" ? <button type="button" className="text-sm text-[#2457ff]" onClick={() => { setResetMode(true); setStatus("signed_out"); }}>忘记密码？</button> : null}
          {resetMode ? <button type="button" className="text-sm text-[#657080]" onClick={() => { setResetMode(false); setStatus("signed_out"); }}>返回登录</button> : null}
          {!["loading", "signed_out"].includes(status) && <p role="status" className="text-sm leading-6 text-[#a13926]">{status === "error" ? "暂时无法连接账户服务，请稍后重试。" : status}</p>}
          <p className="text-xs leading-6 text-[#657080]">首次使用请先注册；若提示邮箱验证，请完成验证后再登录。此处密码是 Signal Map 账户密码。</p>
        </form>
        <a href="/" className="mt-6 block text-center text-sm text-[#657080]">返回首页</a>
      </main>
    </div>
  );

  return (
    <main className="control-shell">
      <section className="control-hero">
        <p className="control-eyebrow">Signal Map Control Plane</p>
        <h1>Agent 状态控制台</h1>
        <a className="control-secondary inline-block" href="/">返回首页</a>
        <p>查看 Goal、Watch、通知、知识修订和 AgentRun trace。人工操作只走现有业务层，不绕过证据系统。</p>
        <p>当前身份：{user ? `${user.mode} · ${user.id}` : "未登录"}</p>
        {!user ? (
          <div className="control-login">
            <input value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="邮箱" type="email" />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码（至少 6 位）" type="password" />
            <button className="control-secondary" disabled={status === "loading"} onClick={() => void authenticate("login")}>登录</button>
            <button className="control-secondary" disabled={status === "loading"} onClick={() => void authenticate("signup")}>注册</button>
            <Link className="control-secondary" href="/">无需登录，先体验</Link>
          </div>
        ) : null}
        {!user ? <p>账户仅用于保存长期 Knowledge、RAG Memory、跨 Session 与跨设备状态；未登录体验只保存在当前浏览器。</p> : null}
        <button className="control-secondary" onClick={() => void load()}>刷新状态</button>
        {user ? <button className="control-secondary" onClick={() => void logout()}>Logout</button> : null}
        <span className="control-status">{status === "ready" ? "已连接" : status === "loading" ? "加载中" : status === "signed_out" ? "未登录" : status === "error" ? "加载失败" : status}</span>
      </section>

      <section className="control-grid">
        <Panel title="Goals" description="当前 active / waiting / blocked 的目标">
          {activeGoals.length === 0 ? <Empty text="没有正在推进或等待的 Goal。" /> : activeGoals.map((goal) => (
            <article className="control-card" key={goal.id}>
              <div className="control-row">
                <h3>{goal.objective}</h3>
                <span className={`control-badge ${goal.status}`}>{goalStatusLabel(goal.status)}</span>
              </div>
              <p>已完成 {goal.completedCriteria.length} / 剩余 {goal.remainingCriteria.length}</p>
              {goal.waitingOrBlockedReason ? <p>原因：{goal.waitingOrBlockedReason}</p> : null}
              {goal.nextCheckAt ? <p>下次检查：{goal.nextCheckAt}</p> : null}
              <div className="control-actions">
                <button onClick={() => void control(goal.id, "resume")}>Resume</button>
                <button onClick={() => void control(goal.id, "pause")}>Pause</button>
                <button onClick={() => void control(goal.id, "abandon")}>Abandon</button>
              </div>
            </article>
          ))}
        </Panel>

        <Panel title="Watches" description="为什么等待、何时再检查">
          {state.goals.filter((goal) => goal.watch).length === 0 ? <Empty text="暂无 Watch metadata。" /> : state.goals.filter((goal) => goal.watch).map((goal) => (
            <article className="control-card" key={`watch-${goal.id}`}>
              <h3>{goal.objective}</h3>
              <p>{resumeConditionLabel(goal.watch?.resumeCondition?.type)} · {goal.watch?.resumeCondition?.reason || "等待明确的恢复条件"}</p>
              <p>目标：{goal.watch?.resumeCondition?.target}</p>
              <p>状态：{goal.watch?.watchStatus} · 上次：{goal.watch?.lastCheckOutcome ?? "not_checked"}</p>
              <p>nextCheckAt：{goal.watch?.nextCheckAt ?? "无"}</p>
              <p>连续无变化：{goal.watch?.consecutiveNoChangeCount}</p>
            </article>
          ))}
        </Panel>

        <Panel title="Notifications" description="已有通知记录，不含外部发送设置">
          {recentNotifications.length === 0 ? <Empty text="暂无通知历史。" /> : recentNotifications.map((item) => (
            <article className="control-card" key={item.id}>
              <div className="control-row">
                <h3>{item.attention}</h3>
                <span className="control-badge">{userFacingLabel(item.status, "状态未知")}</span>
              </div>
              <p>{item.deliveryAction} · {item.unread === false ? `已读 ${item.readAt ?? ""}` : "未读"} · {item.createdAt}</p>
              <p>Goal：{item.relatedGoalId ?? "无"} · Revision：{item.relatedRevisionId ?? "无"}</p>
              <p>Evidence：{item.relatedEvidenceIds.length}</p>
              {item.unread === false ? null : (
                <div className="control-actions">
                  <button onClick={() => void markRead(item.id)}>Mark read</button>
                </div>
              )}
            </article>
          ))}
        </Panel>

        <Panel title="Knowledge" description="当前知识、修订与证据来源">
          {recentKnowledge.length === 0 ? <Empty text="暂无 Personal Knowledge。" /> : recentKnowledge.map((item) => (
            <article className="control-card" key={item.id}>
              <h3>{item.currentValue}</h3>
              <p>{userFacingLabel(item.type, "知识记录")} · 修订 {item.revision.currentRevision ?? "未知"}</p>
              <p>{verificationStatusLabel(item.provenance.verificationStatus)} · 可靠性 {item.provenance.reliabilityScore ?? "未知"}</p>
              <p>原因：{item.revision.revisionReason ?? "无"}</p>
              <details>
                <summary>Supporting Evidence ({item.supportingEvidence.length})</summary>
                {item.supportingEvidence.map((evidence) => (
                  <a key={evidence.id} href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.publisher} · {verificationStatusLabel(evidence.verificationStatus)}</a>
                ))}
              </details>
            </article>
          ))}
        </Panel>

        <Panel title="Agent Runs" description="结构化 trace，不展示思维链">
          {state.agentRuns.length === 0 ? <Empty text="暂无 AgentRun metadata。" /> : state.agentRuns.slice(0, 6).map((run) => (
            <article className="control-card" key={run.id}>
              <div className="control-row">
                <h3>{run.userQuery ?? run.id}</h3>
                <span className="control-badge">{run.status ?? "unknown"}</span>
              </div>
              <p>Rounds：{run.rounds ?? 0} · Evidence：{run.evidenceCount} · Attention：{run.finalAttention.join(", ") || "none"}</p>
              <p>Strategy：{run.selectedStrategies.join(" → ") || "none"}</p>
              <details>
                <summary>Trace ({run.trace.length})</summary>
                {run.trace.map((entry, index) => (
                  <p key={`${run.id}-${entry.timestamp}-${index}`}>{userFacingLabel(entry.state, "执行步骤")} · {userFacingReason(entry.action)} · {userFacingReason(entry.reason ?? entry.result)}</p>
                ))}
              </details>
            </article>
          ))}
        </Panel>
      </section>
    </main>
  );
}

function Panel(props: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="control-panel">
      <div className="control-panel-title">
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

function Empty(props: { text: string }) {
  return <p className="control-empty">{props.text}</p>;
}
