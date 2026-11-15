import React, { useState, useEffect, useRef } from 'react';
import { useAuth, apiFetch } from '../context/AuthContext.js';
import {
  GraduationCap,
  ShieldCheck,
  Building,
  ArrowRight,
  AlertCircle,
  KeyRound,
  UserCheck,
  Eye,
  EyeOff,
  HelpCircle,
  X,
  Loader2,
  CheckCircle2,
  Sparkles,
  UserPlus
} from 'lucide-react';
import { DormexLogo } from './DormexLogo.js';
import { ThemeToggle } from './ThemeToggle.js';
import { MfaChallengeModal } from './MfaChallengeModal.js';
import { MfaEnrollmentModal } from './MfaEnrollmentModal.js';
import { MfaRecoveryModal } from './MfaRecoveryModal.js';
import { AccountActivationModal } from './AccountActivationModal.js';

export const PortalSelectionView: React.FC = () => {
  const { 
    loginWithCredentials, 
    mfaChallenge, 
    completeMfaVerification, 
    clearMfaChallenge 
  } = useAuth();

  const [selectedPortal, setSelectedPortal] = useState<'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE'>('STUDENT');
  const [authIdInput, setAuthIdInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Form validation & submission state
  const [generalError, setGeneralError] = useState<{ message: string; isNetwork?: boolean } | null>(null);
  const [authIdTouched, setAuthIdTouched] = useState<boolean>(false);
  const [passwordTouched, setPasswordTouched] = useState<boolean>(false);
  const [authIdError, setAuthIdError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [roleAnnouncement, setRoleAnnouncement] = useState<string>('Student portal selected');

  // Modals
  const [showRecoveryModal, setShowRecoveryModal] = useState<boolean>(false);
  const [showActivationModal, setShowActivationModal] = useState<boolean>(false);
  const [showEmergencyRecoveryModal, setShowEmergencyRecoveryModal] = useState<boolean>(false);

  // Password Recovery state inside recovery modal
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

  const forgotPasswordTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const modalCloseButtonRef = useRef<HTMLButtonElement | null>(null);

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
  };

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
    if (isAuthenticating) return;

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
          message: 'Network error: Unable to reach institutional authentication service. Please check your connection.',
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

  const openRecoveryModal = () => {
    setShowRecoveryModal(true);
    setForgotIdentifier(authIdInput.trim());
    setForgotResult(null);
    setResetSuccess(false);
    setResetTokenInput('');
    setNewPasswordInput('');
  };

  const closeRecoveryModal = () => {
    setShowRecoveryModal(false);
    setForgotResult(null);
  };

  return (
    <div className="min-h-screen bg-[#F7F6F1] dark:bg-[#080F1C] flex flex-col justify-between font-sans text-[#263345] dark:text-[#F1F5F9] transition-colors duration-150 relative overflow-hidden">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {roleAnnouncement}
      </div>

      {/* Top Institutional Header */}
      <header className="bg-white/90 dark:bg-[#0D1929]/90 backdrop-blur-md border-b border-[#E2E6E8] dark:border-[#293B52] px-3 sm:px-8 py-3 flex items-center justify-between shadow-xs sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <DormexLogo theme="primary" size="md" className="h-7 sm:h-9 w-auto dark:hidden" />
          <DormexLogo theme="white" size="md" className="h-7 sm:h-9 w-auto hidden dark:block" />
          <div className="hidden md:flex flex-col border-l border-[#E2E6E8] dark:border-[#293B52] pl-3">
            <span className="text-[11px] font-bold text-[#203653] dark:text-[#F1F5F9] tracking-tight">Siddaganga Institute of Technology, Tumakuru</span>
            <span className="text-[10px] text-[#627084] dark:text-[#91A4BA]">Hostel Residence Allocation &amp; Administration</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <ThemeToggle />

          <div className="px-2.5 py-1 bg-[#F0F4F6] dark:bg-[#111F32] text-[#203653] dark:text-[#B7C6D8] text-[10px] sm:text-xs font-semibold rounded-lg border border-[#D5DCDF] dark:border-[#293B52] flex items-center gap-1.5">
            <span className="font-bold text-[#016A62] dark:text-[#63D6C6]">Pilot:</span>
            <span>BVB Block Flr 2</span>
          </div>

          <div
            className="px-2.5 py-1 bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#1E7B54] dark:text-[#63D6C6] text-[10px] sm:text-xs font-semibold rounded-lg border border-[#A8D5C2] dark:border-[#1E5C50] flex items-center gap-1.5 shrink-0"
            role="status"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#1E7B54] dark:bg-[#63D6C6] animate-pulse" aria-hidden="true" />
            <span>Institutional Portal</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 flex-1 flex flex-col justify-center w-full z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Context Introduction */}
          <div className="lg:col-span-5 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#E7F2ED] dark:bg-[#0E2F2B] border border-[#2C8279]/30 dark:border-[#1E5C50] text-[#016A62] dark:text-[#63D6C6] rounded-full text-xs font-semibold shadow-xs">
              <Sparkles className="w-3.5 h-3.5 text-[#016A62] dark:text-[#63D6C6]" aria-hidden="true" />
              <span>DORMEX Allocation Platform</span>
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-[#203653] dark:text-[#F1F5F9] tracking-tight leading-tight">
                Institutional <span className="text-[#016A62] dark:text-[#63D6C6]">Residency Sign In</span>
              </h1>
              <p className="text-[#627084] dark:text-[#B7C6D8] text-sm leading-relaxed max-w-md mx-auto lg:mx-0">
                Server-authoritative room selection and hostel governance system for students, wardens, and admissions administrators.
              </p>
            </div>

            <div className="hidden lg:grid grid-cols-1 gap-3 pt-2">
              <div className="p-3 bg-white/70 dark:bg-[#111F32]/80 rounded-xl border border-[#E2E6E8] dark:border-[#293B52] flex items-center gap-3 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#016A62] dark:text-[#63D6C6] flex items-center justify-center shrink-0">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#203653] dark:text-[#F1F5F9]">Student Queue &amp; CAD Maps</div>
                  <div className="text-[11px] text-[#627084] dark:text-[#91A4BA]">Real-time interactive turns with roommate synchronization</div>
                </div>
              </div>

              <div className="p-3 bg-white/70 dark:bg-[#111F32]/80 rounded-xl border border-[#E2E6E8] dark:border-[#293B52] flex items-center gap-3 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-[#FAF4E6] dark:bg-[#2C210B] text-[#9C7A2E] dark:text-[#FBBF24] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#203653] dark:text-[#F1F5F9]">Authoritative Administration &amp; MFA</div>
                  <div className="text-[11px] text-[#627084] dark:text-[#91A4BA]">RFC 6238 TOTP two-factor security for privileged hostel wardens</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Focused Institutional Sign In Card */}
          <div className="lg:col-span-7 max-w-xl mx-auto w-full">
            {generalError && (
              <div
                role="alert"
                className="mb-5 p-3.5 bg-[#FDE8E8] dark:bg-[#2D1214] border border-[#F8B4B4] dark:border-[#5C2326] rounded-xl text-[#C93B3B] dark:text-[#F87171] text-xs font-medium flex items-center gap-2.5 shadow-xs animate-fadeIn"
              >
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{generalError.message}</span>
              </div>
            )}

            <div className="bg-white dark:bg-[#111F32] p-5 sm:p-8 rounded-2xl border border-[#E2E6E8] dark:border-[#293B52] shadow-xl transition-all duration-200 w-full animate-fadeIn">
              {/* Role / Portal Selector */}
              <div className="mb-6 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label
                    id="portal-selector-label"
                    className="text-[11px] font-bold uppercase tracking-wider text-[#627084] dark:text-[#91A4BA] block"
                  >
                    Select Institutional Portal
                  </label>
                  <span className="text-[11px] text-[#627084] dark:text-[#91A4BA]">
                    <span className="text-[#C93B3B] dark:text-[#F87171] font-bold">*</span> required
                  </span>
                </div>

                <div
                  role="tablist"
                  aria-labelledby="portal-selector-label"
                  className="grid grid-cols-3 p-1.5 bg-[#F0F4F6] dark:bg-[#0A1626] rounded-xl border border-[#E5E9EB] dark:border-[#1B2C42] gap-1.5"
                >
                  <button
                    type="button"
                    role="tab"
                    id="tab-student"
                    aria-selected={selectedPortal === 'STUDENT'}
                    tabIndex={selectedPortal === 'STUDENT' ? 0 : -1}
                    onClick={() => handlePortalSelect('STUDENT')}
                    onKeyDown={(e) => handleRoleKeyDown(e, 'STUDENT')}
                    className={`min-h-[44px] py-2.5 px-1 sm:px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 outline-none ${
                      selectedPortal === 'STUDENT'
                        ? 'bg-white dark:bg-[#17283D] text-[#016A62] dark:text-[#63D6C6] shadow-sm font-extrabold'
                        : 'text-[#627084] dark:text-[#91A4BA] hover:text-[#203653]'
                    }`}
                  >
                    <GraduationCap className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Student</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    id="tab-admin"
                    aria-selected={selectedPortal === 'ADMIN'}
                    tabIndex={selectedPortal === 'ADMIN' ? 0 : -1}
                    onClick={() => handlePortalSelect('ADMIN')}
                    onKeyDown={(e) => handleRoleKeyDown(e, 'ADMIN')}
                    className={`min-h-[44px] py-2.5 px-1 sm:px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 outline-none ${
                      selectedPortal === 'ADMIN'
                        ? 'bg-white dark:bg-[#17283D] text-[#1D63B8] dark:text-[#60A5FA] shadow-sm font-extrabold'
                        : 'text-[#627084] dark:text-[#91A4BA] hover:text-[#203653]'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Admin</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    id="tab-office"
                    aria-selected={selectedPortal === 'HOSTEL_OFFICE'}
                    tabIndex={selectedPortal === 'HOSTEL_OFFICE' ? 0 : -1}
                    onClick={() => handlePortalSelect('HOSTEL_OFFICE')}
                    onKeyDown={(e) => handleRoleKeyDown(e, 'HOSTEL_OFFICE')}
                    className={`min-h-[44px] py-2.5 px-1 sm:px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 outline-none ${
                      selectedPortal === 'HOSTEL_OFFICE'
                        ? 'bg-white dark:bg-[#17283D] text-[#9C7A2E] dark:text-[#FBBF24] shadow-sm font-extrabold'
                        : 'text-[#627084] dark:text-[#91A4BA] hover:text-[#203653]'
                    }`}
                  >
                    <Building className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Office</span>
                  </button>
                </div>
              </div>

              {/* Panel Description */}
              <div
                className={`p-3.5 mb-5 rounded-xl border transition-all ${
                  selectedPortal === 'STUDENT'
                    ? 'bg-[#E7F2ED]/50 dark:bg-[#0E2F2B]/40 border-[#A8D5C2]/60 dark:border-[#1E5C50]'
                    : selectedPortal === 'ADMIN'
                    ? 'bg-[#EBF3FC]/50 dark:bg-[#0E2442]/40 border-[#A5C7F3]/60 dark:border-[#1D4E89]'
                    : 'bg-[#FAF4E6]/50 dark:bg-[#2C210B]/40 border-[#D4B779]/60 dark:border-[#7A5B14]'
                }`}
              >
                <div className="flex items-center gap-2">
                  {selectedPortal === 'STUDENT' ? (
                    <GraduationCap className="w-4 h-4 text-[#016A62] dark:text-[#63D6C6]" />
                  ) : selectedPortal === 'ADMIN' ? (
                    <ShieldCheck className="w-4 h-4 text-[#1D63B8] dark:text-[#60A5FA]" />
                  ) : (
                    <Building className="w-4 h-4 text-[#9C7A2E] dark:text-[#FBBF24]" />
                  )}
                  <h2 className="text-sm font-bold text-[#203653] dark:text-[#F1F5F9]">
                    {selectedPortal === 'STUDENT'
                      ? 'Student Portal Sign In'
                      : selectedPortal === 'ADMIN'
                      ? 'Administration Portal Sign In'
                      : 'Hostel Office Portal Sign In'}
                  </h2>
                </div>
                <p className="text-xs text-[#627084] dark:text-[#B7C6D8] mt-1.5 leading-relaxed">
                  {selectedPortal === 'STUDENT'
                    ? 'Enter your Student USN (e.g., 1SI25CS001) or college email and password.'
                    : selectedPortal === 'ADMIN'
                    ? 'Enter your Staff ID (e.g., ADM001, WRD001) or email and password. Privileged roles require TOTP MFA.'
                    : 'Enter your Admissions desk ID (e.g., OFF001) or official office email and password.'}
                </p>
              </div>

              {/* Login Form */}
              <form onSubmit={handleLoginSubmit} noValidate className="space-y-4">
                <div>
                  <label
                    htmlFor="institutional-id-input"
                    className="text-xs font-semibold text-[#203653] dark:text-[#E2E8F0] flex items-center gap-1 mb-1.5"
                  >
                    <span>
                      {selectedPortal === 'STUDENT'
                        ? 'Student USN / College Email'
                        : selectedPortal === 'ADMIN'
                        ? 'Staff ID / Administrator Email'
                        : 'Office Desk ID / Official Email'}
                    </span>
                    <span className="text-[#C93B3B] dark:text-[#F87171] font-bold">*</span>
                  </label>

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
                        if (authIdTouched) setAuthIdError(validateAuthId(e.target.value));
                      }}
                      onBlur={handleAuthIdBlur}
                      placeholder={
                        selectedPortal === 'STUDENT'
                          ? 'e.g. 1SI25CS042 or student@sit.ac.in'
                          : selectedPortal === 'ADMIN'
                          ? 'e.g. ADM001 or WRD001'
                          : 'e.g. OFF001'
                      }
                      className={`w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border rounded-xl px-3.5 py-3 pr-10 text-[#203653] dark:text-[#F1F5F9] placeholder-[#627084]/60 outline-none transition-all ${
                        authIdTouched && authIdError
                          ? 'border-[#C93B3B] dark:border-[#F87171] ring-2 ring-[#C93B3B]/20'
                          : 'border-[#E2E6E8] dark:border-[#293B52] focus:border-[#016A62] focus:ring-2 focus:ring-[#016A62]/20'
                      }`}
                    />
                    <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084]">
                      <UserCheck className="w-4 h-4" />
                    </div>
                  </div>

                  {authIdTouched && authIdError && (
                    <p className="text-xs text-[#C93B3B] dark:text-[#F87171] mt-1 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{authIdError}</span>
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="password-credential-input"
                      className="text-xs font-semibold text-[#203653] dark:text-[#E2E8F0] flex items-center gap-1"
                    >
                      <span>Account Password</span>
                      <span className="text-[#C93B3B] dark:text-[#F87171] font-bold">*</span>
                    </label>

                    <button
                      type="button"
                      disabled={isAuthenticating}
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-[11px] text-[#016A62] dark:text-[#63D6C6] font-semibold flex items-center gap-1 p-1 rounded"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
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
                        if (passwordTouched) setPasswordError(validatePassword(e.target.value));
                      }}
                      onBlur={handlePasswordBlur}
                      placeholder="Enter account password..."
                      className={`w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border rounded-xl px-3.5 py-3 pr-10 text-[#203653] dark:text-[#F1F5F9] placeholder-[#627084]/60 outline-none transition-all ${
                        passwordTouched && passwordError
                          ? 'border-[#C93B3B] dark:border-[#F87171] ring-2 ring-[#C93B3B]/20'
                          : 'border-[#E2E6E8] dark:border-[#293B52] focus:border-[#016A62] focus:ring-2 focus:ring-[#016A62]/20'
                      }`}
                    />
                    <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084]">
                      <KeyRound className="w-4 h-4" />
                    </div>
                  </div>

                  {passwordTouched && passwordError && (
                    <p className="text-xs text-[#C93B3B] dark:text-[#F87171] mt-1.5 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{passwordError}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-[#627084] dark:text-[#91A4BA] pt-0.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#016A62] dark:text-[#63D6C6] shrink-0" />
                  <span>Protected 24-hour institutional session secured via HttpOnly cookies.</span>
                </div>

                <div className="pt-2 space-y-3">
                  <button
                    type="submit"
                    disabled={isAuthenticating}
                    className="w-full min-h-[48px] py-3 px-4 bg-[#016A62] hover:bg-[#0d6f66] active:scale-[0.99] text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-75"
                  >
                    {isAuthenticating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>Authenticating...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In to Institutional Portal</span>
                        <ArrowRight className="w-4 h-4 shrink-0" />
                      </>
                    )}
                  </button>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-1 border-t border-[#E2E6E8] dark:border-[#293B52]">
                    <button
                      ref={forgotPasswordTriggerRef}
                      type="button"
                      onClick={openRecoveryModal}
                      className="text-xs text-[#016A62] dark:text-[#63D6C6] hover:underline font-semibold flex items-center gap-1 py-1"
                    >
                      <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Forgot password?</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowActivationModal(true)}
                      className="text-xs text-[#1D63B8] dark:text-[#60A5FA] hover:underline font-semibold flex items-center gap-1 py-1"
                    >
                      <UserPlus className="w-3.5 h-3.5 shrink-0" />
                      <span>Activate new account</span>
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div className="mt-6 text-center">
              <p className="text-xs text-[#627084] dark:text-[#91A4BA]">
                Authorized Institutional Access Only • College IT Security Policy Enforced
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* MFA Challenge Modal (Prompted when backend requires TOTP) */}
      {mfaChallenge && (
        <MfaChallengeModal
          challengeToken={mfaChallenge.challengeToken}
          onSuccess={(verifiedSession) => {
            completeMfaVerification(verifiedSession);
          }}
          onCancel={() => {
            clearMfaChallenge();
          }}
          onFallbackRecovery={() => {
            clearMfaChallenge();
            setShowEmergencyRecoveryModal(true);
          }}
        />
      )}

      {/* Emergency Recovery Code Access Modal */}
      {showEmergencyRecoveryModal && (
        <MfaRecoveryModal
          initialIdentifier={authIdInput.trim()}
          onSuccess={() => {
            setShowEmergencyRecoveryModal(false);
            window.location.reload();
          }}
          onCancel={() => setShowEmergencyRecoveryModal(false)}
        />
      )}

      {/* Account Activation Modal */}
      {showActivationModal && (
        <AccountActivationModal
          onSuccess={() => {
            setShowActivationModal(false);
          }}
          onCancel={() => setShowActivationModal(false)}
        />
      )}

      {/* Password Recovery Modal */}
      {showRecoveryModal && (
        <div
          className="fixed inset-0 z-50 bg-[#080F1C]/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-modal-title"
        >
          <div className="fixed inset-0 -z-10" onClick={closeRecoveryModal} aria-hidden="true" />
          <div
            ref={modalContainerRef}
            className="bg-white dark:bg-[#111F32] rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 border-t sm:border border-[#E2E6E8] dark:border-[#293B52] shadow-2xl animate-fadeIn max-h-[90dvh] overflow-y-auto"
          >
            <div className="flex items-start justify-between border-b border-[#E2E6E8] dark:border-[#293B52] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#1E7B54] dark:text-[#63D6C6] flex items-center justify-center font-bold shrink-0">
                  <KeyRound className="w-5 h-5 text-[#1E7B54] dark:text-[#63D6C6]" />
                </div>
                <div>
                  <h3 id="recovery-modal-title" className="text-base font-bold text-[#203653] dark:text-[#F1F5F9]">
                    Institutional Password Recovery
                  </h3>
                  <p className="text-xs text-[#627084] dark:text-[#91A4BA]">
                    Single-use cryptographic token reset (expires in 15 minutes)
                  </p>
                </div>
              </div>
              <button
                ref={modalCloseButtonRef}
                type="button"
                onClick={closeRecoveryModal}
                className="p-1 rounded-lg text-[#627084] dark:text-[#91A4BA] hover:bg-slate-100 dark:hover:bg-[#17283D]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {forgotResult && (
              <div
                role="alert"
                className={`p-3.5 rounded-lg text-xs font-medium flex items-start gap-2 ${
                  forgotResult.type === 'success'
                    ? 'bg-[#E7F2ED] dark:bg-[#0E2F2B] border border-[#A8D5C2] text-[#1E7B54] dark:text-[#63D6C6]'
                    : 'bg-[#FDE8E8] dark:bg-[#2D1214] border border-[#F8B4B4] text-[#C93B3B] dark:text-[#F87171]'
                }`}
              >
                {forgotResult.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
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
                      setForgotResult({ type: 'success', message: data.message });
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
                      className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] flex items-center gap-1 mb-1"
                    >
                      <span>Institutional ID or Registered Email</span>
                      <span className="text-[#C93B3B] dark:text-[#F87171] font-bold">*</span>
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
                      placeholder="e.g. 1SI25CS042 or admin@sit.ac.in"
                      className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border rounded-xl px-3.5 py-2.5 text-[#203653] dark:text-[#F1F5F9] outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full min-h-[42px] py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {forgotLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>Dispatching Token...</span>
                      </>
                    ) : (
                      'Send Reset Instructions'
                    )}
                  </button>
                </form>

                {/* Step 2: Redeem Token & Set New Password */}
                <div className="pt-3 border-t border-[#E2E6E8] dark:border-[#293B52] space-y-3">
                  <h4 className="text-xs font-bold text-[#203653] dark:text-[#F1F5F9] uppercase tracking-wider">
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
                        className="text-[11px] font-semibold text-[#627084] dark:text-[#91A4BA] flex items-center gap-1 mb-1"
                      >
                        <span>Reset Token</span>
                        <span className="text-[#C93B3B] dark:text-[#F87171] font-bold">*</span>
                      </label>
                      <input
                        id="recovery-reset-token-input"
                        type="text"
                        required
                        value={resetTokenInput}
                        onChange={(e) => setResetTokenInput(e.target.value)}
                        placeholder="Paste single-use token..."
                        className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border rounded-xl px-3 py-2 text-[#203653] dark:text-[#F1F5F9] outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="recovery-new-password-input"
                        className="text-[11px] font-semibold text-[#627084] dark:text-[#91A4BA] flex items-center gap-1 mb-1"
                      >
                        <span>New Password (min. 8 characters)</span>
                        <span className="text-[#C93B3B] dark:text-[#F87171] font-bold">*</span>
                      </label>
                      <input
                        id="recovery-new-password-input"
                        type="password"
                        required
                        minLength={8}
                        value={newPasswordInput}
                        onChange={(e) => setNewPasswordInput(e.target.value)}
                        placeholder="Enter new secure password..."
                        className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border rounded-xl px-3 py-2 text-[#203653] dark:text-[#F1F5F9] outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={forgotLoading || !resetTokenInput.trim() || newPasswordInput.length < 8}
                      className="w-full min-h-[42px] py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {forgotLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
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
                  className="w-full min-h-[44px] py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
                >
                  Return to Institutional Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white/80 dark:bg-[#0D1929]/80 backdrop-blur-md border-t border-[#E2E6E8] dark:border-[#293B52] px-6 py-4 text-center text-xs text-[#627084] dark:text-[#91A4BA] transition-colors z-10">
        DORMEX College Hostel Allocation Platform • BVB Block Floor 2 Pilot • Authorized Institutional Access Only
      </footer>
    </div>
  );
};
