import type { InformationRun, InformationRunPayload } from "./types.ts";

export function isInformationRunCurrent(
  run: InformationRun | null,
  filterId: string,
  researchContextRevision: number,
) {
  return Boolean(
    run &&
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
    return stamp(await options.runLive(), options);
  } catch (liveError) {
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
