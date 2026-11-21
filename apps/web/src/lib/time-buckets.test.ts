import { describe, expect, it } from 'vitest';
import { bucketKeys, bucketStart, dayKey, fillBuckets, formatBucket, windowStart } from './time-buckets';

describe('bucketStart', () => {
  it('truncates to the UTC day', () => {
    expect(bucketStart(new Date('2026-11-21T23:59:00Z'), 'day').toISOString()).toBe(
      '2026-11-21T00:00:00.000Z',
    );
  });
  it('truncates to Monday like Postgres date_trunc(week)', () => {
    // 2026-11-21 is a Saturday; 2026-11-16 is the Monday before; a Monday maps to itself.
    expect(dayKey(bucketStart(new Date('2026-11-21T10:00:00Z'), 'week'))).toBe('2026-11-16');
    expect(dayKey(bucketStart(new Date('2026-11-16T00:00:00Z'), 'week'))).toBe('2026-11-16');
    expect(dayKey(bucketStart(new Date('2026-11-22T23:00:00Z'), 'week'))).toBe('2026-11-16');
  });
});

describe('bucketKeys', () => {
  it('lists every day inclusive', () => {
    expect(bucketKeys(new Date('2026-11-19T12:00:00Z'), new Date('2026-11-21T01:00:00Z'), 'day')).toEqual([
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ]);
  });
  it('lists every week start, crossing a month', () => {
    expect(bucketKeys(new Date('2026-10-28T00:00:00Z'), new Date('2026-11-21T00:00:00Z'), 'week')).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
  });
});

describe('windowStart', () => {
  it('starts days - 1 whole days before today, at midnight UTC', () => {
    expect(windowStart(30, new Date('2026-11-21T15:00:00Z')).toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(windowStart(1, new Date('2026-11-21T15:00:00Z')).toISOString()).toBe('2026-11-21T00:00:00.000Z');
  });
});

describe('fillBuckets', () => {
  it('keeps key order and fills gaps', () => {
    const rows = [{ k: '2026-11-21', n: 3 }];
    expect(
      fillBuckets(
        ['2026-11-20', '2026-11-21'],
        rows,
        (r) => r.k,
        (r) => r.n,
        () => 0,
      ),
    ).toEqual([0, 3]);
  });
});

describe('formatBucket', () => {
  it('formats in UTC', () => {
    expect(formatBucket('2026-11-01')).toBe('Nov 1');
  });
});
