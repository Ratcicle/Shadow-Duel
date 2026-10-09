/**
 * Engine fault policy (D11).
 *
 * Contained engine errors are recorded on the host and logged. Production
 * keeps the caller's fallback; strict mode rethrows after recording. Strict
 * mode is resolved when the fault happens, so `setDevMode(true)` after
 * construction applies to later faults.
 *
 * This is a free function, not an attached Game method: Chain, EffectEngine
 * and clone/fixture hosts call it with whatever host they hold, and the fault
 * log is created lazily on hosts that do not own one.
 */

import type {
  EngineFault,
  EngineFaultScope,
} from "../../contracts/gameRuntime.js";

export type { EngineFault, EngineFaultScope };

/** Most recent faults kept per host; older entries are dropped first. */
export const ENGINE_FAULT_LOG_LIMIT = 50;

export interface EngineFaultHost {
  engineFaults?: EngineFault[];
  strictEngineFaults?: boolean | undefined;
  devModeEnabled?: boolean;
  devLog?(tag: string, detail?: unknown): void;
}

export interface ReportEngineFaultOptions {
  details?: Record<string, unknown>;
  /** Overrides strict mode; `false` contains the fault even when strict. */
  rethrow?: boolean;
}

// An error rethrown through nested containment points is recorded once.
const reportedErrors = new WeakSet<object>();

function faultMessage(error: unknown): string {
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message) return message;
  }
  if (typeof error === "string" && error) return error;
  return "engine_fault";
}

export function isStrictEngineFaultMode(
  host: EngineFaultHost | null | undefined,
): boolean {
  return host?.strictEngineFaults ?? host?.devModeEnabled === true;
}

export function reportEngineFault(
  host: EngineFaultHost | null | undefined,
  scope: EngineFaultScope,
  error: unknown,
  options: ReportEngineFaultOptions = {},
): void {
  const trackable =
    (typeof error === "object" && error !== null) ||
    typeof error === "function";
  if (!trackable || !reportedErrors.has(error)) {
    if (trackable) reportedErrors.add(error);
    const fault: EngineFault = {
      scope,
      message: faultMessage(error),
      error,
      details: options.details ?? null,
    };
    if (host) {
      host.engineFaults ??= [];
      host.engineFaults.push(fault);
      if (host.engineFaults.length > ENGINE_FAULT_LOG_LIMIT) {
        host.engineFaults.splice(
          0,
          host.engineFaults.length - ENGINE_FAULT_LOG_LIMIT,
        );
      }
      host.devLog?.("ENGINE_FAULT", {
        summary: `${scope}: ${fault.message}`,
        scope,
        message: fault.message,
      });
    }
    console.error(`[EngineFault] ${scope}:`, error, options.details ?? "");
  }
  if (options.rethrow ?? isStrictEngineFaultMode(host)) throw error;
}
