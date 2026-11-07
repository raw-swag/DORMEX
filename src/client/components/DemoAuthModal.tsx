import React, { useState, useEffect } from 'react';
import { 
  Fingerprint, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  Lock, 
  Laptop, 
  Smartphone,
  Sparkles,
  Info
} from 'lucide-react';
import { apiJson } from '../api/apiJson.js';
import { startAuthentication } from '@simplewebauthn/browser';

interface DemoAccessState {
  authorized: boolean;
  slot_id?: string;
  device_label?: string;
  platform?: string;
  expires_at?: string;
}

interface DemoAuthModalProps {
  onSuccess: (info: any) => void;
  onCancel: () => void;
}

export const DemoAuthModal: React.FC<DemoAuthModalProps> = ({ onSuccess, onCancel }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAuthenticate = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      // 1. Fetch authentication options from backend
      const optionsRes = await apiJson<{
        options: any;
        challengeToken: string;
      }>('/api/demo/auth/options', { method: 'POST' });

      // 2. Invoke browser WebAuthn platform authenticator
      let asseResp;
      try {
        const cleanOpts = { ...optionsRes.options, rpId: window.location.hostname }; asseResp = await startAuthentication({ optionsJSON: cleanOpts });
      } catch (err: any) {
        if (err.name === 'NotAllowedError') {
          throw new Error('Verification was canceled or timed out.');
        }
        throw new Error(err.message || 'WebAuthn prompt failed');
      }

      // 3. Verify assertion with backend
      const verifyRes = await apiJson<{
        success: boolean;
        slot_id: string;
        device_label: string;
        expires_at: string;
      }>('/api/demo/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeToken: optionsRes.challengeToken,
          response: asseResp,
        }),
      });

      onSuccess(verifyRes);
    } catch (err: any) {
      setErrorMsg(err.message || 'WebAuthn assertion failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E6E8] space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#E7F2ED] text-[#1E7B54] flex items-center justify-center mx-auto">
            <Fingerprint className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-[#203653]">Authenticate Registered Demo Device</h2>
          <p className="text-xs text-[#627084]">
            Touch your biometric sensor or enter your device PIN (Windows Hello / Android Screen Lock) to unlock the live interactive demo session.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-[#FDF2F2] border border-[#F8B4B4] rounded-xl text-xs text-[#9B1C1C] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="p-3 bg-[#F0F5F8] rounded-xl text-xs text-[#203653] space-y-1.5 border border-[#D0DFE8]">
          <div className="flex items-center gap-1.5 font-semibold text-[#1B365D]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1E7B54]" />
            Authorized Device Slots:
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-[#4E6178]">
            <li><strong>SLOT_01:</strong> Windows Laptop (Chrome / Edge with Windows Hello)</li>
            <li><strong>SLOT_02:</strong> Android Phone (Chrome / Edge with Biometric/PIN)</li>
            <li><strong>SLOT_03:</strong> Windows Laptop 2 (Chrome / Edge with Windows Hello)</li>
          </ul>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 border border-[#E2E6E8] text-[#627084] hover:bg-[#F7F6F1] text-xs font-semibold rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAuthenticate}
            disabled={loading}
            className="flex-1 py-2.5 px-4 bg-[#1E7B54] hover:bg-[#165c3f] text-white text-xs font-semibold rounded-xl shadow-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Fingerprint className="w-4 h-4" />
            {loading ? 'Verifying...' : 'Authenticate'}
          </button>
        </div>
      </div>
    </div>
  );
};
