import { useEffect, useState } from 'react';

/** Debounce a value — used for search input so we do not hammer the API (§10). */
export function useDebouncedValue<T>(value: T, delayMs = 320): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
