'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

/**
 * Interface style: the Minecraft voxel world (default), or the app's own
 * Aurora design. Independent from the light/dark theme — the voxel style is
 * inherently a dark twilight world and keeps the light/dark setting for
 * everything it does not reskin.
 */
export type StyleTheme = 'aurora' | 'voxel';

/** Minecraft is the default; an explicit stored choice always wins. */
export const DEFAULT_STYLE_THEME: StyleTheme = 'voxel';

interface StyleThemeContextType {
  styleTheme: StyleTheme;
  setStyleTheme: (style: StyleTheme) => void;
}

const StyleThemeContext = createContext<StyleThemeContextType | undefined>(undefined);

const STYLE_KEY = 'styleTheme';

export function StyleThemeProvider({ children }: { children: ReactNode }) {
  const [styleTheme, setStyleThemeState] = useState<StyleTheme>(DEFAULT_STYLE_THEME);
  // The document already carries the stored style (the layout's pre-paint
  // script); this flag only guards the re-apply until the stored value is read.
  const [loaded, setLoaded] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  /* eslint-disable react-hooks/set-state-in-effect -- Hydration from localStorage must happen in effect */
  useEffect(() => {
    const stored = localStorage.getItem(STYLE_KEY) as StyleTheme | null;
    if (stored === 'aurora' || stored === 'voxel') setStyleThemeState(stored);
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Apply the style class to the document
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.classList.toggle('voxel-style', styleTheme === 'voxel');
  }, [loaded, styleTheme]);

  const setStyleTheme = (style: StyleTheme) => {
    setStyleThemeState(style);
    try {
      localStorage.setItem(STYLE_KEY, style);
    } catch {
      /* localStorage unavailable */
    }
  };

  return (
    <StyleThemeContext.Provider value={{ styleTheme, setStyleTheme }}>
      {children}
    </StyleThemeContext.Provider>
  );
}

export function useStyleTheme() {
  const context = useContext(StyleThemeContext);
  if (!context) {
    throw new Error('useStyleTheme must be used within StyleThemeProvider');
  }
  return context;
}
