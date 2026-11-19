import { describe, expect, it } from 'vitest';
import { getCaptureRun } from '@baromontres/shared';
import { periodFor } from '../src/calendar.ts';
import { runCapture } from '../src/run.ts';
import { fakeR2, fixtureNet, seededDb } from './helpers.ts';

const at = (iso: string) => periodFor(new Date(iso));

describe('periodFor: the capture calendar', () => {
  it('monthly: the 1st to the 3rd, then nothing until the next 1st', () => {
    expect(at('2026-12-01T00:00:00Z')).toBe('2026-12-01T00:00:00.000Z');
    expect(at('2026-12-03T23:59:59Z')).toBe('2026-12-01T00:00:00.000Z');
    expect(at('2026-12-04T00:00:00Z')).toBeNull();
    expect(at('2026-12-15T12:00:00Z')).toBeNull();
    expect(at('2027-02-01T09:00:00Z')).toBe('2027-02-01T00:00:00.000Z');
    expect(at('2027-02-04T00:00:00Z')).toBeNull();
  });

  it('28 December is closed, 29 December opens the second December run', () => {
    expect(at('2026-12-28T23:59:59Z')).toBeNull();
    expect(at('2026-12-29T00:00:00Z')).toBe('2026-12-29T00:00:00.000Z');
    expect(at('2026-12-30T10:00:00Z')).toBe('2026-12-29T00:00:00.000Z');
    expect(at('2026-12-31T23:59:59Z')).toBe('2026-12-29T00:00:00.000Z');
  });

  it('31 December to 1 January: the new year starts its own period', () => {
    expect(at('2026-12-31T23:59:59Z')).not.toBe(at('2027-01-01T00:00:00Z'));
    expect(at('2027-01-01T00:00:00Z')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('daily from 1 to 20 January: each day is its own period', () => {
    expect(at('2027-01-02T00:05:00Z')).toBe('2027-01-02T00:00:00.000Z');
    expect(at('2027-01-02T23:55:00Z')).toBe('2027-01-02T00:00:00.000Z');
    expect(at('2027-01-10T12:00:00Z')).toBe('2027-01-10T00:00:00.000Z');
    expect(at('2027-01-20T23:59:59Z')).toBe('2027-01-20T00:00:00.000Z');
  });

  it('20 to 21 January: back to monthly, so nothing is open', () => {
    expect(at('2027-01-21T00:00:00Z')).toBeNull();
    expect(at('2027-01-25T00:00:00Z')).toBeNull();
    expect(at('2027-02-01T00:00:00Z')).toBe('2027-02-01T00:00:00.000Z');
  });
});

describe('cron run per capture period', () => {
  const cron = (t: ReturnType<typeof seededDb>, iso: string, maxRequests = 10) =>
    runCapture(t.d1, fakeR2().bucket, {
      trigger: 'cron',
      filter: { brandSlugs: ['cartier'], markets: ['CH' as const], referenceIds: refIds(t, ['CRWSSA0029', 'CRWGTA0011', 'CRWSTA0053']) },
      now: () => new Date(iso),
      fetcher: { ...fixtureNet({}).opts, maxRequests },
    });

  it('resumes the open run within a period, across days of a monthly period', async () => {
    const t = seededDb();
    const first = await cron(t, '2026-12-01T00:05:00Z', 2);
    expect(first).toMatchObject({ resumed: false, finished: false, attempted: 2, remaining: 2 });
    const second = await cron(t, '2026-12-02T10:00:00Z');
    expect(second).toMatchObject({ runId: first.runId, resumed: true, finished: true, remaining: 0 });
  });

  it('does nothing once the period run has finished, and outside any period', async () => {
    const t = seededDb();
    const first = await cron(t, '2027-01-05T00:05:00Z');
    expect(first.finished).toBe(true);
    const again = await cron(t, '2027-01-05T18:00:00Z');
    expect(again).toMatchObject({ runId: first.runId, finished: true, attempted: 0, requests: 0 });
    const idle = await cron(t, '2026-12-15T04:00:00Z');
    expect(idle).toMatchObject({ runId: 0, finished: true, attempted: 0, requests: 0 });
    expect(t.raw.prepare(`SELECT COUNT(*) AS n FROM capture_runs`).get()).toEqual({ n: 1 });
  });

  it('closes a stale run when a new period starts, then starts a new one', async () => {
    const t = seededDb();
    const jan5 = await cron(t, '2027-01-05T00:05:00Z', 1);
    expect(jan5.finished).toBe(false);
    const jan6 = await cron(t, '2027-01-06T00:05:00Z');
    expect(jan6.runId).not.toBe(jan5.runId);
    const old = (await getCaptureRun(t.d1, jan5.runId))!;
    expect(old.finished_at).not.toBeNull();
    expect(JSON.parse(old.counts!)).toMatchObject({ closed_unfinished: 1 });
  });

  it('the 29 December run is separate from the 1 December run', async () => {
    const t = seededDb();
    const dec1 = await cron(t, '2026-12-01T00:05:00Z');
    const dec29 = await cron(t, '2026-12-29T00:05:00Z');
    expect(dec1.finished && dec29.finished).toBe(true);
    expect(dec29.runId).not.toBe(dec1.runId);
  });
});

function refIds(t: ReturnType<typeof seededDb>, codes: string[]): number[] {
  return codes.map((c) => (t.raw.prepare(`SELECT id FROM watch_references WHERE ref_code = ?`).get(c) as { id: number }).id);
}
