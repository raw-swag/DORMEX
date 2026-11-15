import React, { useState } from 'react';
import { 
  ShieldAlert, 
  KeyRound, 
  AlertCircle, 
  Loader2, 
  ArrowRight,
  X
} from 'lucide-react';

interface MfaStepUpModalProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const MfaStepUpModal: React.FC<MfaStepUpModalProps> = ({
  onSuccess,
  onCancel,
}) => {
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = totpCode.replace(/\s+/g, '');
    if (!cleanCode || cleanCode.length !== 6) {
      setError('Please enter a valid 6-digit TOTP code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/mfa/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code: cleanCode }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Step-up authorization failed');
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Step-up authorization failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#080F1C]/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-title"
    >
      <div className="bg-white dark:bg-[#111F32] rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E2E6E8] dark:border-[#293B52] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#E2E6E8] dark:border-[#293B52] pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FAF4E6] dark:bg-[#2C210B] text-[#9C7A2E] dark:text-[#FBBF24] flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="step-up-title" className="text-base font-bold text-[#203653] dark:text-[#F1F5F9]">
                Privilege Elevation Required
              </h3>
              <p className="text-xs text-[#627084] dark:text-[#91A4BA] mt-0.5">
                This administrative operation requires active TOTP step-up authentication.
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

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="step-up-code-input"
              className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] block mb-1.5"
            >
              Enter Authenticator 6-Digit Code
            </label>
            <div className="relative">
              <input
                id="step-up-code-input"
                name="stepUpTotpCode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setTotpCode(val);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                placeholder="000000"
                className="w-full text-center text-2xl font-mono tracking-widest bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-3 px-4 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62]"
                autoFocus
              />
              <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084] dark:text-[#91A4BA]">
                <KeyRound className="w-4 h-4" />
              </div>
            </div>
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
              disabled={isLoading || totpCode.length !== 6}
              className="py-2.5 px-5 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Elevating...</span>
                </>
              ) : (
                <>
                  <span>Elevate Session</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
