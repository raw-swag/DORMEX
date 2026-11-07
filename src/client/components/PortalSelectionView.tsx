import React, { useState, useEffect } from 'react';
import { useAuth, DEV_USERS, apiFetch } from '../context/AuthContext.js';
import { apiJson } from '../api/apiJson.js';
import { 
  GraduationCap, 
  ShieldCheck, 
  Building, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  Sparkles, 
  School,
  KeyRound,
  UserCheck,
  Eye,
  EyeOff,
  HelpCircle,
  X,
  Fingerprint
} from 'lucide-react';
import { DemoAuthModal } from './DemoAuthModal.js';
import { DormexLogo } from './DormexLogo.js';

export const PortalSelectionView: React.FC = () => {
  const { login, loginWithCredentials, isDevMode } = useAuth();
  const [selectedPortal, setSelectedPortal] = useState<'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE'>('STUDENT');
  const [selectedUserKey, setSelectedUserKey] = useState<string>('demo1');
  const [authIdInput, setAuthIdInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  useEffect(() => {
    // Probe server-authoritative endpoint: GET /api/demo/access
    apiJson<{ authorized: boolean; slot_id?: string; device_label?: string; expires_at?: string }>('/api/demo/access')
      .then((res) => {
        if (res.authorized && res.slot_id) {
          setDemoSessionInfo({
            slot_id: res.slot_id,
            device_label: res.device_label || 'Authorized Device',
            expires_at: res.expires_at || '',
          });
          // Fetch dynamic demo accounts exclusively for authorized devices
          apiJson<{ success: boolean; accounts: any[]; error?: string }>('/api/demo/accounts')
            .then((accRes) => {
              if (accRes.success && accRes.accounts) {
                setDemoAccounts(accRes.accounts);
              }
            })
            .catch((err) => {
              setDemoAccountsError(err.message || 'Failed to load demo accounts');
            });
        }
      })
      .catch(() => {
        // Normal device: demo entry point remains unauthenticated
      });
  }, []);

  // Forgot Password Modal State (Phase Five)
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Reset Password Execution State
  const [resetTokenInput, setResetTokenInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);



  const handlePortalSelect = (portal: 'STUDENT' | 'ADMIN' | 'HOSTEL_OFFICE') => {
    setSelectedPortal(portal);
    setErrorMsg(null);
    setPasswordInput('');
    if (portal === 'STUDENT') {
      setSelectedUserKey('demo1');
      setAuthIdInput('DEMO-001');
    }
    if (portal === 'ADMIN') {
      setSelectedUserKey('superAdmin');
      setAuthIdInput('ADM001');
    }
    if (portal === 'HOSTEL_OFFICE') {
      setSelectedUserKey('hostelOffice');
      setAuthIdInput('OFF001');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPortal) return;
    setErrorMsg(null);
    try {
      if (!authIdInput.trim()) {
        setErrorMsg('Please enter your Institutional ID or email address');
        return;
      }
      if (!passwordInput) {
        setErrorMsg('Please enter your password');
        return;
      }
      await loginWithCredentials(selectedPortal, authIdInput, passwordInput);
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F1] flex flex-col justify-between font-sans">
      {/* Top Header */}
      <header className="bg-white border-b border-[#E2E6E8] px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between">
        <DormexLogo theme="primary" size="md" className="h-8 sm:h-10 w-auto" />

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-[11px] sm:text-xs text-[#627084] hidden md:inline">Pilot Scope: BVB Block • Floor 2</span>
          <div className="px-2 sm:px-2.5 py-1 bg-[#E7F2ED] text-[#1E7B54] text-[11px] sm:text-xs font-semibold rounded-lg border border-[#A8D5C2] flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#1E7B54] animate-pulse" />
            <span>Institutional Portal</span>
          </div>
        </div>
      </header>

      {/* Main Content: Single Focused Login Card with 3-Toggle Portal Selector */}
      <main className="max-w-xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-1 flex flex-col justify-center w-full">
        <div className="text-center mb-6 sm:mb-8 space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#E7F2ED] border border-[#2C8279]/30 text-[#2C8279] rounded-full text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-[#2C8279]" />
            DORMEX Allocation Platform
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#203653] tracking-tight">
            Institutional Sign In
          </h1>
          <p className="text-[#627084] text-xs sm:text-sm leading-relaxed max-w-sm mx-auto">
            Select your account type and enter your credentials to access the allocation workspace.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-5 sm:mb-6 p-3 sm:p-3.5 bg-[#FDE8E8] border border-[#F8B4B4] rounded-xl text-[#C93B3B] text-xs font-medium flex items-center gap-2.5 shadow-xs">
            <AlertCircle className="w-4 h-4 text-[#C93B3B] shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Three-Toggle Option Login Panel: ID + Password Credentials */}
        <div className="bg-white p-5 sm:p-7 rounded-2xl border border-[#E2E6E8] shadow-sm w-full animate-fadeIn">
            {/* 3-Toggle Portal Switcher */}
            <div className="mb-5 sm:mb-6 space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#627084] block">
                Select Portal Access Option
              </label>
              <div className="grid grid-cols-3 p-1 bg-[#F0F4F6] rounded-xl border border-[#E5E9EB] gap-1">
                <button
                  type="button"
                  onClick={() => handlePortalSelect('STUDENT')}
                  className={`min-h-[44px] py-2 px-1.5 sm:px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
                    selectedPortal === 'STUDENT'
                      ? 'bg-white text-[#07203C] shadow-xs'
                      : 'text-[#627084] hover:text-[#07203C]'
                  }`}
                >
                  <GraduationCap className="w-4 h-4 text-[#016A62] shrink-0" />
                  <span className="truncate">Student</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePortalSelect('ADMIN')}
                  className={`min-h-[44px] py-2 px-1.5 sm:px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
                    selectedPortal === 'ADMIN'
                      ? 'bg-white text-[#07203C] shadow-xs'
                      : 'text-[#627084] hover:text-[#07203C]'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-[#203653] shrink-0" />
                  <span className="truncate">Admin</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePortalSelect('HOSTEL_OFFICE')}
                  className={`min-h-[44px] py-2 px-1.5 sm:px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
                    selectedPortal === 'HOSTEL_OFFICE'
                      ? 'bg-white text-[#07203C] shadow-xs'
                      : 'text-[#627084] hover:text-[#07203C]'
                  }`}
                >
                  <Building className="w-4 h-4 text-[#9C7A2E] shrink-0" />
                  <span className="truncate">Office</span>
                </button>
              </div>
            </div>

            {/* Panel Title & Subtitle */}
            <div className="pb-4 mb-4 border-b border-[#E2E6E8]">
              <h4 className="text-sm font-bold text-[#203653] flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#016A62]" />
                <span>
                  {selectedPortal === 'STUDENT'
                    ? 'Student Portal Sign In'
                    : selectedPortal === 'ADMIN'
                    ? 'Administrative Staff Sign In'
                    : 'Hostel Office Sign In'}
                </span>
              </h4>
              <p className="text-xs text-[#627084] mt-1 leading-relaxed">
                {selectedPortal === 'STUDENT'
                  ? 'Enter your Student USN / Institutional ID and account password to enter your turn allocation queue.'
                  : selectedPortal === 'ADMIN'
                  ? 'Enter your Warden / Administrator Staff ID and security key to open the administration console.'
                  : 'Enter your Hostel Admissions Officer ID and credential to access student application registries.'}
              </p>
            </div>

            {/* Credentials Login Form */}
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#203653] block mb-1.5">
                  {selectedPortal === 'STUDENT'
                    ? 'Student USN / Institutional ID'
                    : selectedPortal === 'ADMIN'
                    ? 'Staff ID / Administrator ID'
                    : 'Office Desk ID'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={authIdInput}
                    onChange={(e) => setAuthIdInput(e.target.value)}
                    placeholder={
                      selectedPortal === 'STUDENT'
                        ? 'e.g. DEMO-001 or 1SI21CS094'
                        : selectedPortal === 'ADMIN'
                        ? 'e.g. ADM001 or WRD001'
                        : 'e.g. OFF001'
                    }
                    className="w-full text-xs font-mono bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl px-3.5 py-3 text-[#203653] focus:outline-none focus:ring-2 focus:ring-[#016A62] transition-all"
                  />
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084]">
                    <UserCheck className="w-4 h-4" />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#203653]">
                    Account Password / Security Credential
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[11px] text-[#016A62] hover:text-[#0d6f66] font-medium flex items-center gap-1 p-1"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showPassword ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Enter account password..."
                    className="w-full text-xs font-mono bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl px-3.5 py-3 text-[#203653] focus:outline-none focus:ring-2 focus:ring-[#016A62] transition-all"
                  />
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084]">
                    <KeyRound className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {/* Dynamic Database Demo Account Selector: STRICTLY GATED to verified hardware-bound demo sessions only */}
              {demoSessionInfo && (
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-[#627084]">
                      Authorized Demo Accounts ({demoSessionInfo.slot_id}):
                    </span>
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
                      value={authIdInput}
                      onChange={(e) => {
                        const collegeId = e.target.value;
                        setAuthIdInput(collegeId);
                        const matched = demoAccounts.find((a) => a.collegeId === collegeId);
                        if (matched && matched.portal !== selectedPortal) {
                          setSelectedPortal(matched.portal);
                        }
                      }}
                      className="w-full text-xs bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl px-3 py-2.5 text-[#203653] focus:outline-none focus:ring-1 focus:ring-[#016A62]"
                    >
                      <option value="" disabled>-- Select Authorized Demo Account --</option>
                      <optgroup label="Students (10 Accounts)">
                        {demoAccounts.filter((a) => a.portal === 'STUDENT').map((acc) => (
                          <option key={acc.userId} value={acc.collegeId}>
                            {acc.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Hostel Office (5 Accounts)">
                        {demoAccounts.filter((a) => a.portal === 'HOSTEL_OFFICE').map((acc) => (
                          <option key={acc.userId} value={acc.collegeId}>
                            {acc.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Administrative Staff (3 Accounts)">
                        {demoAccounts.filter((a) => a.portal === 'ADMIN').map((acc) => (
                          <option key={acc.userId} value={acc.collegeId}>
                            {acc.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  )}
                </div>
              )}


            {/* Dedicated Hardware-Bound WebAuthn Demo Entry Point */}
            <div className="pt-4 border-t border-[#E2E6E8] mt-4">
              {demoSessionInfo ? (
                <div className="p-3 bg-[#E7F2ED] border border-[#A8D5C2] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#1E7B54]" />
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
                      // Switch to quick demo student login
                      handlePortalSelect('STUDENT');
                      setAuthIdInput('DEMO-001');
                      setPasswordInput('password1');
                    }}
                    className="py-1 px-2.5 bg-[#1E7B54] text-white text-xs font-bold rounded-lg hover:bg-[#165c3f] transition-all"
                  >
                    Enter Workspace
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDemoAuthModal(true)}
                  className="w-full py-2.5 px-3 bg-[#F0F5F8] hover:bg-[#E5EFF5] border border-[#D0DFE8] text-[#203653] text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Fingerprint className="w-4 h-4 text-[#1E7B54]" />
                  <span>Two-Device Hardware Demo Auth (Windows Hello / Android)</span>
                </button>
              )}
            </div>

              <div className="pt-3 space-y-3">
                <button
                  type="submit"
                  className="w-full min-h-[48px] py-3 px-4 bg-[#016A62] hover:bg-[#0d6f66] active:scale-[0.99] text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2"
                >
                  <span>Authenticate with ID & Password</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-1 pt-1 text-center sm:text-left">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotModal(true);
                      setForgotIdentifier(authIdInput);
                      setForgotResult(null);
                    }}
                    className="text-xs text-[#016A62] hover:underline font-semibold flex items-center gap-1"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Forgot password or lost credential?</span>
                  </button>

                  <span className="text-[11px] text-[#627084]">15-min single-use link</span>
                </div>
              </div>
            </form>
          </div>
      </main>

      {/* Hardware-Bound WebAuthn Demo Modal */}
      {showDemoAuthModal && (
        <DemoAuthModal
          onSuccess={(info) => {
            setShowDemoAuthModal(false);
            setDemoSessionInfo({
              slot_id: info.slot_id,
              device_label: info.device_label,
              expires_at: info.expires_at,
            });
            // Automatically prefill DEMO-001 for seamless walkthrough
            handlePortalSelect('STUDENT');
            setAuthIdInput('DEMO-001');
            setPasswordInput('password1');
          }}
          onCancel={() => setShowDemoAuthModal(false)}
        />
      )}

      {/* Forgot Password / Recovery Modal (Phase Five) */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-[#203653]/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-[#E2E6E8] shadow-2xl animate-fadeIn">
            <div className="flex items-start justify-between border-b border-[#E2E6E8] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#E7F2ED] text-[#1E7B54] flex items-center justify-center font-bold">
                  <KeyRound className="w-5 h-5 text-[#1E7B54]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#203653]">Institutional Password Recovery</h3>
                  <p className="text-xs text-[#627084]">Single-use cryptographic token reset</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="p-1 rounded-lg text-[#627084] hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {forgotResult && (
              <div className={`p-3.5 rounded-lg text-xs font-medium space-y-1.5 ${
                forgotResult.type === 'success'
                  ? 'bg-[#E7F2ED] border border-[#A8D5C2] text-[#1E7B54]'
                  : 'bg-[#FDE8E8] border border-[#F8B4B4] text-[#C93B3B]'
              }`}>
                <div>{forgotResult.message}</div>
              </div>
            )}

            {!resetSuccess ? (
              <div className="space-y-4">
                {/* Step 1: Request Token */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setForgotLoading(true);
                    setForgotResult(null);
                    try {
                      const res = await apiFetch('/api/auth/forgot-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ identifier: forgotIdentifier }),
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
                  className="space-y-3"
                >
                  <div>
                    <label className="text-xs font-semibold text-[#203653] block mb-1">
                      Institutional ID or Registered Email
                    </label>
                    <input
                      type="text"
                      required
                      value={forgotIdentifier}
                      onChange={(e) => setForgotIdentifier(e.target.value)}
                      placeholder="e.g. DEMO-001 or admin@college.edu"
                      className="w-full text-xs font-mono bg-[#F7F6F1] border border-[#E2E6E8] rounded-lg px-3 py-2 text-[#203653] focus:outline-none focus:ring-1 focus:ring-[#016A62]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full py-2 bg-[#203653] hover:bg-[#17283B] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
                  >
                    {forgotLoading ? 'Dispatching Token...' : 'Send Reset Instructions'}
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
                      setForgotLoading(true);
                      setForgotResult(null);
                      try {
                        const res = await apiFetch('/api/auth/reset-password', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            token: resetTokenInput,
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
                    className="space-y-2.5"
                  >
                    <div>
                      <label className="text-[11px] font-semibold text-[#627084] block mb-1">Reset Token</label>
                      <input
                        type="text"
                        required
                        value={resetTokenInput}
                        onChange={(e) => setResetTokenInput(e.target.value)}
                        placeholder="Paste single-use token..."
                        className="w-full text-xs font-mono bg-[#F7F6F1] border border-[#E2E6E8] rounded px-2.5 py-1.5 text-[#203653]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#627084] block mb-1">New Password (min. 8 characters)</label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={newPasswordInput}
                        onChange={(e) => setNewPasswordInput(e.target.value)}
                        placeholder="Enter new secure password..."
                        className="w-full text-xs font-mono bg-[#F7F6F1] border border-[#E2E6E8] rounded px-2.5 py-1.5 text-[#203653]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={forgotLoading || !resetTokenInput || newPasswordInput.length < 8}
                      className="w-full py-2 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-lg shadow-xs transition-colors disabled:opacity-50"
                    >
                      {forgotLoading ? 'Updating Password...' : 'Save New Password & Return to Login'}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowForgotModal(false)}
                  className="w-full py-2.5 bg-[#016A62] text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  Return to Institutional Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-500">
        DORMEX College Hostel Allocation Platform • BVB Block Floor 2 Pilot • Authorized Institutional Access Only
      </footer>
    </div>
  );
};
