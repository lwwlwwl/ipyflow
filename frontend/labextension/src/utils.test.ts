import { describe, expect, it, vi } from 'vitest';

import { debounce, mergeMaps } from './utils';

describe('mergeMaps', () => {
  it('unions keys, with priority overriding backup', () => {
    const merged = mergeMaps({ a: [1] }, { a: [2], b: [3] });
    expect(merged).toEqual({ a: [1], b: [3] });
  });

  it('returns a new object and does not mutate inputs', () => {
    const priority = { a: [1] };
    const backup = { b: [2] };
    const merged = mergeMaps(priority, backup);
    expect(merged).not.toBe(priority);
    expect(merged).not.toBe(backup);
    expect(priority).toEqual({ a: [1] });
    expect(backup).toEqual({ b: [2] });
  });
});

describe('debounce', () => {
  it('invokes only once on the trailing edge after rapid calls', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fn = debounce(() => {
        calls++;
      }, 100);
      fn();
      fn();
      fn();
      expect(calls).toBe(0);
      vi.advanceTimersByTime(99);
      expect(calls).toBe(0);
      vi.advanceTimersByTime(1);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the latest arguments through', () => {
    vi.useFakeTimers();
    try {
      const seen: number[] = [];
      const fn = debounce((x: number) => {
        seen.push(x);
      }, 50);
      fn(1);
      fn(2);
      vi.advanceTimersByTime(50);
      expect(seen).toEqual([2]);
    } finally {
      vi.useRealTimers();
    }
  });
});
