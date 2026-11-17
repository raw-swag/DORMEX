import React from 'react';
import { Users, Clock, AlertTriangle, Radio, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { StudentTelemetryState } from '../../hooks/useWaitingRoomTelemetry.js';

export interface WaitingRoomLiveCardProps {
  telemetry: StudentTelemetryState | null;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'polling_fallback' | 'error' | 'disconnected';
  onReconnect?: () => void;
  onLeaveWaitingRoom?: () => void;
  leavingLoading?: boolean;
}

export const WaitingRoomLiveCard: React.FC<WaitingRoomLiveCardProps> = ({
  telemetry,
  connectionStatus,
  onReconnect,
  onLeaveWaitingRoom,
  leavingLoading,
}) => {
  if (!telemetry) {
    return (
      <div className="p-4 bg-white dark:bg-[#111F32] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl shadow-xs animate-pulse flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-1.5">
            <div className="h-3.5 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
            <div className="h-2.5 w-48 bg-slate-100 dark:bg-slate-800 rounded" />
          </div>
        </div>
        <div className="h-7 w-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
      </div>
    );
  }

  const { studentQueue, totalWaiting, totalAdmitted, maxAdmittedCapacity, isPriorityWindowClosed } = telemetry;
  const isWaiting = studentQueue?.status === 'WAITING';
  const isAdmitted = studentQueue?.status === 'ADMITTED';
  const isTop5 = studentQueue?.isTop5;

  const formatSeconds = (sec: number) => {
    if (sec <= 0) return 'Immediate / Next Turn';
    const mins = Math.floor(sec / 60);
    const remaining = sec % 60;
    if (mins === 0) return `${remaining}s`;
    return `${mins}m ${remaining > 0 ? `${remaining}s` : ''}`;
  };

  return (
    <div className="bg-white dark:bg-[#111F32] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl p-4 sm:p-5 shadow-xs space-y-4 transition-colors">
      {/* Top Header: Connection & Aggregate Participant Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E6E8] dark:border-[#293B52] pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            {connectionStatus === 'connected' ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping absolute opacity-75" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 relative" />
              </>
            ) : connectionStatus === 'polling_fallback' ? (
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            ) : connectionStatus === 'reconnecting' ? (
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-[#07203C] dark:text-[#F8FAFC] tracking-tight flex items-center gap-1.5">
              <span>Waiting Room Live Telemetry</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                connectionStatus === 'connected' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' :
                connectionStatus === 'polling_fallback' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800' :
                'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}>
                {connectionStatus === 'connected' ? 'SSE Live' :
                 connectionStatus === 'polling_fallback' ? 'Live Polling' :
                 connectionStatus === 'reconnecting' ? 'Reconnecting' : 'Offline'}
              </span>
            </h4>
            <p className="text-[11px] text-[#627084] dark:text-[#94A3B8]">
              Server-authoritative queue telemetry refreshed dynamically.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {connectionStatus !== 'connected' && onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className="py-1 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#1A2C42] dark:hover:bg-[#243A56] text-[#203653] dark:text-[#E2E8F0] font-semibold rounded-lg border border-[#D2D7D9] dark:border-[#293B52] flex items-center gap-1 text-[11px] transition-colors"
            >
              <RefreshCw className="w-3 h-3 text-[#2C8279]" />
              <span>Reconnect</span>
            </button>
          )}

          <div className="bg-[#F0F4F6] dark:bg-[#0E243A] px-3 py-1.5 rounded-lg border border-[#D2D7D9] dark:border-[#293B52] flex items-center gap-3 text-[11px] font-semibold text-[#203653] dark:text-[#E2E8F0]">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[#2C8279]" />
              <span>Admitted: <strong>{totalAdmitted} / {maxAdmittedCapacity}</strong></span>
            </div>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <div>
              <span>Queued: <strong>{totalWaiting}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Proactive Alert: Top 5 in Queue */}
      {isWaiting && isTop5 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/60 rounded-xl flex items-start sm:items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <span>Priority Turn Alert: You are in the Top 5!</span>
                <span className="bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 text-[10px] px-1.5 py-0.2 rounded font-mono">
                  #{studentQueue.queuePosition}
                </span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Please remain on this screen. Your turn will activate automatically as soon as an admitted slot clears.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Admitted Status Alert */}
      {isAdmitted && (
        <div className="p-3 bg-teal-50 dark:bg-teal-950/40 border border-teal-300 dark:border-teal-800/60 rounded-xl flex items-start sm:items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-[#016A62] dark:text-[#84D5CA]" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#016A62] dark:text-[#84D5CA]">
                Admitted to Selection Pool (Capacity Reserved)
              </div>
              <p className="text-[11px] text-teal-800 dark:text-teal-300">
                You hold an admitted slot among the 20 active candidates. Bed confirmation turn will open immediately when current turn expires or confirms.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Personal Status Grid */}
      {studentQueue ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-[#F7F6F1] dark:bg-[#16273C] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#627084] dark:text-[#94A3B8]">
              Your Queue Status
            </span>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#07203C] dark:text-[#F8FAFC]">
              <span className={`w-2 h-2 rounded-full ${
                isAdmitted ? 'bg-teal-500' :
                isWaiting ? 'bg-blue-500' : 'bg-slate-400'
              }`} />
              <span>{studentQueue.status}</span>
              {isWaiting && (
                <span className="font-mono text-[#1D63B8] dark:text-[#60A5FA]">
                  (Position #{studentQueue.queuePosition})
                </span>
              )}
            </div>
          </div>

          <div className="p-3 bg-[#F7F6F1] dark:bg-[#16273C] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#627084] dark:text-[#94A3B8]">
              Estimated Wait
            </span>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#07203C] dark:text-[#F8FAFC]">
              <Clock className="w-3.5 h-3.5 text-[#2C8279]" />
              <span className="font-mono text-[#2C8279] dark:text-[#84D5CA]">
                {formatSeconds(studentQueue.estimatedWaitSeconds)}
              </span>
            </div>
          </div>

          <div className="p-3 bg-[#F7F6F1] dark:bg-[#16273C] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#627084] dark:text-[#94A3B8]">
              Priority Policy
            </span>
            <div className="text-xs font-semibold text-[#07203C] dark:text-[#F8FAFC] flex items-center justify-between">
              <span>{isPriorityWindowClosed ? 'Standard Open (All Slots)' : 'Protected Reserved Quota'}</span>
              <span className="text-[10px] font-mono text-[#627084] dark:text-[#94A3B8]">
                #{studentQueue.priorityNumber}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3 bg-[#F0F4F6] dark:bg-[#16273C] border border-[#D2D7D9] dark:border-[#293B52] rounded-xl text-center text-xs text-[#627084] dark:text-[#94A3B8]">
          You have not entered the waiting queue for this cycle. Click &quot;Enter Allocation Queue&quot; to join.
        </div>
      )}

      {/* Leave Queue Option for Active Waiting Candidates */}
      {studentQueue && ['WAITING', 'ADMITTED'].includes(studentQueue.status) && onLeaveWaitingRoom && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onLeaveWaitingRoom}
            disabled={leavingLoading}
            className="text-[11px] text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 font-medium underline transition-colors disabled:opacity-50"
          >
            {leavingLoading ? 'Leaving queue...' : 'Leave waiting room'}
          </button>
        </div>
      )}
    </div>
  );
};
