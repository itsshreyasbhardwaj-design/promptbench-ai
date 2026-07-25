'use client';

import * as React from 'react';

/**
 * A boolean preference backed by `localStorage`.
 *
 * Implemented with `useSyncExternalStore` rather than `useState` + `useEffect`.
 * Reading storage in an effect renders once with the default and again with the
 * stored value — a cascading render, and a visible flicker as the UI snaps into
 * place after hydration. This reads the real value on the first client render.
 *
 * Changes are broadcast so every hook instance for the same key stays in sync,
 * including across browser tabs via the native `storage` event.
 */

const CHANGE_EVENT = 'promptbench:storage';

function emit(key: string): void {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
}

export function usePersistedFlag(
  key: string,
  defaultValue = false,
): [boolean, (value: boolean) => void] {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const handleCustom = (event: Event) => {
        if ((event as CustomEvent<string>).detail === key) onChange();
      };
      const handleStorage = (event: StorageEvent) => {
        if (event.key === key) onChange();
      };

      window.addEventListener(CHANGE_EVENT, handleCustom);
      window.addEventListener('storage', handleStorage);

      return () => {
        window.removeEventListener(CHANGE_EVENT, handleCustom);
        window.removeEventListener('storage', handleStorage);
      };
    },
    [key],
  );

  const getSnapshot = React.useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? defaultValue : stored === 'true';
    } catch {
      // Storage can be unavailable in private browsing or blocked contexts.
      return defaultValue;
    }
  }, [key, defaultValue]);

  // The server has no storage; render the default and let the client correct it.
  const getServerSnapshot = React.useCallback(() => defaultValue, [defaultValue]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = React.useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Persistence is best-effort; the emit below still updates this session.
      }
      emit(key);
    },
    [key],
  );

  return [value, setValue];
}
