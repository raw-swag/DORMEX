import React, { useState } from 'react';
import { DormexLogo } from './DormexLogo.js';
import { Lock, Eye, EyeOff, ShieldCheck, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

interface PresentationGateViewProps {
  onAccessGranted: () => void;
}

export const PresentationGateView: React.FC<PresentationGateViewProps> = ({ onAccessGranted }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMessage('Please enter the presentation access password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/presentation/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        onAccessGranted();
      } else {
        if (res.status === 429) {
          setErrorMessage(data.error || 'Too many attempts. Please try again shortly.');
        } else if (res.status === 401) {
          setErrorMessage('Incorrect presentation password. Please check and try again.');
        } else {
          setErrorMessage(data.error || 'Access verification failed. Please try again.');
        }
      }
    } catch {
      setErrorMessage('Network connection error. Unable to verify presentation access.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F1] flex flex-col justify-between font-sans">
      {/* Top Banner Header */}
      <header className="bg-white border-b border-[#E2E6E8] px-4 py-3 sm:px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DormexLogo theme="primary" size="sm" />
            <div className="hidden sm:block h-5 w-[1px] bg-[#E2E6E8]" />
            <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wider text-[#627084]">
              Staging Presentation Environment
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#FAF4E6] text-[#B69A5F] border border-[#D4B779] rounded-full text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Principal Review Gate</span>
          </div>
        </div>
      </header>

      {/* Main Content Card */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#E2E6E8] overflow-hidden">
          {/* Header Accent */}
          <div className="bg-[#203653] p-6 text-white text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/10 text-[#84D5CA] mb-3">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Presentation Access Required</h1>
            <p className="text-xs text-white/80 mt-1">
              Enter the authorized staging access password to proceed to the DORMEX platform review.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs animate-shake"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span className="font-medium leading-relaxed">{errorMessage}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="presentation-password"
                className="block text-xs font-semibold text-[#203653] mb-1.5"
              >
                Presentation Password
              </label>
              <div className="relative">
                <input
                  id="presentation-password"
                  name="presentation-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  autoFocus
                  placeholder="Enter access password"
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 pr-10 rounded-lg border border-[#E2E6E8] text-sm text-[#203653] focus:outline-none focus:ring-2 focus:ring-[#2C8279] focus:border-transparent transition-all disabled:bg-gray-50 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#627084] hover:text-[#203653] focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#2C8279] hover:bg-[#20635C] active:scale-[0.99] text-white font-semibold text-sm rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying credentials...</span>
                </>
              ) : (
                <>
                  <span>Continue to DORMEX</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="pt-2 text-center">
              <span className="text-[11px] text-[#627084]">
                This is an isolated testing environment for executive demonstration. Institutional authentication will follow.
              </span>
            </div>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-[#627084]">
        <span>&copy; {new Date().getFullYear()} DORMEX • College Hostel Allocation System</span>
      </footer>
    </div>
  );
};
