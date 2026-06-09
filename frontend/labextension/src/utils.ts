export function mergeMaps<V>(
  priority: { [id: string]: V },
  backup: { [id: string]: V },
): { [id: string]: V } {
  const merged: { [id: string]: V } = {};
  for (const key in backup) {
    merged[key] = backup[key];
  }
  for (const key in priority) {
    merged[key] = priority[key];
  }
  return merged;
}

/**
 * Trailing-edge debounce: returns a wrapper that delays invoking `fn` until
 * `wait` ms have elapsed since the last call. Replaces lodash.debounce (default
 * leading: false, trailing: true), which was the only behavior we relied on.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}
