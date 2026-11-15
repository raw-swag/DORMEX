import React, { useState } from 'react';
import { 
  ShieldCheck, 
  KeyRound, 
  AlertCircle, 
  Loader2, 
  HelpCircle,
  ArrowRight
} from 'lucide-react';

interface MfaChallengeModalProps {
  challengeToken: string;
  onSuccess: (session: any) => void;
  onCancel: () => void;
  onFallbackRecovery: () => void;
}

export const MfaChallengeModal: React.FC<MfaChallengeModalProps> = ({
  challengeToken,
  onSuccess,
  onCancel,
  onFallbackRecovery,
}) => {
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = totpCode.replace(/\s+/g, '');
    if (!cleanCode || cleanCode.length !== 6) {
      setError('Please enter a valid 6-digit TOTP verification code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          challengeToken,
          code: cleanCode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'MFA verification failed. Please check the code.');
      }

      onSuccess(data.session);
    } catch (err: any) {
      setError(err.message || 'MFA verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#080F1C]/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-challenge-title"
    >
      <div className="bg-white dark:bg-[#111F32] rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E2E6E8] dark:border-[#293B52] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[#E2E6E8] dark:border-[#293B52] pb-4">
          <div className="w-10 h-10 rounded-xl bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#016A62] dark:text-[#63D6C6] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 id="mfa-challenge-title" className="text-base font-bold text-[#203653] dark:text-[#F1F5F9]">
              Two-Factor Authentication
            </h3>
            <p className="text-xs text-[#627084] dark:text-[#91A4BA] mt-0.5">
              Enter the 6-digit time-based code from your authenticator app (Google Authenticator, Microsoft Authenticator, or Aegis).
            </p>
          </div>
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

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="mfa-code-input"
              className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] block mb-1.5"
            >
              6-Digit Authenticator Code
            </label>
            <div className="relative">
              <input
                id="mfa-code-input"
                name="totpCode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setTotpCode(val);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                placeholder="000000"
                className="w-full text-center text-2xl font-mono tracking-widest bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-3 px-4 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62] dark:focus:ring-[#63D6C6]"
                autoFocus
              />
              <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084] dark:text-[#91A4BA]">
                <KeyRound className="w-4 h-4" aria-hidden="true" />
              </div>
            </div>
            <p className="text-[11px] text-[#627084] dark:text-[#91A4BA] mt-1.5 text-center">
              Codes rotate automatically every 30 seconds.
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading || totpCode.length !== 6}
            className="w-full min-h-[46px] py-2.5 px-4 bg-[#016A62] hover:bg-[#0d6f66] active:scale-[0.99] text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#63D6C6]"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                <span>Verifying TOTP...</span>
              </>
            ) : (
              <>
                <span>Complete Institutional Sign In</span>
                <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-[#E2E6E8] dark:border-[#293B52] flex items-center justify-between">
          <button
            type="button"
            onClick={onFallbackRecovery}
            className="text-xs text-[#016A62] dark:text-[#63D6C6] hover:underline font-semibold flex items-center gap-1 focus:outline-none"
          >
            <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Use single-use recovery code</span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[#627084] dark:text-[#91A4BA] hover:text-[#203653] dark:hover:text-[#F1F5F9] font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
