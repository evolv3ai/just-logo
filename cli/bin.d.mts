// Types for the bin shim's testable export (bin.mjs is plain JavaScript so it
// runs without a build step).
export type SpawnOutcome = {
  status: number | null;
  signal: NodeJS.Signals | string | null;
  error?: Error;
};

export function exitFor(result: SpawnOutcome): {
  code: number;
  message: string | null;
};
export function isMain(argv1: string | undefined, selfUrl: string): boolean;
