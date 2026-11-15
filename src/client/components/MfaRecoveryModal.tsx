import React, { useState } from 'react';
import { 
  ShieldCheck, 
  KeyRound, 
  AlertCircle, 
  Loader2, 
  ArrowRight,
  UserCheck
} from 'lucide-react';

interface MfaRecoveryModalProps {
  initialIdentifier?: string;
  onSuccess: (session?: any) => void;
  onCancel: () => void;
}

export const MfaRecoveryModal: React.FC<MfaRecoveryModalProps> = ({
  initialIdentifier = '',
  onSuccess,
  onCancel,
}) => {
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = identifier.trim().toLowerCase();
    const cleanCode = recoveryCode.trim();

    if (!cleanId) {
      setError('Institutional ID or official email is required');
      return;
    }
    if (!cleanCode) {
      setError('Single-use recovery code is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/mfa/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          identifier: cleanId,
          recoveryCode: cleanCode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Emergency recovery verification failed');
      }

      onSuccess(data.session);
    } catch (err: any) {
      setError(err.message || 'Recovery failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#080F1C]/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-code-title"
    >
      <div className="bg-white dark:bg-[#111F32] rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E2E6E8] dark:border-[#293B52] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[#E2E6E8] dark:border-[#293B52] pb-4">
          <div className="w-10 h-10 rounded-xl bg-[#FAF4E6] dark:bg-[#2C210B] text-[#9C7A2E] dark:text-[#FBBF24] flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 id="recovery-code-title" className="text-base font-bold text-[#203653] dark:text-[#F1F5F9]">
              Emergency Recovery Access
            </h3>
            <p className="text-xs text-[#627084] dark:text-[#91A4BA] mt-0.5">
              Redeem one of your 8 single-use emergency recovery codes to regain institutional account access.
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
              htmlFor="recovery-identity-input"
              className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] block mb-1.5"
            >
              Institutional Identifier
            </label>
            <div className="relative">
              <input
                id="recovery-identity-input"
                type="text"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                placeholder="e.g. ADM001 or staff@college.edu"
                className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-2.5 px-3 pr-10 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62]"
              />
              <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084] dark:text-[#91A4BA]">
                <UserCheck className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="recovery-code-input"
              className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] block mb-1.5"
            >
              Single-Use Emergency Code (e.g. 1a2b3c4d5e6f7a8b)
            </label>
            <div className="relative">
              <input
                id="recovery-code-input"
                type="text"
                value={recoveryCode}
                onChange={(e) => {
                  setRecoveryCode(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                placeholder="Paste single-use code..."
                className="w-full text-xs font-mono bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-2.5 px-3 pr-10 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62]"
              />
              <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-[#627084] dark:text-[#91A4BA]">
                <KeyRound className="w-4 h-4" />
              </div>
            </div>
            <p className="text-[11px] text-[#627084] dark:text-[#91A4BA] mt-1">
              Note: Using a recovery code invalidates that code permanently and prompts immediate re-enrollment.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-[#627084] dark:text-[#91A4BA] hover:text-[#203653] dark:hover:text-[#F1F5F9]"
            >
              Back to Login
            </button>

            <button
              type="submit"
              disabled={isLoading || !identifier.trim() || !recoveryCode.trim()}
              className="py-2.5 px-5 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <span>Redeem Emergency Code</span>
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
