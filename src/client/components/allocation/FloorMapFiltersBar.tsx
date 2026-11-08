import React from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export type WingFilterType = 'ALL' | 'NORTH' | 'SOUTH' | 'EAST';

export interface FloorMapFiltersBarProps {
  buildings: Array<{ id: string; name: string }>;
  selectedBuildingId: string;
  onSelectBuildingId: (id: string) => void;
  floors: Array<{ id: string; name?: string; floor_number: number }>;
  floorId: string;
  onSelectFloorId: (id: string) => void;
  selectedWingFilter: WingFilterType;
  onSelectWingFilter: (wing: WingFilterType) => void;
  selectedRoomNumber: string | null;
  onSelectRoomNumber: (room: string | null) => void;
  zoomLevel: number;
  onZoomChange: (updater: (prev: number) => number) => void;
  onZoomReset: () => void;
}

export const FloorMapFiltersBar: React.FC<FloorMapFiltersBarProps> = ({
  buildings,
  selectedBuildingId,
  onSelectBuildingId,
  floors,
  floorId,
  onSelectFloorId,
  selectedWingFilter,
  onSelectWingFilter,
  selectedRoomNumber,
  onSelectRoomNumber,
  zoomLevel,
  onZoomChange,
  onZoomReset,
}) => {
  const wingButtons: Array<{ id: WingFilterType; label: string; defaultRoom: string | null }> = [
    { id: 'ALL', label: 'All 72 Rooms', defaultRoom: null },
    { id: 'NORTH', label: 'North Wing (201–224)', defaultRoom: '202' },
    { id: 'SOUTH', label: 'South Wing (225–248)', defaultRoom: '226' },
    { id: 'EAST', label: 'East Wing (249–272)', defaultRoom: '250' },
  ];

  return (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-[#E2E6E8] shadow-xs space-y-4">
      {/* First Row: Title & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E2E6E8] pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-lg font-bold text-[#203653] tracking-tight">
              BVB Block — Floor 2 Allocation Map
            </h2>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-[#E7F2ED] text-[#1E7B54] border border-[#A8D5C2] px-2 py-0.5 rounded-full">
              Pilot Active
            </span>
          </div>
          <p className="text-xs text-[#627084] mt-0.5">
            Official 72-room residential layout (Rooms 201–272). Select any room to inspect bed matrix and configure roommate intent.
          </p>
        </div>

        {/* Building & Floor Selectors */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedBuildingId}
            onChange={(e) => onSelectBuildingId(e.target.value)}
            className="flex-1 sm:flex-none text-xs bg-[#F7F6F1] border border-[#E2E6E8] rounded-lg px-3 py-2 sm:py-1.5 text-[#263345] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2C8279]"
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            value={floorId}
            onChange={(e) => onSelectFloorId(e.target.value)}
            className="flex-1 sm:flex-none text-xs bg-[#F7F6F1] border border-[#E2E6E8] rounded-lg px-3 py-2 sm:py-1.5 text-[#263345] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2C8279]"
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name || `Floor ${f.floor_number}`}
              </option>
            ))}
            {floors.length === 0 && <option value="flr_bvb_2">Floor 2</option>}
          </select>
        </div>
      </div>

      {/* Second Row: Wing Filter Pills, Room Search, and Zoom Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Wing Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-[#627084] uppercase mr-1">Wings:</span>
          {wingButtons.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                onSelectWingFilter(w.id);
                onSelectRoomNumber(w.defaultRoom);
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                selectedWingFilter === w.id
                  ? 'bg-[#203653] text-white border-[#203653]'
                  : 'bg-[#F7F6F1] text-[#627084] border-[#E2E6E8] hover:bg-slate-200/60 hover:text-[#263345]'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        {/* Room Search & Zoom Toolbar */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
          {/* Search Room */}
          <div className="relative flex-1 sm:flex-none">
            <input
              type="text"
              placeholder="Search room (e.g. 202)..."
              value={selectedRoomNumber || ''}
              onChange={(e) => onSelectRoomNumber(e.target.value.trim() || null)}
              className="w-full sm:w-44 text-xs bg-[#F7F6F1] border border-[#E2E6E8] rounded-lg px-3 py-2 sm:py-1.5 text-[#263345] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C8279]"
            />
          </div>

          {/* SVG Zoom Controls */}
          <div className="flex items-center border border-[#E2E6E8] rounded-lg bg-[#F7F6F1] p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onZoomChange((z) => Math.max(0.6, parseFloat((z - 0.2).toFixed(1))))}
              title="Zoom Out"
              className="p-1.5 text-[#627084] hover:text-[#203653] hover:bg-white rounded transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono font-bold px-1.5 text-[#203653]">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={() => onZoomChange((z) => Math.min(2.0, parseFloat((z + 0.2).toFixed(1))))}
              title="Zoom In"
              className="p-1.5 text-[#627084] hover:text-[#203653] hover:bg-white rounded transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onZoomReset}
              title="Reset Zoom"
              className="p-1.5 text-[#627084] hover:text-[#203653] hover:bg-white rounded border-l border-[#E2E6E8] ml-0.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
