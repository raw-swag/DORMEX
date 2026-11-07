import React, { createContext, useContext, useState, useEffect } from 'react';

export type Role = 'STUDENT' | 'PROCTOR' | 'WARDEN' | 'CHIEF_WARDEN' | 'HOSTEL_OFFICE' | 'SUPER_ADMIN';

export interface UserSession {
  userId: string;
  collegeId: string;
  fullName: string;
  role: Role;
  scopeType: string;
  scopeId: string | null;
  profileId: string | null;
}

export const DEV_USERS: Record<string, UserSession> = {
  demo1: {
    userId: 'usr_demo_001',
    collegeId: 'DEMO-001',
    fullName: 'Aarav Sharma (Rank #1)',
    role: 'STUDENT',
    scopeType: 'STUDENT',
    scopeId: null,
    profileId: 'prof_demo_001',
  },
  demo2: {
    userId: 'usr_demo_002',
    collegeId: 'DEMO-002',
    fullName: 'Diya Patel (Rank #2)',
    role: 'STUDENT',
    scopeType: 'STUDENT',
    scopeId: null,
    profileId: 'prof_demo_002',
  },
  demo3: {
    userId: 'usr_demo_003',
    collegeId: 'DEMO-003',
    fullName: 'Rohan Verma (Rank #3)',
    role: 'STUDENT',
    scopeType: 'STUDENT',
    scopeId: null,
    profileId: 'prof_demo_003',
  },
  demo10: {
    userId: 'usr_demo_010',
    collegeId: 'DEMO-010',
    fullName: 'Arjun Menon (Rank #10)',
    role: 'STUDENT',
    scopeType: 'STUDENT',
    scopeId: null,
    profileId: 'prof_demo_010',
  },
  demo29: {
    userId: 'usr_demo_029',
    collegeId: 'DEMO-029',
    fullName: 'Prisha Pandey (Pending Eligibility)',
    role: 'STUDENT',
    scopeType: 'STUDENT',
    scopeId: null,
    profileId: 'prof_demo_029',
  },
  demo30: {
    userId: 'usr_demo_030',
    collegeId: 'DEMO-030',
    fullName: 'Nikhil Saxena (Fee Pending)',
    role: 'STUDENT',
    scopeType: 'STUDENT',
    scopeId: null,
    profileId: 'prof_demo_030',
  },
  student1: {
    userId: 'usr_student_1',
    collegeId: 'USN202401',
    fullName: 'Aarav Patel (Test Alias)',
    role: 'STUDENT',
    scopeType: 'STUDENT',
    scopeId: null,
    profileId: 'prof_stu_1',
  },
  wardenBvb: {
    userId: 'usr_warden_bvb',
    collegeId: 'WRD001',
    fullName: 'Prof. Rao (Warden - BVB Block)',
    role: 'WARDEN',
    scopeType: 'BUILDING',
    scopeId: 'bld_bvb',
    profileId: null,
  },
  chiefWarden: {
    userId: 'usr_chief',
    collegeId: 'CW001',
    fullName: 'Dr. Sharma (Chief Warden)',
    role: 'CHIEF_WARDEN',
    scopeType: 'SYSTEM',
    scopeId: null,
    profileId: null,
  },
  hostelOffice: {
    userId: 'usr_office',
    collegeId: 'OFF001',
    fullName: 'Hostel Office Staff',
    role: 'HOSTEL_OFFICE',
    scopeType: 'SYSTEM',
    scopeId: null,
    profileId: null,
  },
  superAdmin: {
    userId: 'usr_admin',
    collegeId: 'ADM001',
    fullName: 'Chief Warden Administrator (ADM001)',
    role: 'CHIEF_WARDEN',
    scopeType: 'SYSTEM',
    scopeId: null,
    profileId: null,
  },
};

export interface AuthContextType {
  session: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isPresentationBlocked: boolean;
  clearPresentationBlock: () => void;
  checkPresentationAccess: () => Promise<boolean>;
  currentPortal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE' | null;
  setCurrentPortal: (portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE' | null) => void;
  login: (portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE', identityKey: string) => Promise<void>;
  loginWithCredentials: (
    portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE',
    collegeIdOrEmail: string,
    passwordOrKey: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  switchUser: (devKey: string) => void;
  isDevMode: boolean;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isAuthenticated: false,
  isLoading: true,
  isPresentationBlocked: false,
  clearPresentationBlock: () => {},
  checkPresentationAccess: async () => true,
  currentPortal: null,
  setCurrentPortal: () => {},
  login: async () => {},
  loginWithCredentials: async () => {},
  logout: async () => {},
  switchUser: () => {},
  isDevMode: false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPresentationBlocked, setIsPresentationBlocked] = useState<boolean>(false);
  const [currentPortal, setCurrentPortal] = useState<'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE' | null>(() => {
    return (localStorage.getItem('dormex_current_portal') as any) || null;
  });

  const isDevMode = typeof window !== 'undefined' && (
    window.location.search.includes('dev=true') || 
    localStorage.getItem('dormex_dev_mode') === 'true'
  );

  const checkPresentationAccess = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/presentation/status', {
        credentials: 'same-origin',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.gateEnabled && !data.hasAccess) {
          setIsPresentationBlocked(true);
          return false;
        }
      } else if (res.status === 401) {
        const errData = await res.json().catch(() => ({}));
        if (typeof errData.error === 'string' && errData.error.includes('PRESENTATION_ACCESS_REQUIRED')) {
          setIsPresentationBlocked(true);
          return false;
        }
      }
      setIsPresentationBlocked(false);
      return true;
    } catch {
      return !isPresentationBlocked;
    }
  };

  const clearPresentationBlock = () => {
    setIsPresentationBlocked(false);
  };

  // Restore authenticated session authoritatively from server via HttpOnly cookie
  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      try {
        // First verify presentation gate status if active
        try {
          const statusRes = await fetch('/api/presentation/status', {
            credentials: 'same-origin',
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.gateEnabled && !statusData.hasAccess) {
              if (mounted) {
                setIsPresentationBlocked(true);
                setSession(null);
                setIsLoading(false);
              }
              return;
            }
          }
        } catch {
          // If status endpoint fails or doesn't exist yet, proceed to /api/auth/me check
        }

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
            };
            setSession(restoredSession);
            setIsPresentationBlocked(false);
            if (!currentPortal) {
              const mappedPortal = data.role === 'STUDENT' ? 'STUDENT' : (data.role === 'HOSTEL_OFFICE' ? 'HOSTEL_OFFICE' : 'ADMIN');
              setCurrentPortal(mappedPortal);
              localStorage.setItem('dormex_current_portal', mappedPortal);
            }
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          if (mounted) {
            setSession(null);
            if (res.status === 401 && typeof errData.error === 'string' && errData.error.includes('PRESENTATION_ACCESS_REQUIRED')) {
              setIsPresentationBlocked(true);
            }
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

  const login = async (portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE', identityKey: string) => {
    const target = DEV_USERS[identityKey];
    if (target) {
      // Backend authority verification: Ensure selected portal matches authorized role
      if (portal === 'STUDENT' && target.role !== 'STUDENT') {
        throw new Error('Access Denied: This account is not a student');
      }
      if (portal === 'HOSTEL_OFFICE' && target.role !== 'HOSTEL_OFFICE') {
        throw new Error('Access Denied: This account is not authorized for Hostel Office');
      }
      if (portal === 'ADMIN' && !['SUPER_ADMIN', 'CHIEF_WARDEN', 'WARDEN'].includes(target.role)) {
        throw new Error('Access Denied: This account is not an administrative staff member');
      }

      // Quick Pilot Preset login converges on the authoritative backend login endpoint
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          identifier: target.collegeId,
          password: 'password',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Authentication Failed');
      }

      const data = await res.json();
      if (data.session) {
        setSession(data.session);
        setCurrentPortal(portal);
        localStorage.setItem('dormex_current_portal', portal);
      }
    }
  };

  const loginWithCredentials = async (
    portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE',
    collegeIdOrEmail: string,
    passwordOrKey: string
  ) => {
    const trimmedId = collegeIdOrEmail.trim().toLowerCase();
    const rawPw = passwordOrKey; // Do not trim or alter password characters

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
      if (data.session) {
        const authenticatedSession: UserSession = data.session;

        // Role-portal consistency check
        if (portal === 'STUDENT' && authenticatedSession.role !== 'STUDENT') {
          throw new Error('Access Denied: This account is not a student');
        }
        if (portal === 'HOSTEL_OFFICE' && authenticatedSession.role !== 'HOSTEL_OFFICE') {
          throw new Error('Access Denied: This account is not authorized for Hostel Office');
        }
        if (portal === 'ADMIN' && !['SUPER_ADMIN', 'CHIEF_WARDEN', 'WARDEN'].includes(authenticatedSession.role)) {
          throw new Error('Access Denied: This account is not an administrative staff member');
        }

        setSession(authenticatedSession);
        setCurrentPortal(portal);
        localStorage.setItem('dormex_current_portal', portal);
        return;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 401 && typeof errData.error === 'string' && errData.error.includes('PRESENTATION_ACCESS_REQUIRED')) {
        setIsPresentationBlocked(true);
      }
      if (res.status === 401 && errData.error) {
        throw new Error(errData.error);
      }
      throw new Error(errData.error || `Authentication Failed (HTTP ${res.status})`);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch (e) {}
    setSession(null);
    setCurrentPortal(null);
    localStorage.removeItem('dormex_auth_session');
    localStorage.removeItem('dormex_current_portal');
    localStorage.removeItem('dormex_dev_session');
  };

  const switchUser = async (devKey: string) => {
    const target = DEV_USERS[devKey];
    if (target) {
      const portal = target.role === 'STUDENT' ? 'STUDENT' : (target.role === 'HOSTEL_OFFICE' ? 'HOSTEL_OFFICE' : 'ADMIN');
      await login(portal, devKey);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        isPresentationBlocked,
        clearPresentationBlock,
        checkPresentationAccess,
        currentPortal,
        setCurrentPortal,
        login,
        loginWithCredentials,
        logout,
        switchUser,
        isDevMode,
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

  // Same-origin browser requests rely exclusively on secure HttpOnly cookies.
  // Bearer tokens and client-side x-user-id headers are NOT injected into production/same-origin browser traffic.
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  return res;
}
