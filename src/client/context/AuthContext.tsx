import React, { createContext, useContext, useState, useEffect } from 'react';

export type Role = 'STUDENT' | 'PROCTOR' | 'WARDEN' | 'DEPUTY_WARDEN' | 'CHIEF_WARDEN' | 'HOSTEL_OFFICE' | 'SUPER_ADMIN';

export interface UserSession {
  userId: string;
  collegeId: string;
  fullName: string;
  role: Role;
  scopeType: string;
  scopeId: string | null;
  profileId: string | null;
  studentUsn?: string | null;
  mfaLevel?: 'NONE' | 'TOTP';
  activeAppointmentId?: string | null;
  activeAppointmentStatus?: string | null;
}

export interface MfaChallengeState {
  required: boolean;
  mfaEnrolled: boolean;
  challengeToken: string;
}

export interface AuthContextType {
  session: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  currentPortal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE' | null;
  setCurrentPortal: (portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE' | null) => void;
  mfaChallenge: MfaChallengeState | null;
  clearMfaChallenge: () => void;
  showStepUpModal: boolean;
  triggerStepUp: () => void;
  dismissStepUp: () => void;
  onStepUpSuccess: () => void;
  loginWithCredentials: (
    portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE',
    collegeIdOrEmail: string,
    passwordOrKey: string
  ) => Promise<{ mfaRequired?: boolean; challengeToken?: string; mfaEnrolled?: boolean } | void>;
  completeMfaVerification: (session: UserSession) => void;
  logout: () => Promise<void>;
  revokeAllUserSessions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isAuthenticated: false,
  isLoading: true,
  currentPortal: null,
  setCurrentPortal: () => {},
  mfaChallenge: null,
  clearMfaChallenge: () => {},
  showStepUpModal: false,
  triggerStepUp: () => {},
  dismissStepUp: () => {},
  onStepUpSuccess: () => {},
  loginWithCredentials: async () => {},
  completeMfaVerification: () => {},
  logout: async () => {},
  revokeAllUserSessions: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentPortal, setCurrentPortal] = useState<'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE' | null>(() => {
    return (typeof window !== 'undefined' ? (localStorage.getItem('dormex_current_portal') as any) : null) || null;
  });
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeState | null>(null);
  const [showStepUpModal, setShowStepUpModal] = useState<boolean>(false);

  // Restore authenticated session authoritatively from server via HttpOnly cookie
  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      const hasActiveSession = typeof window !== 'undefined' && localStorage.getItem('dormex_has_session') === 'true';
      if (!hasActiveSession) {
        if (mounted) {
          setSession(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'same-origin',
        });
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.userId) {
            const restoredSession: UserSession = {
              userId: data.userId,
              collegeId: data.collegeId,
              fullName: data.fullName || data.collegeId,
              role: data.role,
              scopeType: data.scopeType,
              scopeId: data.scopeId,
              profileId: data.profileId,
              studentUsn: data.studentUsn,
              activeAppointmentId: data.activeAppointmentId,
              activeAppointmentStatus: data.activeAppointmentStatus,
            };
            setSession(restoredSession);
            if (!currentPortal) {
              const mappedPortal = data.role === 'STUDENT' ? 'STUDENT' : (data.role === 'HOSTEL_OFFICE' ? 'HOSTEL_OFFICE' : 'ADMIN');
              setCurrentPortal(mappedPortal);
              localStorage.setItem('dormex_current_portal', mappedPortal);
            }
          }
        } else {
          if (mounted) {
            setSession(null);
            localStorage.removeItem('dormex_has_session');
          }
        }
      } catch (e) {
        if (mounted) {
          setSession(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  const loginWithCredentials = async (
    portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE',
    collegeIdOrEmail: string,
    passwordOrKey: string
  ) => {
    const trimmedId = collegeIdOrEmail.trim().toLowerCase();
    const rawPw = passwordOrKey;

    if (!trimmedId) {
      throw new Error('Please enter your Institutional ID or email address');
    }
    if (!rawPw) {
      throw new Error('Please enter your password or authorized credential');
    }

    // Authoritative backend authentication with HttpOnly cookie issuance
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        identifier: trimmedId,
        password: rawPw,
      }),
    });

    if (res.ok) {
      const data = await res.json();

      // Check if MFA challenge is issued for privileged accounts
      if (data.mfaRequired && data.challengeToken) {
        const challenge: MfaChallengeState = {
          required: true,
          mfaEnrolled: data.mfaEnrolled !== false,
          challengeToken: data.challengeToken,
        };
        setMfaChallenge(challenge);
        return challenge;
      }

      if (data.session) {
        const authenticatedSession: UserSession = data.session;

        // Role-portal consistency check
        if (portal === 'STUDENT' && authenticatedSession.role !== 'STUDENT') {
          throw new Error('Access Denied: This account is not a student');
        }
        if (portal === 'HOSTEL_OFFICE' && authenticatedSession.role !== 'HOSTEL_OFFICE') {
          throw new Error('Access Denied: This account is not authorized for Hostel Office');
        }
        if (portal === 'ADMIN' && !['SUPER_ADMIN', 'CHIEF_WARDEN', 'WARDEN', 'DEPUTY_WARDEN'].includes(authenticatedSession.role)) {
          throw new Error('Access Denied: This account is not an administrative staff member');
        }

        setSession(authenticatedSession);
        setCurrentPortal(portal);
        setMfaChallenge(null);
        localStorage.setItem('dormex_current_portal', portal);
        localStorage.setItem('dormex_has_session', 'true');
        return;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 401 && errData.error) {
        throw new Error(errData.error);
      }
      throw new Error(errData.error || `Authentication Failed (HTTP ${res.status})`);
    }
  };

  const completeMfaVerification = (userSession: UserSession) => {
    setSession(userSession);
    const mappedPortal = userSession.role === 'STUDENT' ? 'STUDENT' : (userSession.role === 'HOSTEL_OFFICE' ? 'HOSTEL_OFFICE' : 'ADMIN');
    setCurrentPortal(mappedPortal);
    setMfaChallenge(null);
    localStorage.setItem('dormex_current_portal', mappedPortal);
    localStorage.setItem('dormex_has_session', 'true');
  };

  const clearMfaChallenge = () => {
    setMfaChallenge(null);
  };

  const triggerStepUp = () => {
    setShowStepUpModal(true);
  };

  const dismissStepUp = () => {
    setShowStepUpModal(false);
  };

  const onStepUpSuccess = () => {
    setShowStepUpModal(false);
    if (session) {
      setSession({
        ...session,
        mfaLevel: 'TOTP',
      });
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ revokeAllSessions: false }),
      });
    } catch (e) {}
    setSession(null);
    setCurrentPortal(null);
    setMfaChallenge(null);
    localStorage.removeItem('dormex_has_session');
    localStorage.removeItem('dormex_auth_session');
    localStorage.removeItem('dormex_current_portal');
    localStorage.removeItem('dormex_dev_session');
    localStorage.removeItem('dormex_hardware_unlocked');
  };

  const revokeAllUserSessions = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ revokeAllSessions: true }),
      });
    } catch (e) {}
    setSession(null);
    setCurrentPortal(null);
    setMfaChallenge(null);
    localStorage.removeItem('dormex_has_session');
    localStorage.removeItem('dormex_auth_session');
    localStorage.removeItem('dormex_current_portal');
    localStorage.removeItem('dormex_dev_session');
    localStorage.removeItem('dormex_hardware_unlocked');
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        currentPortal,
        setCurrentPortal,
        mfaChallenge,
        clearMfaChallenge,
        showStepUpModal,
        triggerStepUp,
        dismissStepUp,
        onStepUpSuccess,
        loginWithCredentials,
        completeMfaVerification,
        logout,
        revokeAllUserSessions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export async function apiFetch(path: string, options: RequestInit = {}, session?: UserSession | null) {
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  return res;
}
