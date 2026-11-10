import React from 'react';
import { Repeat, Clock, MapPin, Loader2 } from 'lucide-react';

export interface RoomChangeTabProps {
  myAllocation: any;
  roomChangeStatus: any;
  roomChangeTargetRoomId: string;
  setRoomChangeTargetRoomId: (id: string) => void;
  roomChangeReason: string;
  setRoomChangeReason: (reason: string) => void;
  allRooms: any[];
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const RoomChangeTab: React.FC<RoomChangeTabProps> = ({
  myAllocation,
  roomChangeStatus,
  roomChangeTargetRoomId,
  setRoomChangeTargetRoomId,
  roomChangeReason,
  setRoomChangeReason,
  allRooms,
  loading,
  onSubmit,
}) => {
  return (
    <div className="bg-white dark:bg-[#111F32] p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-bold text-navy-900 tracking-tight flex items-center gap-2">
            <Repeat className="w-5 h-5 text-brand-teal" />
            48-Hour Official Room-Change Window
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Formal room-change request window open for 48 hours following official cycle publication.
          </p>
        </div>

        <div className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600" />
          <span>Standard Window: 48h Post-Publication</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <div className="text-xs font-bold text-navy-900 uppercase tracking-wider">Current Confirmed Allocation</div>
          <div className="text-xl font-extrabold text-navy-900 font-mono">
            {myAllocation?.seatId || 'No confirmed allocation'}
          </div>
          <div className="text-xs text-slate-600 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-brand-teal" />
            <span>BVB Block, Floor 2</span>
          </div>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <div className="text-xs font-bold text-navy-900 uppercase tracking-wider">Existing Request Status</div>
          {roomChangeStatus ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  roomChangeStatus.status === 'APPROVED' 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : (roomChangeStatus.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')
                }`}>
                  {roomChangeStatus.status}
                </span>
                <span className="text-xs text-slate-500">Requested Room: {roomChangeStatus.target_room_number}</span>
              </div>
              <p className="text-xs text-slate-600 italic">"{roomChangeStatus.reason}"</p>
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              No active room change request submitted. You may submit one request below during the 48-hour window.
            </div>
          )}
        </div>
      </div>

      {!roomChangeStatus && (
        <form onSubmit={onSubmit} className="p-5 bg-slate-50/70 rounded-xl border border-slate-200 space-y-4">
          <h3 className="text-xs font-bold text-navy-900 uppercase tracking-wider">Submit Room Change Request</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Target Room on Floor 2</label>
              <select
                value={roomChangeTargetRoomId}
                onChange={(e) => setRoomChangeTargetRoomId(e.target.value)}
                required
                className="w-full text-xs bg-white dark:bg-[#111F32] border border-slate-300 rounded-lg px-3 py-2 text-navy-900 focus:outline-none focus:ring-1 focus:ring-brand-teal"
              >
                <option value="">Select target room...</option>
                {allRooms.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    Room {r.room_number} ({r.available_seats || 0} seats available)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Reason for Room Change</label>
              <input
                type="text"
                value={roomChangeReason}
                onChange={(e) => setRoomChangeReason(e.target.value)}
                placeholder="e.g. Academic project collaboration / medical accessibility"
                required
                className="w-full text-xs bg-white dark:bg-[#111F32] border border-slate-300 rounded-lg px-3 py-2 text-navy-900 focus:outline-none focus:ring-1 focus:ring-brand-teal"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-brand-teal hover:bg-brand-tealHover text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Submit Room Change Request
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
