import React from 'react';
import { Clock, Check, Loader2, AlertCircle, HelpCircle, Sparkles, CheckCircle2 } from 'lucide-react';

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
  onOpenGuide?: () => void;
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
  onOpenGuide,
}) => {
  const activeCycle = availableCycles.find((c: any) => c.id === cycleId);
  const cycleStatus = activeCycle?.status || 'READY';
  const isPaused = cycleStatus === 'PAUSED';
  const isNotStarted = !['ACTIVE', 'PAUSED'].includes(cycleStatus);
  const isPublished = activeCycle?.status === 'PUBLISHED' || activeCycle?.status === 'LOCKED';

  // Determine comprehensive authoritative status state
  let stateTitle = '';
  let stateDescription = '';
  let stateBadge = '';
  let stateColor = '';

  if (myAllocation) {
    stateTitle = 'Room Confirmed';
    stateDescription = `You have officially secured seat ${myAllocation.seatId}. Your provisional allocation pass is active.`;
    stateBadge = 'CONFIRMED';
    stateColor = 'bg-[#1E7B54] text-white';
  } else if (isPublished) {
    stateTitle = 'Allocation Cycle Completed';
    stateDescription = 'The institutional allocation cycle has concluded and results are officially published.';
    stateBadge = 'COMPLETED';
    stateColor = 'bg-[#203653] text-white';
  } else if (isPaused) {
    stateTitle = 'Allocation Temporarily Paused';
    stateDescription = 'Hostel Administration has paused the turn countdown. All room selections are currently frozen.';
    stateBadge = 'PAUSED';
    stateColor = 'bg-[#D49E34] text-white';
  } else if (isNotStarted) {
    stateTitle = 'Allocation Cycle Not Started';
    stateDescription = 'The room allocation window has not yet been opened by the Hostel Office. You can review room maps and submit roommate intent.';
    stateBadge = 'DORMANT';
    stateColor = 'bg-[#627084] text-white';
  } else if (activeSession) {
    stateTitle = "Your Selection Turn is ACTIVE!";
    stateDescription = 'Your exclusive priority window is now open. Choose your preferred open bed on the floor map and confirm your seat.';
    stateBadge = 'MY TURN ACTIVE';
    stateColor = 'bg-[#2C8279] text-white animate-pulse';
  } else if (waitingEntry) {
    stateTitle = "Your Turn is Approaching";
    stateDescription = 'You are in the queue. When lower-rank students finish or time out, your turn will start automatically.';
    stateBadge = 'IN QUEUE';
    stateColor = 'bg-[#1D63B8] text-white';
  } else {
    stateTitle = 'No Room Assigned Yet';
    stateDescription = 'Allocation cycle is currently active. Join the priority waiting queue below to hold your place.';
    stateBadge = 'READY TO QUEUE';
    stateColor = 'bg-[#2C8279] text-white';
  }

  return (
    <div className="space-y-3">
      {/* Top Priority Status Ribbon */}
      <div className="px-4 sm:px-5 py-3 bg-[#07203C] text-white rounded-xl shadow-xs border border-[#17283B] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0 ${stateColor}`}
          >
            {myAllocation ? '✓' : activeSession ? '★' : isPaused ? '❚❚' : waitingEntry ? '⏳' : '•'}
          </span>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#84d5ca]">
                {stateTitle}
              </span>
              <span className="text-slate-400 text-xs">/</span>
              <span className="text-xs font-bold text-white">
                Turn #{myProfile?.assigned_priority || '1'} Priority Slot
              </span>
            </div>
            <div className="text-[11px] text-slate-300 truncate">
              Candidate: <span className="font-bold text-white">{session?.fullName}</span> (USN:{' '}
              <span className="font-mono">{session?.collegeId}</span> · Priority #{myProfile?.assigned_priority || '1'})
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="py-1 px-2.5 bg-[#112947] hover:bg-[#1a385f] text-slate-200 text-xs font-semibold rounded-lg border border-[#203653] flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-1 focus:ring-[#84D5CA]"
              title="Open Allocation Guide"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[#84D5CA]" aria-hidden="true" />
              <span className="hidden sm:inline">How Allocation Works</span>
              <span className="sm:hidden">Guide</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2 bg-[#112947] px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#203653]">
            <Clock
              className={`w-3.5 h-3.5 ${
                cycleStatus === 'ACTIVE' ? 'text-[#84d5ca] animate-pulse' : 'text-slate-400'
              }`}
            />
            <span className="text-xs font-semibold text-white">
              Window:{' '}
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
        </div>
      </div>

      {/* Explanatory Context Banner based on Real Lifecycle State */}
      <div className="p-3.5 bg-white dark:bg-[#111F32] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl text-xs text-[#203653] dark:text-[#E2E8F0] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs transition-colors">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              myAllocation ? 'bg-[#E7F2ED] dark:bg-[#0D2821] text-[#1E7B54] dark:text-[#84D5CA]' :
              activeSession ? 'bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#016A62] dark:text-[#84D5CA]' :
              isPaused ? 'bg-[#FAF4E6] dark:bg-[#2C210B] text-[#9C7A2E] dark:text-[#FBBF24]' :
              isNotStarted ? 'bg-[#F0F4F6] dark:bg-[#0E243A] text-[#627084] dark:text-[#94A3B8]' :
              waitingEntry ? 'bg-[#EBF3FC] dark:bg-[#0F2644] text-[#1D63B8] dark:text-[#60A5FA]' :
              'bg-[#F0F4F6] dark:bg-[#0E243A] text-[#203653] dark:text-[#E2E8F0]'
            }`}>
              {stateBadge}
            </span>
            <span className="font-bold text-[#07203C] dark:text-[#F8FAFC]">{stateTitle}</span>
          </div>
          <p className="text-[11px] text-[#627084] dark:text-[#94A3B8] leading-relaxed">
            {stateDescription}
          </p>
        </div>

        {/* Action Button & Lifecycle State */}
        {waitingEntry ? (
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#EBF3FC] dark:bg-[#0F2644] text-[#1D63B8] dark:text-[#60A5FA] border border-[#B9D5F7] dark:border-[#1E3A5F] rounded-lg text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-[#1D63B8] dark:bg-[#60A5FA] animate-pulse" />
            <span>Position #{waitingEntry.queuePosition || waitingEntry.priorityNumber || '—'} in Queue</span>
          </div>
        ) : myAllocation ? (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-[#E7F2ED] dark:bg-[#0D2821] text-[#1E7B54] dark:text-[#84D5CA] border border-[#A8D5C2] dark:border-[#1A5C47] rounded-lg text-xs font-bold">
            <Check className="w-4 h-4 text-[#1E7B54] dark:text-[#84D5CA]" />
            <span>Seat Confirmed</span>
          </div>
        ) : isPublished ? (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-[#F0F4F6] dark:bg-[#0E243A] text-[#203653] dark:text-[#E2E8F0] border border-[#D2D7D9] dark:border-[#293B52] rounded-lg text-xs font-semibold">
            <span>Cycle Concluded</span>
          </div>
        ) : isPaused ? (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-[#FAF4E6] dark:bg-[#2C210B] text-[#9C7A2E] dark:text-[#FBBF24] border border-[#D4B779] dark:border-[#7A5B14] rounded-lg text-xs font-semibold">
            <span>Temporarily Paused</span>
          </div>
        ) : isNotStarted ? (
          <div className="shrink-0 flex flex-col items-end gap-1">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="py-2 px-3.5 bg-slate-200 dark:bg-[#0E243A] text-slate-500 dark:text-[#94A3B8] border border-transparent dark:border-[#293B52] cursor-not-allowed text-xs font-bold rounded-lg shadow-xs flex items-center justify-center gap-2"
            >
              <span>Waiting for Allocation to Open</span>
            </button>
            <span className="text-[10px] text-slate-500 dark:text-[#94A3B8]">
              The Hostel Office has not started the allocation cycle yet.
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onJoinWaitingRoom}
            disabled={loading || (myProfile && myProfile.eligibility_status !== 'ELIGIBLE')}
            aria-busy={loading}
            className="shrink-0 py-2 px-3.5 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#84D5CA]"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Entering Queue...</span>
              </>
            ) : (
              <span>Enter Allocation Queue</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
