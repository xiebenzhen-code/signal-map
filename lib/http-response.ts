export async function discardResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only. The caller still owns the actual error path.
  }
}

export async function throwAfterDiscardingBody(response: Response, error: Error) {
  await discardResponseBody(response);
  throw error;
}
