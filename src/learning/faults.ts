/**
 * Fault switches for the troubleshooting drill (排障演练).
 *
 * Only consulted when learning mode is on; every check is a cheap Set lookup
 * guarded by isLearning(), so the official start path never pays for it.
 * A fault makes one stage fail the way a real misconfiguration would, so the
 * learner has to find the cause from the panel's real data:
 *
 *   wake-refused  — stage 4: the session driver refuses to start the agent
 *                   container (same path as a missing image). The host sweep
 *                   retries every 60s, so clearing the fault heals the session
 *                   and the pending message is answered.
 *   route-denied  — stage 2: the access gate refuses the sender (same path as
 *                   an unknown sender under a strict policy). The message is
 *                   dropped with an audit row; later messages flow again once
 *                   the fault is cleared.
 */
import { isLearning } from './trace.js';

export const FAULT_NAMES = ['wake-refused', 'route-denied'] as const;
export type FaultName = (typeof FAULT_NAMES)[number];

const active = new Set<FaultName>();

export function isFaultName(value: unknown): value is FaultName {
  return typeof value === 'string' && (FAULT_NAMES as readonly string[]).includes(value);
}

export function faultActive(name: FaultName): boolean {
  return isLearning() && active.has(name);
}

export function setFault(name: FaultName, on: boolean): void {
  if (on) active.add(name);
  else active.delete(name);
}

export function activeFaults(): FaultName[] {
  return [...active];
}

export function clearFaults(): void {
  active.clear();
}
