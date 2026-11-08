import React from 'react';
import { Clock, Check, Loader2 } from 'lucide-react';

export interface TurnStatusRibbonProps {
  availableCycles: any[];
  cycleId: string | null;
  activeSession: any;
  timeLeft: number | null;
  myProfile: any;
  session: any;
  waitingEntry: any;
  myAllocation: any;
  loading: boolean;
  onJoinWaitingRoom: () => void;
}

export const TurnStatusRibbon: React.FC<TurnStatusRibbonProps> = ({
  availableCycles,
  cycleId,
  activeSession,
  timeLeft,
  myProfile,
  session,
  waitingEntry,
  myAllocation,
  loading,
  onJoinWaitingRoom,
}) => {
  const activeCycle = availableCycles.find((c: any) => c.id === cycleId);
  const cycleStatus = activeCycle?.status || 'READY';
  const isPaused = cycleStatus === 'PAUSED';
  const isNotStarted = !['ACTIVE', 'PAUSED'].includes(cycleStatus);
  const isPublished = activeCycle?.status === 'PUBLISHED' || activeCycle?.status === 'LOCKED';

  return (
    <div className="space-y-4">
      {/* Top Priority Status Ribbon */}
      <div className="px-5 py-3 bg-[#07203C] text-white rounded-xl shadow-xs border border-[#17283B] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-bold shrink-0 ${
              cycleStatus === 'ACTIVE'
                ? 'bg-[#2C8279]'
                : isPaused
                ? 'bg-[#D49E34]'
                : 'bg-[#627084]'
            }`}
          >
            {cycleStatus === 'ACTIVE' ? '✓' : isPaused ? '❚❚' : '⏳'}
          </span>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[10px] uppercase font-bold tracking-wider ${
                  cycleStatus === 'ACTIVE'
                    ? 'text-[#84d5ca]'
                    : isPaused
                    ? 'text-[#F3E7C4]'
                    : 'text-slate-300'
                }`}
              >
                {cycleStatus === 'ACTIVE'
                  ? 'Live Allocation Active'
                  : isPaused
                  ? 'Allocation Temporarily Paused by Admin'
                  : `Allocation Not Started (${cycleStatus})`}
              </span>
              <span className="text-slate-400 text-xs">/</span>
              <span className="text-xs font-bold text-white">
                Turn #{myProfile?.assigned_priority || '1'} Priority Slot
              </span>
            </div>
            <div className="text-[11px] text-slate-300 truncate">
              Eligible Candidate: <span className="font-bold text-white">{session?.fullName}</span> (USN:{' '}
              <span className="font-mono">{session?.collegeId}</span> · Priority #{myProfile?.assigned_priority || '1'})
              {isPaused && ' · Engine paused; turn countdown frozen'}
              {isNotStarted && ' · Engine dormant; awaiting Administrator Start'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#112947] px-3 py-1.5 rounded-lg border border-[#203653]">
            <Clock
              className={`w-3.5 h-3.5 ${
                cycleStatus === 'ACTIVE' ? 'text-[#84d5ca] animate-pulse' : 'text-slate-400'
              }`}
            />
            <span className="text-xs font-semibold text-white">
              Selection Window:{' '}
              <strong className="font-mono text-[#D4B779]">
                {isPaused
                  ? timeLeft !== null
                    ? `${Math.floor(timeLeft / 60)}m ${String(timeLeft % 60).padStart(2, '0')}s (Frozen)`
                    : 'Paused'
                  : isNotStarted
                  ? 'Not Started'
                  : timeLeft !== null
                  ? `${Math.floor(timeLeft / 60)}m ${String(timeLeft % 60).padStart(2, '0')}s`
                  : 'Active'}
              </strong>
            </span>
          </div>
          <span className="hidden sm:inline-block px-2.5 py-1 rounded bg-[#203653]/60 text-[10px] font-mono text-slate-300 border border-[#263345]">
            Node: SIT-BVB-F2-P30
          </span>
        </div>
      </div>

      {/* Focused Allocation Status Card with High Contrast */}
      <div className="bg-[#203653] text-white rounded-xl p-4 sm:p-6 shadow-sm border border-[#17283B] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sm:gap-6">
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#84d5ca] animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#84d5ca]">
              Allocation Cycle Active · BVB Block Floor 2
            </span>
          </div>
          <div className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2.5 sm:gap-3 flex-wrap">
            <span>{session?.fullName}</span>
            <span className="text-xs font-mono font-medium bg-[#112947] text-slate-200 px-2.5 py-1 rounded border border-[#263345]">
              {session?.collegeId}
            </span>
          </div>
          <div className="text-xs text-slate-300 flex items-center gap-2 flex-wrap">
            <span>Assigned Priority Rank:</span>
            <span className="font-bold text-[#D4B779] font-mono text-sm">
              #{myProfile?.assigned_priority || '1'}
            </span>
            <span className="text-slate-400">/ 30 Pilot Cohort</span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                isPublished
                  ? 'bg-[#E7F2ED] text-[#1E7B54] border-[#A8D5C2]'
                  : 'bg-[#FAF4E6] text-[#9C7A2E] border-[#D4B779]'
              }`}
            >
              {isPublished ? 'Official Results Certified' : 'Provisional Allocation'}
            </span>
          </div>
        </div>

        {/* Turn Action / Timer Box */}
        <div className="bg-[#07203C] p-3.5 sm:p-4 rounded-xl border border-[#263345] w-full md:w-auto md:min-w-[260px] flex flex-col items-start gap-2.5 sm:gap-3">
          <div className="text-[11px] font-medium text-slate-300 flex items-center justify-between w-full">
            <span>Turn Status:</span>
            {(() => {
              if (activeSession) {
                return (
                  <span className="text-[#84d5ca] font-bold uppercase text-[10px] tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#84d5ca] animate-ping" /> Active Window
                  </span>
                );
              }
              if (cycleStatus === 'PAUSED') {
                return <span className="text-[#D4B779] font-semibold text-[10px] uppercase">Engine Paused</span>;
              }
              if (cycleStatus !== 'ACTIVE') {
                return <span className="text-slate-400 font-semibold text-[10px] uppercase">Not Started</span>;
              }
              if (waitingEntry) {
                return <span className="text-[#D4B779] font-semibold text-[10px] uppercase">In Queue</span>;
              }
              if (myAllocation) {
                return <span className="text-[#84d5ca] font-semibold text-[10px] uppercase">Allocated</span>;
              }
              return <span className="text-slate-400 text-[10px] uppercase">Ready</span>;
            })()}
          </div>

          {activeSession && !myAllocation && (
            <div className="w-full">
              <div className="text-2xl font-bold font-mono text-white tracking-wide">
                {timeLeft !== null
                  ? `${Math.floor(timeLeft / 60)}m : ${String(timeLeft % 60).padStart(2, '0')}s`
                  : '02m : 00s'}
              </div>
              <div className="text-[11px] text-[#84d5ca] font-medium mt-0.5">
                Your allocation pick window is open
              </div>
            </div>
          )}

          {waitingEntry && !activeSession && !myAllocation && (
            <div className="text-xs text-slate-200">
              <span className="font-bold text-white">Turn scheduled.</span> Waiting for active student turn completion.
            </div>
          )}

          {myAllocation && (
            <div className="text-xs text-slate-200 flex items-center gap-1.5 font-medium">
              <Check className="w-4 h-4 text-[#84d5ca]" />
              <span>
                Confirmed Seat: <strong className="text-white font-mono">{myAllocation.seatId}</strong>
              </span>
            </div>
          )}

          {!waitingEntry && !myAllocation && (
            <button
              onClick={onJoinWaitingRoom}
              disabled={loading || (myProfile && myProfile.eligibility_status !== 'ELIGIBLE')}
              className="w-full py-2.5 px-4 bg-[#2C8279] hover:bg-[#236B63] text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Enter Allocation Queue</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
