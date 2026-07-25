'use client';

import * as React from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'promptbench-theme';

/**
 * Theme state.
 *
 * The `data-theme` attribute on `<html>` is the single source of truth, and the
 * inline script below sets it before first paint. React *subscribes* to that
 * attribute rather than keeping a parallel copy: reading it in an effect and
 * calling `setState` would render once with the wrong value and again with the
 * right one, which is both a cascading render and a visible flash.
 *
 * `useSyncExternalStore` is the sanctioned way to read from an external store
 * like this — it gets the correct value on the very first client render and
 * gives SSR an explicit snapshot.
 *
 * Dark is the default. This is a tool people keep open all day next to an
 * editor, and matching that environment matters more than matching the OS —
 * but an explicit OS preference for light still wins on first visit.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// The server cannot know the user's preference, so it renders the default and
// the pre-paint script corrects it before anything is visible.
function getServerSnapshot(): Theme {
  return 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Writing the attribute is what triggers the subscription above, so this is
  // the only mutation needed — no setState, no second render path.
  const setTheme = React.useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing and storage-blocked contexts. The theme still applies
      // for this session; only persistence is lost.
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(getSnapshot() === 'light' ? 'dark' : 'light');
  }, [setTheme]);

  const value = React.useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {/*
        Runs before paint to set the attribute from storage, so a returning
        user with the light theme never sees a dark flash. It must be inline
        and blocking — deferring it is what causes the flash.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})()`,
        }}
      />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider.');
  }
  return context;
}
