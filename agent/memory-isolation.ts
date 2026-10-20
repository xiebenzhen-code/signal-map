// Bounded closeout cycle (2026-10-20): auto-memory participation switch.
//
// Long-term memory automatically joining research is out of this cycle's
// acceptance scope, so its influence on research planning, fact judgement and
// ranking is isolated by DEFAULT. The switch is deliberately read-side only:
// new knowledge is still saved and read back (the account page keeps working,
// no records are deleted or batch-rewritten), and nothing in the memory system
// is restructured. Setting SIGNAL_MAP_MEMORY_ISOLATION=participate restores
// the previous behavior in full — the isolation is a one-line revert.
//
// Default rationale: production configuration is frozen for this cycle (Env
// params stay at current values), so the safe default lives in code.

export type MemoryParticipationOptions = {
  memoryParticipation?: boolean;
};

/** False (isolated) unless explicitly opted in. */
export function memoryParticipates(options: MemoryParticipationOptions = {}): boolean {
  if (options.memoryParticipation !== undefined) return options.memoryParticipation;
  return String(process.env.SIGNAL_MAP_MEMORY_ISOLATION ?? "").trim().toLowerCase() === "participate";
}
