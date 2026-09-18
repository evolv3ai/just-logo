// Types for the bin shim's testable exports (bin.mjs is plain JavaScript so it
// runs without a build step).
export type SpawnOutcome = {
  status: number | null;
  signal: NodeJS.Signals | string | null;
  error?: Error;
};

export type ExitOutcome = {
  code: number;
  error: string | null;
  help: string | null;
};

export function exitFor(result: SpawnOutcome): ExitOutcome;
export function failureOutput(
  outcome: ExitOutcome,
  json: boolean,
): { stdout: string; stderr: string };
export function isMain(argv1: string | undefined, selfUrl: string): boolean;
