'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 1100px)';

/** jsdom (tests) may ship no matchMedia; server never does. */
function canMatch() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function subscribe(notify: () => void) {
  if (!canMatch()) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', notify);
  return () => mql.removeEventListener('change', notify);
}

function getSnapshot() {
  return canMatch() ? window.matchMedia(QUERY).matches : false;
}

/** True when aurora.css treats the viewport as a phone dock layout. */
export function usePhoneLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
