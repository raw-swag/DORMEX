import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, apiFetch } from '../context/AuthContext.js';
import { apiJson } from '../api/apiJson.js';
import {
  GraduationCap,
  ShieldCheck,
  Building,
  ArrowRight,
  AlertCircle,
  Lock,
  Sparkles,
  KeyRound,
  UserCheck,
  Eye,
  EyeOff,
  HelpCircle,
  X,
  Fingerprint,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  RefreshCw,
  WifiOff,
  Laptop
} from 'lucide-react';
import { DemoAuthModal } from './DemoAuthModal.js';
import { DormexLogo } from './DormexLogo.js';
import { ThemeToggle } from './ThemeToggle.js';

export const PortalSelectionView: React.FC = () => {
  const { loginWithCredentials } = useAuth();
  const [selectedPortal, setSelectedPortal] = useState<'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE'>('STUDENT');
  const [authIdInput, setAuthIdInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Demo access gate: Only enabled when build-time environment variable VITE_ENABLE_DEMO_ACCESS === 'true'
  // Disabled by default; never accessible in production builds. URL ?dev=true and localStorage overrides are strictly removed.
  const isDemoAccessEnabled = typeof __VITE_ENABLE_DEMO_ACCESS__ !== 'undefined' ? __VITE_ENABLE_DEMO_ACCESS__ : false;

  // Progressive Disclosure for Hardware Biometrics
  const [showMoreAuthOptions, setShowMoreAuthOptions] = useState<boolean>(false);

  // WebAuthn Browser Platform Support State
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean>(true);

  // Validation and status tracking
  const [generalError, setGeneralError] = useState<{ message: string; isNetwork?: boolean } | null>(null);
  const [authIdTouched, setAuthIdTouched] = useState<boolean>(false);
  const [passwordTouched, setPasswordTouched] = useState<boolean>(false);
  const [authIdError, setAuthIdError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [roleAnnouncement, setRoleAnnouncement] = useState<string>('Student portal selected');

  // Network offline state listener
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // WebAuthn Two-Device Demo Authentication State
  const [showDemoAuthModal, setShowDemoAuthModal] = useState<boolean>(false);
  const [demoSessionInfo, setDemoSessionInfo] = useState<{ slot_id: string; device_label: string; expires_at: string } | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<Array<{
    userId: string;
    collegeId: string;
    fullName: string;
    email: string;
    role: string;
    portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE';
    assignedPriority: number | null;
    label: string;
  }>>([]);
  const [demoAccountsError, setDemoAccountsError] = useState<string | null>(null);

  // Password Recovery Modal State
  const [showForgotModal, setShowForgotModal] = useState<boolean>(false);
  const [forgotIdentifier, setForgotIdentifier] = useState<string>('');
  const [forgotIdentifierTouched, setForgotIdentifierTouched] = useState<boolean>(false);
  const [forgotIdentifierError, setForgotIdentifierError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState<boolean>(false);
  const [forgotResult, setForgotResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Reset Password Execution State
  const [resetTokenInput, setResetTokenInput] = useState<string>('');
  const [resetTokenTouched, setResetTokenTouched] = useState<boolean>(false);
  const [resetTokenError, setResetTokenError] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [newPasswordTouched, setNewPasswordTouched] = useState<boolean>(false);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<boolean>(false);

  // Focus tracking refs for accessible modal opening/closing
  const forgotPasswordTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const modalCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  // Check WebAuthn platform support
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isAvailable = !!(window.PublicKeyCredential && navigator.credentials);
      setWebAuthnSupported(isAvailable);
    }
  }, []);

  // Online / Offline monitor
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      setIsOnline(true);
      if (generalError?.isNetwork) setGeneralError(null);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setGeneralError({
        message: 'You are currently offline. Please check your internet connection.',
        isNetwork: true,
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [generalError]);

  const fetchAuthorizedAccounts = useCallback(() => {
    apiJson<{ success: boolean; accounts: any[]; error?: string }>('/api/demo/accounts')
      .then((accRes) => {
        if (accRes.success && accRes.accounts) {
          setDemoAccounts(accRes.accounts);
          setDemoAccountsError(null);
        }
      })
      .catch((err) => {
        setDemoAccountsError(err.message || 'Failed to load demo accounts');
      });
  }, []);

  useEffect(() => {
    const isHardwareUnlocked = typeof window !== 'undefined' && localStorage.getItem('dormex_hardware_unlocked') === 'true';
    if (!isHardwareUnlocked) {
      return;
    }

    fetch('/api/demo/access', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) {
          localStorage.removeItem('dormex_hardware_unlocked');
          return null;
        }
        return res.json();
      })
      .then((res: { authorized?: boolean; slot_id?: string; device_label?: string; expires_at?: string } | null) => {
        if (res && res.authorized && res.slot_id) {
          setDemoSessionInfo({
            slot_id: res.slot_id,
            device_label: res.device_label || 'Authorized Device',
            expires_at: res.expires_at || '',
          });
          fetchAuthorizedAccounts();
        }
      })
      .catch(() => {
        // Normal unauthenticated device
      });
  }, [fetchAuthorizedAccounts]);

  const handlePortalSelect = (portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE') => {
    setSelectedPortal(portal);
    setGeneralError(null);
    setAuthIdError(null);
    setPasswordError(null);
    setPasswordInput('');

    const portalNames = {
      STUDENT: 'Student portal selected',
      ADMIN: 'Administrative Staff portal selected',
      HOSTEL_OFFICE: 'Hostel Office portal selected',
    };
    setRoleAnnouncement(portalNames[portal]);

    if (portal === 'STUDENT') {
      setAuthIdInput('');
    } else if (portal === 'ADMIN') {
      setAuthIdInput('');
    } else if (portal === 'HOSTEL_OFFICE') {
      setAuthIdInput('');
    }
  };

  // Keyboard navigation for role selector tabs
  const handleRoleKeyDown = (e: React.KeyboardEvent, currentPortal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE') => {
    const order: Array<'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE'> = ['STUDENT', 'ADMIN', 'HOSTEL_OFFICE'];
    const currentIndex = order.indexOf(currentPortal);
    let nextIndex = currentIndex;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % order.length;
      handlePortalSelect(order[nextIndex]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + order.length) % order.length;
      handlePortalSelect(order[nextIndex]);
    }
  };

  const validateAuthId = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Institutional ID is required to sign in';
    }
    return null;
  };

  const validatePassword = (value: string): string | null => {
    if (!value) {
      return 'Password is required to sign in';
    }
    return null;
  };

  const handleAuthIdBlur = () => {
    setAuthIdTouched(true);
    const trimmed = authIdInput.trim();
    if (trimmed !== authIdInput) {
      setAuthIdInput(trimmed);
    }
    setAuthIdError(validateAuthId(trimmed));
  };

  const handlePasswordBlur = () => {
    setPasswordTouched(true);
    setPasswordError(validatePassword(passwordInput));
  };

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Guard: Prevent duplicate submissions or concurrent triggers
    if (isAuthenticating) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setGeneralError({
        message: 'Network offline: Please restore internet connection before signing in.',
        isNetwork: true,
      });
      return;
    }

    setAuthIdTouched(true);
    setPasswordTouched(true);

    const cleanId = authIdInput.trim();
    const idErr = validateAuthId(cleanId);
    const pwErr = validatePassword(passwordInput);

    setAuthIdError(idErr);
    setPasswordError(pwErr);

    if (idErr || pwErr) {
      return;
    }

    setGeneralError(null);
    setIsAuthenticating(true);

    try {
      await loginWithCredentials(selectedPortal, cleanId, passwordInput);
    } catch (err: any) {
      const errMsg = err?.message || '';
      const isNet =
        err instanceof TypeError ||
        errMsg.toLowerCase().includes('failed to fetch') ||
        errMsg.toLowerCase().includes('network') ||
        errMsg.toLowerCase().includes('offline');

      if (isNet) {
        setGeneralError({
          message: 'Network error: Unable to reach institutional authentication service. Please check your connection and retry.',
          isNetwork: true,
        });
      } else if (errMsg.includes('500') || errMsg.toLowerCase().includes('server error')) {
        setGeneralError({
          message: 'Authentication service temporarily unavailable. Please try again shortly.',
          isNetwork: true,
        });
      } else {
        setGeneralError({
          message: errMsg || 'Invalid institutional credentials or portal access denied.',
          isNetwork: false,
        });
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Focus trapping and keyboard management for Password Recovery Modal
  const openRecoveryModal = () => {
    setShowForgotModal(true);
    setForgotIdentifier(authIdInput.trim());
    setForgotResult(null);
    setForgotIdentifierTouched(false);
    setForgotIdentifierError(null);
    setResetTokenTouched(false);
    setResetTokenError(null);
    setNewPasswordTouched(false);
    setNewPasswordError(null);
  };

  const closeRecoveryModal = () => {
    setShowForgotModal(false);
    setForgotResult(null);
    setTimeout(() => {
      forgotPasswordTriggerRef.current?.focus();
    }, 50);
  };

  useEffect(() => {
    if (!showForgotModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRecoveryModal();
        return;
      }

      if (e.key === 'Tab') {
        const container = modalContainerRef.current;
        if (!container) return;

        const focusableElements = container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const timer = setTimeout(() => {
      modalCloseButtonRef.current?.focus();
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [showForgotModal]);

  return (
    <div className="min-h-screen bg-[#F7F6F1] dark:bg-[#071321] flex flex-col justify-between font-sans text-[#263345] dark:text-[#E2E8F0] transition-colors duration-150">
      {/* Live Region for Screen Reader Announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {roleAnnouncement}
      </div>

      {/* Top Institutional Header */}
      <header className="bg-white dark:bg-[#0A1929] border-b border-[#E2E6E8] dark:border-[#1E293B] px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between shadow-xs transition-colors">
        <DormexLogo theme="primary" size="md" className="h-7 sm:h-9 w-auto" />

        <div className="flex items-center gap-1.5 sm:gap-3">
          <ThemeToggle />

          {/* Institutional Pilot Scope Badge - Visible across all viewports down to 320px */}
          <div className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-[#F0F4F6] dark:bg-[#0E243A] text-[#203653] dark:text-[#E2E8F0] text-[10px] sm:text-xs font-semibold rounded-md sm:rounded-lg border border-[#D5DCDF] dark:border-[#203653] flex items-center gap-1">
            <span className="font-bold">Pilot:</span>
            <span>BVB Flr 2</span>
          </div>

          {/* Institutional Status Indicator (Non-interactive institutional security boundary indicator) */}
          <div
            className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-[#E7F2ED] text-[#1E7B54] text-[10px] sm:text-xs font-semibold rounded-md sm:rounded-lg border border-[#A8D5C2] flex items-center gap-1 sm:gap-1.5 shrink-0"
            role="status"
            aria-label="Institutional portal active"
          >
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#1E7B54] animate-pulse" aria-hidden="true" />
            <span className="hidden xs:inline">Institutional Portal</span>
            <span className="xs:hidden">Portal</span>
          </div>
        </div>
      </header>

      {/* Main Content: Focused Login Card */}
      <main className="max-w-xl mx-auto px-3 sm:px-6 py-6 sm:py-12 flex-1 flex flex-col justify-center w-full">
        {/* Institutional Header Banner */}
        <div className="text-center mb-5 sm:mb-8 space-y-1.5 sm:space-y-2">
          <div className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-0.5 sm:px-3 sm:py-1 bg-[#E7F2ED] border border-[#2C8279]/30 text-[#2C8279] rounded-full text-[11px] sm:text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-[#2C8279]" aria-hidden="true" />
            <span>DORMEX Allocation Platform</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#203653] tracking-tight">
            Institutional Sign In
          </h1>
          <p className="text-[#627084] text-xs sm:text-sm leading-relaxed max-w-sm mx-auto">
            Select your account type and enter your credentials to access the allocation workspace.
          </p>
        </div>

        {/* Global Server or General Error Banner */}
        {generalError && (
          <div
            id="login-general-error"
            role="alert"
            aria-live="assertive"
            className="mb-5 p-3.5 bg-[#FDE8E8] border border-[#F8B4B4] rounded-xl text-[#C93B3B] text-xs font-medium flex items-center justify-between gap-2.5 shadow-xs transition-all animate-fadeIn"
          >
            <div className="flex items-center gap-2">
              {generalError.isNetwork ? (
                <WifiOff className="w-4 h-4 text-[#C93B3B] shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[#C93B3B] shrink-0" aria-hidden="true" />
              )}
              <span>{generalError.message}</span>
            </div>
            {generalError.isNetwork && (
              <button
                type="button"
                onClick={() => handleLoginSubmit()}
                disabled={isAuthenticating}
                className="shrink-0 px-2 py-1 bg-white border border-[#F8B4B4] text-[#C93B3B] rounded-md font-bold text-[11px] hover:bg-[#FDE8E8] flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C93B3B]"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                <span>Retry</span>
              </button>
            )}
          </div>
        )}

        {/* Card Container */}
        <div className="bg-white dark:bg-[#0A1929] p-4 sm:p-7 rounded-2xl border border-[#E2E6E8] dark:border-[#1E293B] shadow-md hover:shadow-lg transition-all duration-200 w-full animate-fadeIn">
          {/* Role / Portal Selector */}
          <div className="mb-5 sm:mb-6 space-y-2">
            <div className="flex items-center justify-between">
              <label
                id="portal-selector-label"
                className="text-[11px] font-bold uppercase tracking-wider text-[#627084] dark:text-[#94A3B8] block"
              >
                Select Portal Access Option
              </label>
              <span className="text-[11px] text-[#627084] dark:text-[#94A3B8]">
                <span className="text-[#C93B3B] font-bold" aria-hidden="true">*</span>
                <span className="sr-only">Fields marked with asterisk are </span> required
              </span>
            </div>

            <div
              role="tablist"
              aria-labelledby="portal-selector-label"
              className="grid grid-cols-3 p-1 sm:p-1.5 bg-[#F0F4F6] dark:bg-[#071321] rounded-xl border border-[#E5E9EB] dark:border-[#1E293B] gap-1"
            >
              <button
                type="button"
                role="tab"
                id="tab-student"
                aria-selected={selectedPortal === 'STUDENT'}
                aria-controls="panel-login-credentials"
                tabIndex={selectedPortal === 'STUDENT' ? 0 : -1}
                onClick={() => handlePortalSelect('STUDENT')}
                onKeyDown={(e) => handleRoleKeyDown(e, 'STUDENT')}
                className={`min-h-[44px] py-2 px-1 sm:px-3 rounded-lg text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1 sm:gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] focus-visible:ring-offset-2 ${
                  selectedPortal === 'STUDENT'
                    ? 'bg-white dark:bg-[#0E243A] text-[#07203C] dark:text-[#F8FAFC] shadow-sm ring-1 ring-black/5 dark:ring-white/10 font-extrabold'
                    : 'text-[#627084] dark:text-[#94A3B8] hover:text-[#07203C] dark:hover:text-[#F8FAFC] hover:bg-white/40 dark:hover:bg-white/5'
                }`}
              >
                <GraduationCap className="w-4 h-4 text-[#016A62] dark:text-[#84D5CA] shrink-0" aria-hidden="true" />
                <span className="truncate">Student</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-admin"
                aria-selected={selectedPortal === 'ADMIN'}
                aria-controls="panel-login-credentials"
                tabIndex={selectedPortal === 'ADMIN' ? 0 : -1}
                onClick={() => handlePortalSelect('ADMIN')}
                onKeyDown={(e) => handleRoleKeyDown(e, 'ADMIN')}
                className={`min-h-[44px] py-2 px-1 sm:px-3 rounded-lg text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1 sm:gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] focus-visible:ring-offset-2 ${
                  selectedPortal === 'ADMIN'
                    ? 'bg-white dark:bg-[#0E243A] text-[#07203C] dark:text-[#F8FAFC] shadow-sm ring-1 ring-black/5 dark:ring-white/10 font-extrabold'
                    : 'text-[#627084] dark:text-[#94A3B8] hover:text-[#07203C] dark:hover:text-[#F8FAFC] hover:bg-white/40 dark:hover:bg-white/5'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-[#203653] dark:text-[#84D5CA] shrink-0" aria-hidden="true" />
                <span className="truncate">Admin</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-office"
                aria-selected={selectedPortal === 'HOSTEL_OFFICE'}
                aria-controls="panel-login-credentials"
                tabIndex={selectedPortal === 'HOSTEL_OFFICE' ? 0 : -1}
                onClick={() => handlePortalSelect('HOSTEL_OFFICE')}
                onKeyDown={(e) => handleRoleKeyDown(e, 'HOSTEL_OFFICE')}
                className={`min-h-[44px] py-2 px-1 sm:px-3 rounded-lg text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1 sm:gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] focus-visible:ring-offset-2 ${
                  selectedPortal === 'HOSTEL_OFFICE'
                    ? 'bg-white dark:bg-[#0E243A] text-[#07203C] dark:text-[#F8FAFC] shadow-sm ring-1 ring-black/5 dark:ring-white/10 font-extrabold'
                    : 'text-[#627084] dark:text-[#94A3B8] hover:text-[#07203C] dark:hover:text-[#F8FAFC] hover:bg-white/40 dark:hover:bg-white/5'
                }`}
              >
                <Building className="w-4 h-4 text-[#9C7A2E] shrink-0" aria-hidden="true" />
                <span className="truncate">Office</span>
              </button>
            </div>
          </div>

          {/* Panel Context Header */}
          <div
            id="panel-login-credentials"
            role="tabpanel"
            aria-labelledby={
              selectedPortal === 'STUDENT'
                ? 'tab-student'
                : selectedPortal === 'ADMIN'
                ? 'tab-admin'
                : 'tab-office'
            }
            className="pb-3.5 mb-4 border-b border-[#E2E6E8] dark:border-[#1E293B]"
          >
            <h2 className="text-sm font-bold text-[#203653] dark:text-[#F8FAFC] flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#016A62] dark:text-[#84D5CA]" aria-hidden="true" />
              <span>
                {selectedPortal === 'STUDENT'
                  ? 'Student Portal Sign In'
                  : selectedPortal === 'ADMIN'
                  ? 'Administrative Staff Sign In'
                  : 'Hostel Office Sign In'}
              </span>
            </h2>
            <p className="text-xs text-[#627084] dark:text-[#94A3B8] mt-1 leading-relaxed">
              {selectedPortal === 'STUDENT'
                ? 'Enter your Student USN / Institutional ID and account password to enter your turn allocation queue.'
                : selectedPortal === 'ADMIN'
                ? 'Enter your Warden / Administrator Staff ID and security key to open the administration console.'
                : 'Enter your Hostel Admissions Officer ID and credential to access student application registries.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLoginSubmit} noValidate className="space-y-4">
            {/* Field 1: Institutional ID */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="institutional-id-input"
                  className="text-xs font-semibold text-[#203653] flex items-center gap-1"
                >
                  <span>
                    {selectedPortal === 'STUDENT'
                      ? 'Student USN / Institutional ID'
                      : selectedPortal === 'ADMIN'
                      ? 'Staff ID / Administrator ID'
                      : 'Office Desk ID'}
                  </span>
                  <span className="text-[#C93B3B] font-bold" aria-hidden="true">*</span>
                  <span className="sr-only">(required)</span>
                </label>
              </div>

              <div className="relative">
                <input
                  id="institutional-id-input"
                  name="institutionalId"
                  type="text"
                  required
                  disabled={isAuthenticating}
                  value={authIdInput}
                  onChange={(e) => {
                    setAuthIdInput(e.target.value);
                    if (authIdTouched) {
                      setAuthIdError(validateAuthId(e.target.value));
                    }
                  }}
                  onBlur={handleAuthIdBlur}
                  aria-required="true"
                  aria-invalid={authIdTouched && !!authIdError}
                  aria-describedby={
                    authIdTouched && authIdError
                      ? 'institutional-id-error institutional-id-format'
                      : 'institutional-id-format'
                  }
                  placeholder={
                    selectedPortal === 'STUDENT'
                      ? 'e.g. 1SI21CS094 or student@college.edu'
                      : selectedPortal === 'ADMIN'
                      ? 'e.g. ADM001 or WRD001'
                      : 'e.g. OFF001'
                  }
                  className={`w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#071321] border rounded-xl px-3.5 py-3 pr-10 text-[#203653] dark:text-[#E2E8F0] transition-all outline-none disabled:opacity-60 ${
                    authIdTouched && authIdError
                      ? 'border-[#C93B3B] ring-2 ring-[#C93B3B]/20 bg-[#FDF2F2] dark:bg-[#3D1414]'
                      : 'border-[#E2E6E8] dark:border-[#1E293B] focus:border-[#016A62] dark:focus:border-[#84D5CA] focus:ring-2 focus:ring-[#016A62]'
                  }`}
                />
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084] dark:text-[#94A3B8]">
                  <UserCheck className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>

              {/* Format guidance */}
              <p id="institutional-id-format" className="text-[11px] text-[#627084] dark:text-[#94A3B8] mt-1">
                {selectedPortal === 'STUDENT'
                  ? 'Format: College USN (e.g., 1SI21CS094) or student email.'
                  : selectedPortal === 'ADMIN'
                  ? 'Format: Staff ID (e.g., ADM001, WRD001, CW001) or college email.'
                  : 'Format: Admissions desk ID (e.g., OFF001) or hostel office email.'}
              </p>

              {authIdTouched && authIdError && (
                <p
                  id="institutional-id-error"
                  role="alert"
                  className="text-xs text-[#C93B3B] mt-1 flex items-center gap-1 font-medium animate-fadeIn"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{authIdError}</span>
                </p>
              )}
            </div>

            {/* Field 2: Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password-credential-input"
                  className="text-xs font-semibold text-[#203653] dark:text-[#E2E8F0] flex items-center gap-1"
                >
                  <span>Account Password / Security Credential</span>
                  <span className="text-[#C93B3B] font-bold" aria-hidden="true">*</span>
                  <span className="sr-only">(required)</span>
                </label>

                <button
                  type="button"
                  disabled={isAuthenticating}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="text-[11px] text-[#016A62] dark:text-[#84D5CA] hover:text-[#0d6f66] font-semibold flex items-center gap-1 p-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
                >
                  {showPassword ? (
                    <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </button>
              </div>

              <div className="relative">
                <input
                  id="password-credential-input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  disabled={isAuthenticating}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    if (passwordTouched) {
                      setPasswordError(validatePassword(e.target.value));
                    }
                  }}
                  onBlur={handlePasswordBlur}
                  aria-required="true"
                  aria-invalid={passwordTouched && !!passwordError}
                  aria-describedby={passwordTouched && passwordError ? 'password-credential-error' : undefined}
                  placeholder="Enter account password..."
                  className={`w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#071321] border rounded-xl px-3.5 py-3 pr-10 text-[#203653] dark:text-[#E2E8F0] transition-all outline-none disabled:opacity-60 ${
                    passwordTouched && passwordError
                      ? 'border-[#C93B3B] ring-2 ring-[#C93B3B]/20 bg-[#FDF2F2] dark:bg-[#3D1414]'
                      : 'border-[#E2E6E8] dark:border-[#1E293B] focus:border-[#016A62] dark:focus:border-[#84D5CA] focus:ring-2 focus:ring-[#016A62]'
                  }`}
                />
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084] dark:text-[#94A3B8]">
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>

              {passwordTouched && passwordError && (
                <p
                  id="password-credential-error"
                  role="alert"
                  className="text-xs text-[#C93B3B] mt-1.5 flex items-center gap-1 font-medium animate-fadeIn"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{passwordError}</span>
                </p>
              )}
            </div>

            {/* Session Security Information (Confirmed by Fastify server cookie configuration) */}
            <div className="flex items-center gap-1.5 text-[11px] text-[#627084] pt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#016A62] shrink-0" aria-hidden="true" />
              <span>
                Protected 24-hour institutional session. Securely bound to your browser via HttpOnly cookie.
              </span>
            </div>

            {/* Submit Action and Loading State */}
            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={isAuthenticating}
                className="w-full min-h-[48px] py-3 px-4 bg-[#016A62] hover:bg-[#0d6f66] active:scale-[0.99] text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-75 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] focus-visible:ring-offset-2"
              >
                {isAuthenticating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>Authenticate with ID & Password</span>
                    <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </>
                )}
              </button>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-1 pt-1 text-center sm:text-left">
                <button
                  ref={forgotPasswordTriggerRef}
                  type="button"
                  onClick={openRecoveryModal}
                  className="text-xs text-[#016A62] hover:underline font-semibold flex items-center gap-1 rounded py-1 px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
                >
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Forgot password or lost credential?</span>
                </button>

                <span className="text-[11px] text-[#627084]">15-min single-use link</span>
              </div>
            </div>

            {/* Section 2: Hardware authentication progressive disclosure */}
            <div className="pt-3 border-t border-[#E2E6E8]">
              <button
                type="button"
                onClick={() => setShowMoreAuthOptions(!showMoreAuthOptions)}
                aria-expanded={showMoreAuthOptions}
                aria-controls="more-auth-options-panel"
                className="w-full py-2 px-3 text-xs font-semibold text-[#203653] hover:text-[#016A62] flex items-center justify-between rounded-lg hover:bg-[#F0F4F6] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
              >
                <div className="flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-[#1E7B54]" aria-hidden="true" />
                  <span>More sign-in options</span>
                </div>
                {showMoreAuthOptions ? (
                  <ChevronUp className="w-4 h-4 text-[#627084]" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#627084]" aria-hidden="true" />
                )}
              </button>

              {showMoreAuthOptions && (
                <div id="more-auth-options-panel" className="mt-2.5 space-y-3 p-3 bg-[#F7F9FA] rounded-xl border border-[#E2E6E8] animate-fadeIn">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-[#203653] flex items-center gap-1.5">
                      <Laptop className="w-3.5 h-3.5 text-[#1E7B54]" aria-hidden="true" />
                      <span>Device Biometrics & Hardware Keys</span>
                    </p>
                    <p className="text-[11px] text-[#627084] leading-relaxed">
                      Sign in using your device&apos;s built-in authenticator (Windows Hello, Touch ID, Face ID, or Android screen lock). Password sign-in remains the standard institutional method.
                    </p>
                  </div>

                  {!webAuthnSupported ? (
                    <div className="p-2.5 bg-[#FFF0E6] border border-[#FFD1B3] rounded-lg text-[#E06A26] text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <span className="font-bold">Browser Not Supported:</span> Your current browser does not support WebAuthn hardware biometric authentication. Please continue with your institutional password above.
                      </div>
                    </div>
                  ) : demoSessionInfo ? (
                    <div className="p-3 bg-[#E7F2ED] border border-[#A8D5C2] rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-[#1E7B54]" aria-hidden="true" />
                        <div>
                          <p className="text-xs font-bold text-[#1E7B54]">
                            Hardware-Bound Demo Active ({demoSessionInfo.slot_id})
                          </p>
                          <p className="text-[11px] text-[#2C8279]">
                            Device: {demoSessionInfo.device_label}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handlePortalSelect('STUDENT');
                          setAuthIdInput('DEMO-001');
                          setAuthIdError(null);
                        }}
                        className="py-1 px-2.5 bg-[#1E7B54] text-white text-xs font-bold rounded-lg hover:bg-[#165c3f] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E7B54]"
                      >
                        Enter Workspace
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowDemoAuthModal(true)}
                      className="w-full py-2.5 px-3 bg-white hover:bg-[#E5EFF5] border border-[#D0DFE8] text-[#203653] text-xs font-bold rounded-xl transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] shadow-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <Fingerprint className="w-4 h-4 text-[#1E7B54] shrink-0" aria-hidden="true" />
                        <span className="font-bold">Use device biometrics</span>
                      </div>
                      <span className="text-[11px] text-[#627084] font-normal sm:border-l sm:border-[#D0DFE8] sm:pl-2">
                        Fingerprint, Face ID or Windows Hello
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Dynamic Database Demo Account Selector: GATED to verified hardware demo */}
            {demoSessionInfo && (
              <div className="pt-2">
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="authorized-demo-account-select" className="text-[11px] font-semibold text-[#627084]">
                    Authorized Demo Accounts ({demoSessionInfo.slot_id}):
                  </label>
                  <span className="text-[10px] text-[#016A62] font-mono">Hardware Unlocked</span>
                </div>
                {demoAccountsError ? (
                  <div className="p-2 text-xs text-[#C93B3B] bg-[#FDE8E8] border border-[#F8B4B4] rounded-lg">
                    {demoAccountsError}
                  </div>
                ) : demoAccounts.length === 0 ? (
                  <div className="p-2 text-xs text-[#627084] bg-white border border-[#E2E6E8] rounded-lg">
                    Loading authorized demo accounts...
                  </div>
                ) : (
                  <select
                    id="authorized-demo-account-select"
                    value={authIdInput}
                    onChange={(e) => {
                      const collegeId = e.target.value;
                      setAuthIdInput(collegeId);
                      setAuthIdError(null);
                      const matched = demoAccounts.find((a) => a.collegeId === collegeId);
                      if (matched && matched.portal !== selectedPortal) {
                        setSelectedPortal(matched.portal);
                      }
                    }}
                    className="w-full text-xs bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl px-3 py-2.5 text-[#203653] focus:outline-none focus:ring-1 focus:ring-[#016A62]"
                  >
                    <option value="" disabled>-- Select Authorized Demo Account --</option>
                    {selectedPortal === 'STUDENT' ? (
                      <optgroup label="Student Demo Accounts (10 Accounts)">
                        {demoAccounts.filter((a) => a.portal === 'STUDENT').map((acc) => (
                          <option key={acc.userId} value={acc.collegeId}>
                            {acc.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : selectedPortal === 'HOSTEL_OFFICE' ? (
                      <optgroup label="Hostel Office Accounts (5 Accounts)">
                        {demoAccounts.filter((a) => a.portal === 'HOSTEL_OFFICE').map((acc) => (
                          <option key={acc.userId} value={acc.collegeId}>
                            {acc.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      <optgroup label="Administrative Staff Accounts (3 Accounts)">
                        {demoAccounts.filter((a) => a.portal === 'ADMIN').map((acc) => (
                          <option key={acc.userId} value={acc.collegeId}>
                            {acc.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Section 1: Reviewer / Evaluator Demo Access Guidance (Build-time Gated to VITE_ENABLE_DEMO_ACCESS === 'true') */}
        {isDemoAccessEnabled && (
          <aside
            aria-labelledby="demo-access-guidance-title"
            className="mt-6 p-4 sm:p-5 bg-white rounded-2xl border border-[#D5DCDF] shadow-xs text-xs space-y-3"
          >
            <div className="flex items-center gap-2 border-b border-[#E2E6E8] pb-2.5">
              <Info className="w-4 h-4 text-[#016A62] shrink-0" aria-hidden="true" />
              <h3 id="demo-access-guidance-title" className="font-bold text-[#203653]">
                Authorized Reviewer & Demo Access Guidance
              </h3>
            </div>

            <p className="text-[#627084] leading-relaxed text-[11px]">
              DORMEX provides isolated demo profiles for institutional audit and review. Selecting a role below prefills only the public institutional identifier. Authentication credentials must be verified via standard server validation.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {/* Student Demo Guidance */}
              <div className="p-3 bg-[#F7F9FA] rounded-xl border border-[#E2E6E8] flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-[#203653] mb-1">
                    <GraduationCap className="w-3.5 h-3.5 text-[#016A62]" aria-hidden="true" />
                    <span>Student Testing</span>
                  </div>
                  <p className="text-[11px] text-[#627084]">
                    ID: <code className="bg-white px-1 rounded text-[#203653] border border-[#E2E6E8]">DEMO-001</code> (Rank #1) to <code className="bg-white px-1 rounded text-[#203653] border border-[#E2E6E8]">DEMO-010</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handlePortalSelect('STUDENT');
                    setAuthIdInput('DEMO-001');
                    setAuthIdError(null);
                  }}
                  className="mt-2.5 text-[11px] font-bold text-[#016A62] hover:text-[#0d6f66] self-start focus:underline"
                >
                  Use Student ID →
                </button>
              </div>

              {/* Admin Demo Guidance */}
              <div className="p-3 bg-[#F7F9FA] rounded-xl border border-[#E2E6E8] flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-[#203653] mb-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#203653]" aria-hidden="true" />
                    <span>Admin Testing</span>
                  </div>
                  <p className="text-[11px] text-[#627084]">
                    ID: <code className="bg-white px-1 rounded text-[#203653] border border-[#E2E6E8]">ADM001</code> (Chief Warden) or <code className="bg-white px-1 rounded text-[#203653] border border-[#E2E6E8]">WRD001</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handlePortalSelect('ADMIN');
                    setAuthIdInput('ADM001');
                    setAuthIdError(null);
                  }}
                  className="mt-2.5 text-[11px] font-bold text-[#016A62] hover:text-[#0d6f66] self-start focus:underline"
                >
                  Use Admin ID →
                </button>
              </div>

              {/* Hostel Office Demo Guidance */}
              <div className="p-3 bg-[#F7F9FA] rounded-xl border border-[#E2E6E8] flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-[#203653] mb-1">
                    <Building className="w-3.5 h-3.5 text-[#9C7A2E]" aria-hidden="true" />
                    <span>Office Testing</span>
                  </div>
                  <p className="text-[11px] text-[#627084]">
                    ID: <code className="bg-white px-1 rounded text-[#203653] border border-[#E2E6E8]">OFF001</code> (Hostel Admissions Officer).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handlePortalSelect('HOSTEL_OFFICE');
                    setAuthIdInput('OFF001');
                    setAuthIdError(null);
                  }}
                  className="mt-2.5 text-[11px] font-bold text-[#016A62] hover:text-[#0d6f66] self-start focus:underline"
                >
                  Use Office ID →
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* Institutional Pilot Status Notice */}
        <div className="mt-6 text-center">
          <p className="text-xs text-[#627084]">
            Authorized Institutional Access Only • College IT Security Policy Enforced
          </p>
        </div>
      </main>

      {/* Hardware-Bound WebAuthn Demo Modal */}
      {showDemoAuthModal && (
        <DemoAuthModal
          onSuccess={(info) => {
            setShowDemoAuthModal(false);
            try {
              localStorage.setItem('dormex_hardware_unlocked', 'true');
            } catch {}
            setDemoSessionInfo({
              slot_id: info.slot_id,
              device_label: info.device_label,
              expires_at: info.expires_at,
            });
            fetchAuthorizedAccounts();
            handlePortalSelect('STUDENT');
            setAuthIdInput('DEMO-001');
            setPasswordInput('password1');
            setAuthIdError(null);
            setPasswordError(null);
          }}
          onCancel={() => setShowDemoAuthModal(false)}
        />
      )}

      {/* Password Recovery Modal */}
      {showForgotModal && (
        <div
          className="fixed inset-0 z-50 bg-[#203653]/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-modal-title"
          aria-describedby="recovery-modal-description"
        >
          {/* Backdrop click dismiss */}
          <div
            className="fixed inset-0 -z-10"
            onClick={closeRecoveryModal}
            aria-hidden="true"
          />

          <div
            ref={modalContainerRef}
            className="bg-white rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 border-t sm:border border-[#E2E6E8] shadow-2xl animate-fadeIn max-h-[90dvh] overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"
          >
            {/* Mobile Sheet Handle */}
            <div className="w-10 h-1 bg-[#D5DCDF] rounded-full mx-auto sm:hidden -mt-1 mb-1 shrink-0" aria-hidden="true" />

            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#E2E6E8] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#E7F2ED] text-[#1E7B54] flex items-center justify-center font-bold shrink-0">
                  <KeyRound className="w-5 h-5 text-[#1E7B54]" aria-hidden="true" />
                </div>
                <div>
                  <h3 id="recovery-modal-title" className="text-base font-bold text-[#203653]">
                    Institutional Password Recovery
                  </h3>
                  <p id="recovery-modal-description" className="text-xs text-[#627084]">
                    Single-use cryptographic token reset (expires in 15 minutes)
                  </p>
                </div>
              </div>
              <button
                ref={modalCloseButtonRef}
                type="button"
                onClick={closeRecoveryModal}
                aria-label="Close recovery modal"
                className="p-1 rounded-lg text-[#627084] hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Feedback notification */}
            {forgotResult && (
              <div
                role="alert"
                aria-live="polite"
                className={`p-3.5 rounded-lg text-xs font-medium space-y-1.5 flex items-start gap-2 ${
                  forgotResult.type === 'success'
                    ? 'bg-[#E7F2ED] border border-[#A8D5C2] text-[#1E7B54]'
                    : 'bg-[#FDE8E8] border border-[#F8B4B4] text-[#C93B3B]'
                }`}
              >
                {forgotResult.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div>{forgotResult.message}</div>
              </div>
            )}

            {!resetSuccess ? (
              <div className="space-y-4">
                {/* Step 1: Request Token */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setForgotIdentifierTouched(true);
                    if (!forgotIdentifier.trim()) {
                      setForgotIdentifierError('Institutional ID or registered email is required');
                      return;
                    }
                    setForgotIdentifierError(null);
                    setForgotLoading(true);
                    setForgotResult(null);
                    try {
                      const res = await apiFetch('/api/auth/forgot-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Password reset request failed');
                      setForgotResult({
                        type: 'success',
                        message: data.message,
                      });
                    } catch (err: any) {
                      setForgotResult({ type: 'error', message: err.message });
                    } finally {
                      setForgotLoading(false);
                    }
                  }}
                  noValidate
                  className="space-y-3"
                >
                  <div>
                    <label
                      htmlFor="recovery-identifier-input"
                      className="text-xs font-semibold text-[#203653] flex items-center gap-1 mb-1"
                    >
                      <span>Institutional ID or Registered Email</span>
                      <span className="text-[#C93B3B] font-bold" aria-hidden="true">*</span>
                      <span className="sr-only">(required)</span>
                    </label>
                    <input
                      id="recovery-identifier-input"
                      type="text"
                      required
                      value={forgotIdentifier}
                      onChange={(e) => {
                        setForgotIdentifier(e.target.value);
                        if (forgotIdentifierTouched) {
                          setForgotIdentifierError(!e.target.value.trim() ? 'Institutional ID or registered email is required' : null);
                        }
                      }}
                      onBlur={() => {
                        setForgotIdentifierTouched(true);
                        setForgotIdentifierError(!forgotIdentifier.trim() ? 'Institutional ID or registered email is required' : null);
                      }}
                      aria-required="true"
                      aria-invalid={forgotIdentifierTouched && !!forgotIdentifierError}
                      aria-describedby={forgotIdentifierTouched && forgotIdentifierError ? 'recovery-id-error' : undefined}
                      placeholder="e.g. 1SI21CS094 or admin@college.edu"
                      className={`w-full text-xs font-mono bg-[#F7F6F1] border rounded-xl px-3.5 py-2.5 text-[#203653] outline-none transition-all ${
                        forgotIdentifierTouched && forgotIdentifierError
                          ? 'border-[#C93B3B] ring-2 ring-[#C93B3B]/20 bg-[#FDF2F2]'
                          : 'border-[#E2E6E8] focus:border-[#016A62] focus:ring-1 focus:ring-[#016A62]'
                      }`}
                    />
                    {forgotIdentifierTouched && forgotIdentifierError && (
                      <p id="recovery-id-error" role="alert" className="text-xs text-[#C93B3B] mt-1 flex items-center gap-1 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{forgotIdentifierError}</span>
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full min-h-[42px] py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] focus-visible:ring-offset-2"
                  >
                    {forgotLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                        <span>Dispatching Token...</span>
                      </>
                    ) : (
                      'Send Reset Instructions'
                    )}
                  </button>
                </form>

                {/* Step 2: Redeem Token & Set New Password */}
                <div className="pt-3 border-t border-[#E2E6E8] space-y-3">
                  <h4 className="text-xs font-bold text-[#203653] uppercase tracking-wider">
                    Have a Reset Token? Set New Password
                  </h4>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setResetTokenTouched(true);
                      setNewPasswordTouched(true);

                      const tokenErr = !resetTokenInput.trim() ? 'Reset token is required' : null;
                      const pwErr = !newPasswordInput ? 'New password is required' : newPasswordInput.length < 8 ? 'Password must be at least 8 characters' : null;

                      setResetTokenError(tokenErr);
                      setNewPasswordError(pwErr);

                      if (tokenErr || pwErr) return;

                      setForgotLoading(true);
                      setForgotResult(null);
                      try {
                        const res = await apiFetch('/api/auth/reset-password', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            token: resetTokenInput.trim(),
                            newPassword: newPasswordInput,
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || 'Password update failed');
                        setResetSuccess(true);
                        setForgotResult({
                          type: 'success',
                          message: data.message || 'Password successfully updated!',
                        });
                      } catch (err: any) {
                        setForgotResult({ type: 'error', message: err.message });
                      } finally {
                        setForgotLoading(false);
                      }
                    }}
                    noValidate
                    className="space-y-3"
                  >
                    <div>
                      <label
                        htmlFor="recovery-reset-token-input"
                        className="text-[11px] font-semibold text-[#627084] flex items-center gap-1 mb-1"
                      >
                        <span>Reset Token</span>
                        <span className="text-[#C93B3B] font-bold" aria-hidden="true">*</span>
                        <span className="sr-only">(required)</span>
                      </label>
                      <input
                        id="recovery-reset-token-input"
                        type="text"
                        required
                        value={resetTokenInput}
                        onChange={(e) => {
                          setResetTokenInput(e.target.value);
                          if (resetTokenTouched) {
                            setResetTokenError(!e.target.value.trim() ? 'Reset token is required' : null);
                          }
                        }}
                        onBlur={() => {
                          setResetTokenTouched(true);
                          setResetTokenError(!resetTokenInput.trim() ? 'Reset token is required' : null);
                        }}
                        aria-required="true"
                        aria-invalid={resetTokenTouched && !!resetTokenError}
                        aria-describedby={resetTokenTouched && resetTokenError ? 'recovery-token-error' : undefined}
                        placeholder="Paste single-use token..."
                        className={`w-full text-xs font-mono bg-[#F7F6F1] border rounded-xl px-3 py-2 text-[#203653] outline-none transition-all ${
                          resetTokenTouched && resetTokenError
                            ? 'border-[#C93B3B] ring-2 ring-[#C93B3B]/20 bg-[#FDF2F2]'
                            : 'border-[#E2E6E8] focus:border-[#016A62] focus:ring-1 focus:ring-[#016A62]'
                        }`}
                      />
                      {resetTokenTouched && resetTokenError && (
                        <p id="recovery-token-error" role="alert" className="text-xs text-[#C93B3B] mt-1 flex items-center gap-1 font-medium">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{resetTokenError}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="recovery-new-password-input"
                        className="text-[11px] font-semibold text-[#627084] flex items-center gap-1 mb-1"
                      >
                        <span>New Password (min. 8 characters)</span>
                        <span className="text-[#C93B3B] font-bold" aria-hidden="true">*</span>
                        <span className="sr-only">(required)</span>
                      </label>
                      <input
                        id="recovery-new-password-input"
                        type="password"
                        required
                        minLength={8}
                        value={newPasswordInput}
                        onChange={(e) => {
                          setNewPasswordInput(e.target.value);
                          if (newPasswordTouched) {
                            setNewPasswordError(!e.target.value ? 'New password is required' : e.target.value.length < 8 ? 'Password must be at least 8 characters' : null);
                          }
                        }}
                        onBlur={() => {
                          setNewPasswordTouched(true);
                          setNewPasswordError(!newPasswordInput ? 'New password is required' : newPasswordInput.length < 8 ? 'Password must be at least 8 characters' : null);
                        }}
                        aria-required="true"
                        aria-invalid={newPasswordTouched && !!newPasswordError}
                        aria-describedby={newPasswordTouched && newPasswordError ? 'recovery-new-pw-error' : undefined}
                        placeholder="Enter new secure password..."
                        className={`w-full text-xs font-mono bg-[#F7F6F1] border rounded-xl px-3 py-2 text-[#203653] outline-none transition-all ${
                          newPasswordTouched && newPasswordError
                            ? 'border-[#C93B3B] ring-2 ring-[#C93B3B]/20 bg-[#FDF2F2]'
                            : 'border-[#E2E6E8] focus:border-[#016A62] focus:ring-1 focus:ring-[#016A62]'
                        }`}
                      />
                      {newPasswordTouched && newPasswordError && (
                        <p id="recovery-new-pw-error" role="alert" className="text-xs text-[#C93B3B] mt-1 flex items-center gap-1 font-medium">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{newPasswordError}</span>
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={forgotLoading || !resetTokenInput.trim() || newPasswordInput.length < 8}
                      className="w-full min-h-[42px] py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] focus-visible:ring-offset-2"
                    >
                      {forgotLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                          <span>Updating Password...</span>
                        </>
                      ) : (
                        'Save New Password & Return to Login'
                      )}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={closeRecoveryModal}
                  className="w-full min-h-[44px] py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62] focus-visible:ring-offset-2"
                >
                  Return to Institutional Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-[#E2E6E8] px-6 py-4 text-center text-xs text-[#627084]">
        DORMEX College Hostel Allocation Platform • BVB Block Floor 2 Pilot • Authorized Institutional Access Only
      </footer>
    </div>
  );
};
