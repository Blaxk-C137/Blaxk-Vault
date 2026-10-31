/**
 * Formatter and vocabulary contract.
 *
 * These helpers decide what a user reads while a download is running, so the edge
 * cases matter more than they look: an unknown size must read as "—" (unknown),
 * never as "0 B" — a fabricated zero is exactly the kind of fake progress the
 * blueprint forbids.
 */
import { describe, expect, it } from 'vitest';
import {
  DOWNLOADABILITY_LABEL,
  DOWNLOAD_STATUS_LABEL,
  DOWNLOADABILITY_STATES,
  DOWNLOAD_STATUSES,
  TERMINAL_DOWNLOAD_STATUSES,
  ACTIVE_DOWNLOAD_STATUSES,
  formatBytes,
  formatEta,
  formatRuntime,
  formatSpeed,
} from '@blaxkvault/shared';

describe('formatBytes', () => {
  it('reports an unknown or non-numeric size as unknown, not zero', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('formats real sizes across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(27_300_000)).toMatch(/MB$/);
    expect(formatBytes(2_000_000_000)).toMatch(/GB$/);
  });
});

describe('formatSpeed', () => {
  it('does not claim a speed when none is known', () => {
    expect(formatSpeed(0)).toBe('—');
    expect(formatSpeed(undefined)).toBe('—');
  });

  it('formats a real transfer rate', () => {
    expect(formatSpeed(1_500_000)).toMatch(/MB\/s$/);
    expect(formatSpeed(51_200)).toMatch(/KB\/s$/);
  });
});

describe('formatEta', () => {
  it('never invents a time remaining', () => {
    expect(formatEta(undefined)).toBe('—');
    expect(formatEta(0)).toBe('—');
    expect(formatEta(-5)).toBe('—');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('formats real estimates', () => {
    expect(formatEta(45)).toBe('45s');
    expect(formatEta(125)).toBe('2m 5s');
    expect(formatEta(7300)).toBe('2h 1m');
  });
});

describe('formatRuntime', () => {
  it('reports an unknown runtime as unknown', () => {
    expect(formatRuntime(undefined)).toBe('—');
    expect(formatRuntime(0)).toBe('—');
  });

  it('formats a real runtime', () => {
    expect(formatRuntime(96)).toBe('1h 36m');
    expect(formatRuntime(45)).toBe('45m');
  });
});

describe('status vocabulary', () => {
  it('has a human label for every download state', () => {
    for (const state of DOWNLOAD_STATUSES) {
      expect(DOWNLOAD_STATUS_LABEL[state], state).toBeTruthy();
    }
  });

  it('treats only real endings as terminal', () => {
    for (const state of TERMINAL_DOWNLOAD_STATUSES) {
      expect(DOWNLOAD_STATUS_LABEL[state]).toBeTruthy();
      expect(ACTIVE_DOWNLOAD_STATUSES as readonly string[]).not.toContain(state);
    }
    // A paused job is not finished — it must never be counted as terminal.
    expect(TERMINAL_DOWNLOAD_STATUSES as readonly string[]).not.toContain('paused');
  });

  it('never describes an unchecked source as available', () => {
    for (const state of DOWNLOADABILITY_STATES) {
      const label = DOWNLOADABILITY_LABEL[state];
      expect(label, state).toBeTruthy();
      if (state !== 'available') expect(label).not.toMatch(/^available|permitted file available/i);
    }
    expect(DOWNLOADABILITY_LABEL.unknown).toMatch(/not yet verified/i);
  });
});
