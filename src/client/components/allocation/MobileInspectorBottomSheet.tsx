import React from 'react';
import { 
  Building, 
  MapPin, 
  Clock, 
  Users, 
  CheckSquare, 
  ChevronUp, 
  Repeat, 
  Sparkles,
  Bed,
  CheckCircle2,
  Lock,
  Loader2,
  Send
} from 'lucide-react';

export interface MobileInspectorProps {
  isMobileInspectorOpen: boolean;
  setIsMobileInspectorOpen: (open: boolean) => void;
  isMobileInspectorExpanded: boolean;
  setIsMobileInspectorExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  inspectorHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  selectedRoomNumber: string | null;
  selectedWingFilter: string;
  selectedRoomStitchData: any;
  selectedSeatId: string | null;
  setSelectedSeatId: (id: string | null) => void;
  seatStates: Record<string, string>;
  isMyAllocationSeat: (seatId: string) => boolean;
  isRoommateCoordinatedSeat: (seatId: string) => boolean;
  getSeatStatus: (seatId: string) => string;
  roommateIntentMap: Record<string, any>;
  isConfirmReviewStep: boolean;
  setIsConfirmReviewStep: (step: boolean) => void;
  isConfirmSubmitting: boolean;
  isConfirmedForCurrentStudent: boolean;
  waitingEntry: any;
  activeSession: any;
  handleConfirmSeatSelection: () => void;
  initiateSeatSelection: (seatId: string) => void;
  roommatePriority1: string;
  setRoommatePriority1: (val: string) => void;
  roommatePriority2: string;
  setRoommatePriority2: (val: string) => void;
  handleInviteRoommate: (e: React.FormEvent) => void;
  roommateMsg: { type: 'success' | 'error'; text: string } | null;
  myRoommateGroups: any;
  handleRespondRoommateGroup: (groupId: string, accept: boolean) => void;
}

export const MobileInspectorBottomSheet: React.FC<MobileInspectorProps> = ({
  isMobileInspectorOpen,
  setIsMobileInspectorOpen,
  isMobileInspectorExpanded,
  setIsMobileInspectorExpanded,
  inspectorHeadingRef,
  selectedRoomNumber,
  selectedWingFilter,
  selectedRoomStitchData,
  selectedSeatId,
  setSelectedSeatId,
  seatStates,
  isMyAllocationSeat,
  isRoommateCoordinatedSeat,
  getSeatStatus,
  roommateIntentMap,
  isConfirmReviewStep,
  setIsConfirmReviewStep,
  isConfirmSubmitting,
  isConfirmedForCurrentStudent,
  waitingEntry,
  activeSession,
  handleConfirmSeatSelection,
  initiateSeatSelection,
  roommatePriority1,
  setRoommatePriority1,
  roommatePriority2,
  setRoommatePriority2,
  handleInviteRoommate,
  roommateMsg,
  myRoommateGroups,
  handleRespondRoommateGroup,
}) => {
  if (!isMobileInspectorOpen) return null;

  return (
    <div 
      className={`fixed inset-x-0 bottom-0 z-40 bg-white border-t border-slate-200 shadow-2xl rounded-t-3xl transition-all duration-300 flex flex-col ${
        isMobileInspectorExpanded ? 'h-[85vh]' : 'max-h-[60vh]'
      }`}
      role="region"
      aria-label="Room Inspector Bottom Sheet"
    >
      {/* Drag handle / expand toggle */}
      <div 
        onClick={() => setIsMobileInspectorExpanded(prev => !prev)}
        className="w-full pt-3 pb-2 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 rounded-t-3xl border-b border-slate-100"
      >
        <div className="w-12 h-1.5 bg-slate-300 rounded-full mb-1" />
        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          <span>{isMobileInspectorExpanded ? 'Collapse Inspector' : 'Swipe / Tap to Expand'}</span>
          <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-300 ${isMobileInspectorExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Sheet Content Area */}
      <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 ref={inspectorHeadingRef} className="text-base sm:text-lg font-black text-navy-900 tracking-tight flex items-center gap-2">
              <Building className="w-5 h-5 text-brand-teal" />
              Room {selectedRoomNumber || 'Inspection'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Floor 2 • BVB Block • Wing: {selectedWingFilter === 'ALL' ? (selectedRoomStitchData?.wing || 'Main') : selectedWingFilter}
            </p>
          </div>
          <button
            onClick={() => setIsMobileInspectorOpen(false)}
            className="p-1.5 text-slate-400 hover:text-navy-900 hover:bg-slate-100 rounded-lg text-xs font-bold"
          >
            Close
          </button>
        </div>

        {/* Room Seats Grid */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Room Berths / Beds</div>
          <div className="grid grid-cols-2 gap-2">
            {['1', '2'].map((bedNum) => {
              const seatId = `seat_${selectedRoomNumber}_${bedNum}`;
              const isAllocated = isMyAllocationSeat(seatId);
              const isCoord = isRoommateCoordinatedSeat(seatId);
              const status = getSeatStatus(seatId);
              const isSelected = selectedSeatId === seatId;

              return (
                <div
                  key={seatId}
                  onClick={() => {
                    if (status !== 'LOCKED' && !isAllocated) {
                      setSelectedSeatId(seatId);
                    }
                  }}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    isSelected 
                      ? 'border-brand-teal bg-teal-50 ring-2 ring-brand-teal'
                      : isAllocated 
                        ? 'border-emerald-300 bg-emerald-50'
                        : isCoord 
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-extrabold text-navy-900">Bed {bedNum}</span>
                    <Bed className={`w-4 h-4 ${isSelected ? 'text-brand-teal' : 'text-slate-400'}`} />
                  </div>
                  <div className="text-[10px] font-semibold text-slate-500 capitalize">{status.toLowerCase()}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action button */}
        {selectedSeatId && !isConfirmedForCurrentStudent && (
          <div className="pt-2">
            <button
              onClick={() => initiateSeatSelection(selectedSeatId)}
              disabled={isConfirmSubmitting}
              className="w-full py-3 bg-brand-teal hover:bg-brand-tealHover text-white text-xs font-bold rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
            >
              {isConfirmSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Lock and Confirm Bed Selection</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
