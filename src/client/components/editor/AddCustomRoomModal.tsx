import React from 'react';

export interface AddCustomRoomModalProps {
  show: boolean;
  onClose: () => void;
  newRoomNum: string;
  setNewRoomNum: (num: string) => void;
  newRoomWing: 'North Wing' | 'South Wing' | 'East Wing';
  setNewRoomWing: (wing: 'North Wing' | 'South Wing' | 'East Wing') => void;
  newRoomType: '1' | '2' | '3';
  setNewRoomType: React.Dispatch<React.SetStateAction<'1' | '2' | '3'>>;
  newRoomWidth: number;
  setNewRoomWidth: (w: number) => void;
  newRoomHeight: number;
  setNewRoomHeight: (h: number) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const AddCustomRoomModal: React.FC<AddCustomRoomModalProps> = ({
  show,
  onClose,
  newRoomNum,
  setNewRoomNum,
  newRoomWing,
  setNewRoomWing,
  newRoomType,
  setNewRoomType,
  newRoomWidth,
  setNewRoomWidth,
  newRoomHeight,
  setNewRoomHeight,
  onSubmit,
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-[#07203C]/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#111F32] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-[#E2E6E8] dark:border-[#293B52]">
        <div className="flex items-center justify-between border-b border-[#E2E6E8] dark:border-[#293B52] pb-3">
          <div>
            <h3 className="text-sm font-bold text-[#07203C] dark:text-[#F1F5F9]">Add New Room to Architectural Layout</h3>
            <p className="text-[11px] text-[#74777E]">Configures room bounds and creates matching seat inventory.</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#74777E] hover:text-[#07203C] dark:text-[#F1F5F9] text-xs font-bold p-1"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-[#181C1E] block mb-1">Room Number (e.g. 273)</label>
            <input
              type="text"
              required
              value={newRoomNum}
              onChange={(e) => setNewRoomNum(e.target.value)}
              placeholder="e.g. 273"
              className="w-full text-xs bg-[#F0F4F6] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-lg px-3 py-2 text-[#07203C] dark:text-[#F1F5F9]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#181C1E] block mb-1">Corridor Wing</label>
            <select
              value={newRoomWing}
              onChange={(e) => setNewRoomWing(e.target.value as any)}
              className="w-full text-xs bg-[#F0F4F6] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-lg px-3 py-2 text-[#07203C] dark:text-[#F1F5F9]"
            >
              <option value="North Wing">North Wing Corridor</option>
              <option value="South Wing">South Wing Corridor</option>
              <option value="East Wing">East Wing Extension</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#181C1E] block mb-1">Capacity Configuration</label>
            <select
              value={newRoomType}
              onChange={(e) => setNewRoomType(e.target.value as any)}
              className="w-full text-xs bg-[#F0F4F6] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-lg px-3 py-2 text-[#07203C] dark:text-[#F1F5F9]"
            >
              <option value="1">Single Occupancy (1 Berth)</option>
              <option value="2">Double Occupancy (2 Berths)</option>
              <option value="3">Triple Occupancy (3 Berths)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#181C1E] block mb-1">Width (px)</label>
              <input
                type="number"
                value={newRoomWidth}
                onChange={(e) => setNewRoomWidth(parseInt(e.target.value, 10) || 50)}
                className="w-full text-xs bg-[#F0F4F6] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-lg px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#181C1E] block mb-1">Height (px)</label>
              <input
                type="number"
                value={newRoomHeight}
                onChange={(e) => setNewRoomHeight(parseInt(e.target.value, 10) || 30)}
                className="w-full text-xs bg-[#F0F4F6] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-lg px-2.5 py-1.5 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[#E2E6E8] dark:border-[#293B52]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-[#74777E] rounded-lg hover:text-[#07203C] dark:text-[#F1F5F9]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-lg shadow-sm"
            >
              Create & Place Room
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
