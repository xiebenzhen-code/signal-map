import type { InformationRun, InformationRunPayload } from "./types.ts";

export function isInformationRunCurrent(
  run: InformationRun | null,
  filterId: string,
  researchContextRevision: number,
) {
  return Boolean(
    run &&
      run.status !== "failed" &&
      run.filterId === filterId &&
      run.generatedFromResearchContextRevision === researchContextRevision,
  );
}

export function selectCurrentInformationRun(
  runs: Record<string, InformationRun>,
  filterId: string,
  researchContextRevision: number,
) {
  const run = runs[filterId] ?? null;
  return isInformationRunCurrent(run, filterId, researchContextRevision) ? run : null;
}

type RunInformationOptions = {
  filterId: string;
  researchContextRevision: number;
  localOnly?: boolean;
  allowDemoFallback?: boolean;
  runLive: () => Promise<InformationRunPayload>;
  runDemo: () => Promise<InformationRunPayload>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stamp(payload: InformationRunPayload, options: RunInformationOptions): InformationRun {
  return {
    ...payload,
    filterId: options.filterId,
    generatedFromResearchContextRevision: options.researchContextRevision,
  };
}

export async function runInformation(options: RunInformationOptions): Promise<InformationRun> {
  if (options.localOnly) {
    return {
      ...stamp(await options.runDemo(), options),
      dataMode: "demo",
    };
  }
  try {
    const payload = await options.runLive();
    if (payload.status === "failed") {
      throw Object.assign(new Error(`本次研究未完成，请稍后重新尝试。${payload.requestId ? `请求编号：${payload.requestId}` : ""}`), { code: "RESEARCH_FAILED" });
    }
    return stamp(payload, options);
  } catch (liveError) {
    if (liveError && typeof liveError === "object" && "code" in liveError && liveError.code === "RESEARCH_FAILED") throw liveError;
    if (options.allowDemoFallback === false) throw liveError;
    if (liveError && typeof liveError === "object" && "status" in liveError && [401, 403].includes(Number(liveError.status))) {
      throw liveError;
    }
    try {
      return {
        ...stamp(await options.runDemo(), options),
        dataMode: "demo",
        fallbackReason: errorMessage(liveError),
      };
    } catch (demoError) {
      throw new Error(`${errorMessage(liveError)}; Demo fallback failed: ${errorMessage(demoError)}`);
    }
  }
}
