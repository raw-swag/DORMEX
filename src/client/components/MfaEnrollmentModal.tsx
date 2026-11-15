import React, { useState } from 'react';
import { 
  ShieldCheck, 
  KeyRound, 
  AlertCircle, 
  Loader2, 
  CheckCircle2,
  Copy,
  ArrowRight
} from 'lucide-react';

interface MfaEnrollmentModalProps {
  challengeToken?: string;
  onSuccess: (elevatedToken?: string) => void;
  onCancel: () => void;
}

export const MfaEnrollmentModal: React.FC<MfaEnrollmentModalProps> = ({
  challengeToken,
  onSuccess,
  onCancel,
}) => {
  const [step, setStep] = useState<'fetch' | 'verify' | 'recovery'>('fetch');
  const [base32Secret, setBase32Secret] = useState<string>('');
  const [keyUri, setKeyUri] = useState<string>('');
  const [totpCode, setTotpCode] = useState<string>('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedCodes, setCopiedCodes] = useState<boolean>(false);

  // Initialize enrollment secret
  React.useEffect(() => {
    let mounted = true;
    const initiate = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (challengeToken) {
          headers['Authorization'] = `Bearer ${challengeToken}`;
        }
        const res = await fetch('/api/auth/mfa/enroll', {
          method: 'POST',
          headers,
          credentials: 'same-origin',
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to initialize MFA enrollment');
        }
        if (mounted) {
          setBase32Secret(data.base32Secret || '');
          setKeyUri(data.keyUri || '');
          setStep('verify');
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'MFA enrollment initialization failed');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initiate();
    return () => {
      mounted = false;
    };
  }, [challengeToken]);

  const handleVerifySetup = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = totpCode.replace(/\s+/g, '');
    if (!cleanCode || cleanCode.length !== 6) {
      setError('Please enter a 6-digit TOTP code to verify your authenticator');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (challengeToken) {
        headers['Authorization'] = `Bearer ${challengeToken}`;
      }
      const res = await fetch('/api/auth/mfa/verify-setup', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ code: cleanCode }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authenticator setup verification failed');
      }

      setRecoveryCodes(data.recoveryCodes || []);
      setStep('recovery');
    } catch (err: any) {
      setError(err.message || 'Setup verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const copySecret = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(base32Secret);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const copyAllRecoveryCodes = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#080F1C]/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-enrollment-title"
    >
      <div className="bg-white dark:bg-[#111F32] rounded-2xl max-w-lg w-full p-6 space-y-5 border border-[#E2E6E8] dark:border-[#293B52] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3 border-b border-[#E2E6E8] dark:border-[#293B52] pb-4">
          <div className="w-10 h-10 rounded-xl bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#016A62] dark:text-[#63D6C6] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 id="mfa-enrollment-title" className="text-base font-bold text-[#203653] dark:text-[#F1F5F9]">
              Mandatory Privileged MFA Enrollment
            </h3>
            <p className="text-xs text-[#627084] dark:text-[#91A4BA] mt-0.5">
              Privileged institutional roles require RFC 6238 time-based two-factor authentication.
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

        {step === 'fetch' && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#016A62] dark:text-[#63D6C6]" />
            <span className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9]">
              Generating cryptographic TOTP secret...
            </span>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#627084] dark:text-[#91A4BA] block">
                Step 1: Add to Authenticator App
              </span>
              <p className="text-xs text-[#203653] dark:text-[#F1F5F9]">
                Add this key to your authenticator application (Google Authenticator, Microsoft Authenticator, or Aegis):
              </p>

              <div className="p-3 bg-[#F7F6F1] dark:bg-[#0A1626] rounded-xl border border-[#E2E6E8] dark:border-[#293B52] flex items-center justify-between gap-2">
                <code className="text-xs font-mono font-bold text-[#016A62] dark:text-[#63D6C6] select-all break-all">
                  {base32Secret}
                </code>
                <button
                  type="button"
                  onClick={copySecret}
                  className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-[#17283D] border border-[#E2E6E8] dark:border-[#293B52] rounded-lg text-[#203653] dark:text-[#F1F5F9] hover:bg-slate-50 flex items-center gap-1 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {keyUri && (
                <div className="text-[11px] text-[#627084] dark:text-[#91A4BA]">
                  URI Scheme: <code className="text-[10px] select-all break-all">{keyUri}</code>
                </div>
              )}
            </div>

            <form onSubmit={handleVerifySetup} noValidate className="space-y-4 pt-2">
              <div>
                <label
                  htmlFor="enroll-code-input"
                  className="text-xs font-semibold text-[#203653] dark:text-[#F1F5F9] block mb-1.5"
                >
                  Step 2: Enter Current 6-Digit Code to Confirm
                </label>
                <div className="relative">
                  <input
                    id="enroll-code-input"
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
                    placeholder="000000"
                    disabled={isLoading}
                    className="w-full text-center text-xl font-mono tracking-widest bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl py-2.5 px-3 text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#016A62]"
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
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify &amp; Activate MFA</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {step === 'recovery' && (
          <div className="space-y-4">
            <div className="p-3 bg-[#E7F2ED] dark:bg-[#0E2F2B] border border-[#A8D5C2] dark:border-[#1E5C50] rounded-xl flex items-center gap-2 text-xs text-[#1E7B54] dark:text-[#63D6C6] font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>TOTP Authenticator Successfully Enrolled!</span>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#203653] dark:text-[#F1F5F9]">
                Single-Use Emergency Recovery Codes (Save These Now)
              </h4>
              <p className="text-xs text-[#627084] dark:text-[#91A4BA]">
                Store these 8 emergency recovery codes securely. Each code can be used exactly once if you lose access to your authenticator device.
              </p>

              <div className="grid grid-cols-2 gap-2 p-3 bg-[#F7F6F1] dark:bg-[#0A1626] rounded-xl border border-[#E2E6E8] dark:border-[#293B52] font-mono text-xs text-[#203653] dark:text-[#F1F5F9] font-bold">
                {recoveryCodes.map((code, idx) => (
                  <div key={idx} className="p-1.5 bg-white dark:bg-[#111F32] rounded border border-[#E2E6E8] dark:border-[#293B52] text-center">
                    {code}
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={copyAllRecoveryCodes}
                  className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-[#17283D] border border-[#E2E6E8] dark:border-[#293B52] rounded-lg text-[#203653] dark:text-[#F1F5F9] hover:bg-slate-50 flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedCodes ? 'All Codes Copied' : 'Copy All Codes'}</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-[#E2E6E8] dark:border-[#293B52]">
              <button
                type="button"
                onClick={() => onSuccess()}
                className="w-full py-3 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2"
              >
                <span>I Have Saved My Recovery Codes — Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
