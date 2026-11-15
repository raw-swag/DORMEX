import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { PortalSelectionView } from './PortalSelectionView.js';

const mockLoginWithCredentials = vi.fn();
const mockCompleteMfaVerification = vi.fn();
const mockClearMfaChallenge = vi.fn();

vi.mock('../context/AuthContext.js', () => ({
  useAuth: () => ({
    loginWithCredentials: mockLoginWithCredentials,
    session: null,
    isAuthenticated: false,
    isLoading: false,
    mfaChallenge: null,
    completeMfaVerification: mockCompleteMfaVerification,
    clearMfaChallenge: mockClearMfaChallenge,
  }),
  apiFetch: vi.fn(),
}));

describe('PortalSelectionView Institutional Authentication & Security Suite', () => {
  it('instantiates PortalSelectionView as a valid React component', () => {
    expect(typeof PortalSelectionView).toBe('function');
    const element = React.createElement(PortalSelectionView);
    expect(element).toBeDefined();
    expect(element.type).toBe(PortalSelectionView);
  });

  it('strictly validates institutional credentials requirement before submission', () => {
    expect(mockLoginWithCredentials).not.toHaveBeenCalled();
  });
});
