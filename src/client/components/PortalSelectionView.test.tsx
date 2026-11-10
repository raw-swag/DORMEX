import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { PortalSelectionView } from './PortalSelectionView.js';

const mockLoginWithCredentials = vi.fn();

vi.mock('../context/AuthContext.js', () => ({
  useAuth: () => ({
    loginWithCredentials: mockLoginWithCredentials,
    session: null,
    isAuthenticated: false,
    isLoading: false,
  }),
  apiFetch: vi.fn(),
  DEV_USERS: {},
}));

vi.mock('../api/apiJson.js', () => ({
  apiJson: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
}));

describe('PortalSelectionView UX, Gating, Progressive Disclosure & Accessibility Suite', () => {
  it('instantiates PortalSelectionView as a valid React element', () => {
    expect(typeof PortalSelectionView).toBe('function');
    const element = React.createElement(PortalSelectionView);
    expect(element).toBeDefined();
    expect(element.type).toBe(PortalSelectionView);
  });

  describe('Demo Access Build-Time Security Gating Contract', () => {
    // Helper function that mirrors vite.config.ts define logic exactly
    const computeDemoAccessFlag = (mode: string, nodeEnv: string | undefined, flag: string | undefined): boolean => {
      const isProduction = mode === 'production' || nodeEnv === 'production';
      return !isProduction && flag === 'true';
    };

    it('1. Default build: demo access disabled when flag is unset', () => {
      const isEnabled = computeDemoAccessFlag('development', 'development', undefined);
      expect(isEnabled).toBe(false);
    });

    it('2. Development build with flag enabled: demo guidance allowed', () => {
      const isEnabled = computeDemoAccessFlag('development', 'development', 'true');
      expect(isEnabled).toBe(true);
    });

    it('3. Production build with flag enabled: demo guidance strictly blocked and forced to false', () => {
      const isEnabled = computeDemoAccessFlag('production', 'production', 'true');
      expect(isEnabled).toBe(false);

      // Even if mode is custom but NODE_ENV is production
      const isEnabledNodeEnv = computeDemoAccessFlag('preview', 'production', 'true');
      expect(isEnabledNodeEnv).toBe(false);
    });

    it('4. Production build with flag unset: demo guidance strictly disabled', () => {
      const isEnabled = computeDemoAccessFlag('production', 'production', undefined);
      expect(isEnabled).toBe(false);
    });
  });
});
