// Centralized error handling: any failure in any flow sets the item to
// "Error - Check Updates" and posts a Monday update with enough detail to debug.

import * as monday from '../clients/monday';
import { STATUS, COLUMNS } from '../config/board';
import { cv } from './columnValues';
import { log } from '../lib/logger';

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
}

/** Set Status = Error and post a debug update. Never throws. */
export async function reportError(itemId: string, context: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  log.error('flow error', { itemId, context, detail });
  try {
    await monday.updateColumns(itemId, { [COLUMNS.status]: cv.status(STATUS.error) });
    await monday.createUpdate(itemId, `❌ ${context}\n\n${truncate(detail, 4000)}`);
  } catch (reportErr) {
    log.error('failed to report error to monday', {
      itemId,
      reportErr: reportErr instanceof Error ? reportErr.message : String(reportErr),
    });
  }
}

/** Post a validation-failure update listing what's missing, set Status = Error. */
export async function reportValidationFailure(itemId: string, missing: string[]): Promise<void> {
  log.warn('validation failed', { itemId, missing });
  const body =
    `⚠️ Can't send yet:\n` +
    missing.map((m) => `• ${m}`).join('\n');
  try {
    await monday.updateColumns(itemId, { [COLUMNS.status]: cv.status(STATUS.error) });
    await monday.createUpdate(itemId, body);
  } catch (reportErr) {
    log.error('failed to report validation failure', {
      itemId,
      reportErr: reportErr instanceof Error ? reportErr.message : String(reportErr),
    });
  }
}
