import React, { useState, useEffect } from 'react';
import { 
  Laptop, 
  Smartphone, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  RotateCcw, 
  Trash2, 
  Fingerprint, 
  Key, 
  Sparkles,
  Info
} from 'lucide-react';
import { apiJson } from '../api/apiJson.js';
import { startRegistration } from '@simplewebauthn/browser';

interface DeviceSlot {
  slot_id: 'SLOT_01' | 'SLOT_02' | 'SLOT_03';
  device_label: string;
  platform: 'WINDOWS' | 'ANDROID';
  credential_id: string | null;
  public_key: string | null;
  counter: number;
  aaguid: string | null;
  backup_eligible: boolean | null;
  backup_state: boolean | null;
  transports: string[] | null;
  registered_at: string | null;
  last_authenticated_at: string | null;
  is_revoked: boolean;
  revoked_at: string | null;
  registered_by: string | null;
  is_active: boolean;
}

export const DeviceManagementView: React.FC = () => {
  const [slots, setSlots] = useState<DeviceSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchSlots = async () => {
    try {
      setLoading(true);
      const res = await apiJson<{ slots: DeviceSlot[] }>('/api/admin/devices/slots');
      setSlots(res.slots || []);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to load device slots' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlots();
  }, []);

  const handleEnrollDevice = async (slotId: 'SLOT_01' | 'SLOT_02' | 'SLOT_03') => {
    try {
      setActionLoading(`enroll_${slotId}`);
      setNotification(null);

      // 1. Request registration options from backend
      const optionsRes = await apiJson<{
        options: any;
        challengeToken: string;
        slot_id: string;
      }>(`/api/admin/devices/slots/${slotId}/register-options`, {
        method: 'POST',
      });

      // 2. Invoke WebAuthn ceremony via browser API
      let attResp;
      try {
        const cleanOpts = { ...optionsRes.options, rp: { ...optionsRes.options.rp, id: window.location.hostname } }; attResp = await startRegistration({ optionsJSON: cleanOpts });
      } catch (userErr: any) {
        if (userErr.name === 'NotAllowedError') {
          throw new Error('Registration was canceled or user verification timed out.');
        }
        throw new Error(`WebAuthn Error: ${userErr.message}`);
      }

      // 3. Send response to backend for cryptographic verification
      const verifyRes = await apiJson<{ success: boolean; credential_id: string }>(
        `/api/admin/devices/slots/${slotId}/register-verify`,
        {
          method: 'POST',
          body: JSON.stringify({
            challengeToken: optionsRes.challengeToken,
            response: attResp,
          }),
        }
      );

      setNotification({
        type: 'success',
        message: `Device successfully registered and bound to ${slotId} (Credential ID: ${verifyRes.credential_id.substring(0, 16)}...)`,
      });

      await fetchSlots();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to enroll device' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeDevice = async (slotId: 'SLOT_01' | 'SLOT_02' | 'SLOT_03') => {
    if (!window.confirm(`Are you sure you want to revoke ${slotId}? Any active demo sessions from this device will be immediately invalidated.`)) {
      return;
    }

    try {
      setActionLoading(`revoke_${slotId}`);
      setNotification(null);

      await apiJson(`/api/admin/devices/slots/${slotId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Revoked via Super Admin Management Interface' }),
      });

      setNotification({ type: 'success', message: `Slot ${slotId} has been revoked successfully.` });
      await fetchSlots();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to revoke device' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetSlot = async (slotId: 'SLOT_01' | 'SLOT_02' | 'SLOT_03') => {
    if (!window.confirm(`Reset ${slotId} to allow enrolling a replacement device?`)) {
      return;
    }

    try {
      setActionLoading(`reset_${slotId}`);
      setNotification(null);

      await apiJson(`/api/admin/devices/slots/${slotId}/reset`, {
        method: 'POST',
      });

      setNotification({ type: 'success', message: `Slot ${slotId} cleared. Ready for replacement enrollment.` });
      await fetchSlots();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to reset slot' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Overview */}
      <div className="bg-white rounded-xl border border-[#E2E6E8] p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#1E7B54]" />
              <h1 className="text-lg font-bold text-[#203653]">Hardware-Bound Three-Device Demo Authentication</h1>
            </div>
            <p className="text-xs text-[#627084] mt-1">
              Enforce strict, hardware-bound WebAuthn Level 3 platform authenticators for exactly two dedicated presentation devices.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-[#E7F2ED] text-[#1E7B54] text-xs font-semibold rounded-lg border border-[#A8D5C2]">
              Strict Limit: 3 Active Devices (2 Windows, 1 Android)
            </span>
          </div>
        </div>

        {/* Security Invariant Callout */}
        <div className="mt-4 p-3.5 bg-[#F0F5F8] border border-[#D0DFE8] rounded-lg text-xs text-[#203653] flex items-start gap-2.5">
          <Info className="w-4 h-4 text-[#2C8279] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-[#1B365D]">Zero-Trust Security & Backup Invariant Enforcement:</p>
            <p className="text-[#4E6178]">
              Multi-device synced passkeys (Google Password Manager sync / iCloud Keychain) are rejected. Credentials must report single-device TPM or Secure Enclave attachment (<code className="bg-white px-1 py-0.5 rounded border border-[#CBD5E1]">backup_eligible = FALSE</code>).
            </p>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs ${
            notification.type === 'success'
              ? 'bg-[#E7F2ED] border-[#A8D5C2] text-[#1E7B54]'
              : 'bg-[#FDF2F2] border-[#F8B4B4] text-[#9B1C1C]'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span className="font-medium">{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-xs underline font-semibold ml-4 hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Two Slot Cards Grid */}
      {loading ? (
        <div className="py-12 flex justify-center items-center">
          <div className="w-8 h-8 border-3 border-[#2C8279] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {slots.map((slot) => {
            const isWindows = slot.platform === 'WINDOWS';
            const Icon = isWindows ? Laptop : Smartphone;
            const isActionBusy = actionLoading?.includes(slot.slot_id);

            return (
              <div
                key={slot.slot_id}
                className={`bg-white rounded-xl border p-5 sm:p-6 shadow-xs flex flex-col justify-between transition-all ${
                  slot.is_active
                    ? 'border-[#A8D5C2] bg-gradient-to-b from-white to-[#F9FCFA]'
                    : slot.is_revoked
                    ? 'border-[#F8B4B4] bg-gradient-to-b from-white to-[#FDFBFB]'
                    : 'border-[#E2E6E8]'
                }`}
              >
                {/* Slot Top Details */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          slot.is_active
                            ? 'bg-[#E7F2ED] text-[#1E7B54]'
                            : slot.is_revoked
                            ? 'bg-[#FDF2F2] text-[#9B1C1C]'
                            : 'bg-[#F0F5F8] text-[#2C8279]'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#627084]">{slot.slot_id}</span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                              slot.is_active
                                ? 'bg-[#1E7B54] text-white'
                                : slot.is_revoked
                                ? 'bg-[#9B1C1C] text-white'
                                : 'bg-[#E2E6E8] text-[#627084]'
                            }`}
                          >
                            {slot.is_active ? 'Active & Bound' : slot.is_revoked ? 'Revoked' : 'Unregistered'}
                          </span>
                        </div>
                        <h2 className="text-sm font-bold text-[#203653] mt-0.5">{slot.device_label}</h2>
                      </div>
                    </div>
                  </div>

                  {/* Metadata Specs */}
                  <div className="mt-5 space-y-2.5 text-xs border-t border-b border-[#E2E6E8] py-3.5">
                    <div className="flex items-center justify-between text-[#627084]">
                      <span>Platform Target</span>
                      <span className="font-semibold text-[#203653]">
                        {isWindows ? 'Windows Hello (TPM / PIN)' : 'Android Keystore / Chrome'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[#627084]">
                      <span>Backup Invariant</span>
                      <span className="font-semibold text-[#1E7B54] flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> Single-Device Only
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[#627084]">
                      <span>Credential ID</span>
                      <span className="font-mono text-[11px] text-[#203653]">
                        {slot.credential_id ? `${slot.credential_id.substring(0, 18)}...` : 'None (Not Enrolled)'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[#627084]">
                      <span>Auth Counter</span>
                      <span className="font-semibold text-[#203653]">{slot.counter}</span>
                    </div>

                    <div className="flex items-center justify-between text-[#627084]">
                      <span>Enrolled At</span>
                      <span className="text-[#203653]">
                        {slot.registered_at ? new Date(slot.registered_at).toLocaleString() : '—'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[#627084]">
                      <span>Last Authenticated</span>
                      <span className="text-[#203653]">
                        {slot.last_authenticated_at ? new Date(slot.last_authenticated_at).toLocaleString() : 'Never'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-5 pt-1">
                  {!slot.credential_id ? (
                    <button
                      onClick={() => handleEnrollDevice(slot.slot_id)}
                      disabled={isActionBusy}
                      className="w-full py-2.5 px-4 bg-[#1E7B54] hover:bg-[#165c3f] text-white text-xs font-semibold rounded-lg shadow-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <Fingerprint className="w-4 h-4" />
                      {isActionBusy ? 'Enrolling WebAuthn...' : `Enroll Current Device to ${slot.slot_id}`}
                    </button>
                  ) : slot.is_active ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRevokeDevice(slot.slot_id)}
                        disabled={isActionBusy}
                        className="flex-1 py-2 px-3 bg-[#FDF2F2] hover:bg-[#FDE8E8] text-[#9B1C1C] border border-[#F8B4B4] text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {isActionBusy ? 'Revoking...' : 'Revoke Credential'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResetSlot(slot.slot_id)}
                        disabled={isActionBusy}
                        className="w-full py-2 px-3 bg-[#203653] hover:bg-[#162539] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {isActionBusy ? 'Resetting...' : 'Reset for Replacement Enrollment'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
