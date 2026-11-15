import React, { useState } from 'react';
import { 
  UserPlus, 
  KeyRound, 
  AlertCircle, 
  Loader2, 
  CheckCircle2, 
  Eye, 
  EyeOff, 
  ShieldCheck,
  ArrowRight,
  X
} from 'lucide-react';

interface AccountActivationModalProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const AccountActivationModal: React.FC<AccountActivationModalProps> = ({
  onSuccess,
  onCancel,
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = tokenInput.trim();
    if (!cleanToken) {
      setError('Activation voucher token is required');
      return;
    }
    if (!passwordInput || passwordInput.length < 8) {
      setError('Initial password must be at least 8 characters long');
      return;
    }
    if (passwordInput !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/auth/activate-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          token: cleanToken,
          initialPassword: passwordInput,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Account activation failed. Please check your voucher token.');
      }

      setSuccessMessage(data.message || 'Account activated successfully! You may now sign in.');
    } catch (err: any) {
      setError(err.message || 'Activation failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#080F1C]/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activate-account-title"
    >
      <div className="bg-white dark:bg-[#111F32] rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E2E6E8] dark:border-[#293B52] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#E2E6E8] dark:border-[#293B52] pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#016A62] dark:text-[#63D6C6] flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="activate-account-title" className="text-base font-bold text-[#203653] dark:text-[#F1F5F9]">
                Activate Institutional Account
              </h3>
              <p className="text-xs text-[#627084] dark:text-[#91A4BA] mt-0.5">
                Redeem your registrar voucher token and create your initial secure password.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg text-[#627084] dark:text-[#91A4BA] hover:bg-slate-100 dark:hover:bg-[#17283D]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 bg-[#FDE8E8] dark:bg-[#2D1214] border border-[#F8B4B4] dark:border-[#5C2326] text-[#C93B3B] dark:text-[#F87171] rounded-xl text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {successMessage ? (
          <div className="space-y-4 pt-2">
            <div className="p-4 bg-[#E7F2ED] dark:bg-[#0E2F2B] border border-[#A8D5C2] dark:border-[#1E5C50] rounded-xl flex items-start gap-2.5 text-xs text-[#1E7B54] dark:text-[#63D6C6] font-semibold">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-bold text-sm">Account Activated!</p>
                <p className="mt-1 font-normal text-xs">{successMessage}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onSuccess}
              className="w-full py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2"
            >
              <span>Return to Institutional Sign In</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="activation-voucher-token-input"
                className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] block mb-1"
              >
                Activation Voucher Token
              </label>
              <input
                id="activation-voucher-token-input"
                type="text"
                required
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                placeholder="Paste registrar voucher token..."
                className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-2.5 px-3 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62]"
              />
              <p className="text-[11px] text-[#627084] dark:text-[#91A4BA] mt-1">
                Issued in person by the Registrar or Hostel Admissions Office.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="activation-password-input"
                  className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9]"
                >
                  Create Initial Password (min. 8 characters)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-[#016A62] dark:text-[#63D6C6] font-semibold flex items-center gap-1"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              <input
                id="activation-password-input"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                placeholder="Enter password..."
                className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-2.5 px-3 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62]"
              />
            </div>

            <div>
              <label
                htmlFor="activation-confirm-password-input"
                className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] block mb-1"
              >
                Confirm Password
              </label>
              <input
                id="activation-confirm-password-input"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                placeholder="Re-enter password..."
                className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-2.5 px-3 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62]"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-[#627084] dark:text-[#91A4BA] hover:text-[#203653] dark:hover:text-[#F1F5F9]"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isLoading || !tokenInput.trim() || passwordInput.length < 8}
                className="py-2.5 px-5 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Activating...</span>
                  </>
                ) : (
                  <>
                    <span>Activate Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
