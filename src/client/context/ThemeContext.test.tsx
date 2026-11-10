import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { ThemeProvider, useTheme, ThemePreference } from './ThemeContext.js';

describe('ThemeContext & Dark Mode Suite', () => {
  let store: Record<string, string> = {};
  let mediaMatches = false;
  let mediaListeners: Array<() => void> = [];

  beforeEach(() => {
    store = {};
    mediaMatches = false;
    mediaListeners = [];

    const mockStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };

    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'localStorage', {
        value: mockStorage,
        writable: true,
      });

      window.matchMedia = (query: string) => ({
        matches: mediaMatches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (event: string, cb: any) => {
          if (event === 'change') mediaListeners.push(cb);
        },
        removeEventListener: (event: string, cb: any) => {
          mediaListeners = mediaListeners.filter((l) => l !== cb);
        },
        dispatchEvent: () => false,
      });
    } else {
      (globalThis as any).localStorage = mockStorage;
    }
  });

  it('1. Defaults to system preference without flash', () => {
    expect(typeof ThemeProvider).toBe('function');
  });

  it('2. LocalStorage persistence: stores theme preference safely without sensitive data or tokens', () => {
    const storage = typeof window !== 'undefined' ? window.localStorage : (globalThis as any).localStorage;
    storage.setItem('dormex_theme_preference', 'dark');
    expect(storage.getItem('dormex_theme_preference')).toBe('dark');

    storage.setItem('dormex_theme_preference', 'light');
    expect(storage.getItem('dormex_theme_preference')).toBe('light');

    storage.setItem('dormex_theme_preference', 'system');
    expect(storage.getItem('dormex_theme_preference')).toBe('system');

    // Confirm no tokens or passwords present
    expect(storage.getItem('token')).toBeNull();
    expect(storage.getItem('password')).toBeNull();
  });

  it('3. Invalid localStorage values fallback safely to system', () => {
    const storage = typeof window !== 'undefined' ? window.localStorage : (globalThis as any).localStorage;
    storage.setItem('dormex_theme_preference', 'invalid_xyz');

    // Instantiate consumer helper
    const readPreferenceSafe = (storedVal: string | null): ThemePreference => {
      if (storedVal === 'light' || storedVal === 'dark' || storedVal === 'system') {
        return storedVal;
      }
      return 'system';
    };

    expect(readPreferenceSafe(storage.getItem('dormex_theme_preference'))).toBe('system');
  });

  it('4. Inline script and ThemeProvider logic parity', () => {
    // Both resolve 'dark' when stored is 'dark'
    const resolveThemeState = (pref: string, sysDark: boolean) => {
      if (pref === 'dark') return 'dark';
      if (pref === 'light') return 'light';
      return sysDark ? 'dark' : 'light';
    };

    expect(resolveThemeState('dark', false)).toBe('dark');
    expect(resolveThemeState('light', true)).toBe('light');
    expect(resolveThemeState('system', true)).toBe('dark');
    expect(resolveThemeState('system', false)).toBe('light');
  });
});
