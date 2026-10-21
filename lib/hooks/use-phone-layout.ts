'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 1100px)';

/** True when aurora.css treats the viewport as a phone dock layout. */
export function usePhoneLayout() {
  return useSyncExternalStore(
    (notify) => {
      window.matchMedia(QUERY).addEventListener('change', notify);
      return () => window.matchMedia(QUERY).removeEventListener('change', notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
