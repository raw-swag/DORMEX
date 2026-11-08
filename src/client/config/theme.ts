/**
 * DORMEX Design System Tokens & Configuration Mappings
 * Centralized, reusable theme constants, status palettes, and display configurations.
 */

export const THEME_COLORS = {
  navy: {
    darkest: '#07203C',
    primary: '#203653',
    hover: '#17283B',
    slate: '#263345',
  },
  teal: {
    primary: '#2C8279',
    hover: '#20635C',
    container: '#E7F2ED',
    border: '#A8D5C2',
    accent: '#84D5CA',
  },
  gold: {
    primary: '#D4B779',
    hover: '#B69A5F',
    container: '#FAF4E6',
  },
  status: {
    available: '#1E7B54',      // GREEN - Open / Available
    availableBg: '#E7F2ED',
    availableBorder: '#A8D5C2',
    
    intent: '#E06A26',         // ORANGE - Roommate Intent / Warning
    intentBg: '#FFF0E6',
    intentBorder: '#FFD1B3',

    occupied: '#C93B3B',       // RED - Occupied / Blocked
    occupiedBg: '#FDE8E8',
    occupiedBorder: '#F8B4B4',

    selection: '#1D63B8',      // BLUE - Active Student Selection / My Confirmed Seat
    selectionBg: '#EBF3FC',
    selectionBorder: '#1D63B8',
  },
  neutral: {
    bg: '#F7F6F1',
    cardBg: '#FFFFFF',
    border: '#E2E6E8',
    textMuted: '#627084',
    textMain: '#203653',
  }
} as const;

/**
 * Standard Institutional UI Component Classes
 * Unified mobile-first styling helpers for buttons, inputs, cards, dialogs, and badges.
 */
export const UI_CLASSES = {
  // Buttons (All adhere strictly to minimum 44px/48px tap targets on touch devices)
  button: {
    primary: 'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-[#016A62] text-white hover:bg-[#0d6f66] active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-[#016A62] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer select-none',
    secondary: 'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm bg-white border border-[#E2E6E8] text-[#203653] hover:bg-[#F0F4F6] active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-[#2C8279] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer select-none',
    destructive: 'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-[#C93B3B] text-white hover:bg-[#a12828] active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-[#C93B3B] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer select-none',
    ghost: 'inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[38px] px-3 py-2 rounded-lg font-medium text-xs sm:text-sm text-[#627084] hover:text-[#203653] hover:bg-[#F0F4F6] transition-colors focus:outline-none cursor-pointer select-none',
    icon: 'inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[#627084] hover:text-[#203653] hover:bg-[#F0F4F6] transition-colors focus:outline-none cursor-pointer',
  },
  // Form Controls
  input: {
    base: 'w-full min-h-[44px] px-3.5 py-2.5 text-xs sm:text-sm bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl text-[#203653] placeholder-[#627084]/70 focus:outline-none focus:bg-white focus:border-[#016A62] focus:ring-2 focus:ring-[#016A62]/20 transition-all font-sans',
    search: 'w-full min-h-[44px] pl-9 pr-3.5 py-2.5 text-xs sm:text-sm bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl text-[#203653] placeholder-[#627084]/70 focus:outline-none focus:bg-white focus:border-[#016A62] focus:ring-2 focus:ring-[#016A62]/20 transition-all font-sans',
    select: 'w-full min-h-[44px] px-3.5 py-2.5 text-xs sm:text-sm bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl text-[#203653] focus:outline-none focus:bg-white focus:border-[#016A62] focus:ring-2 focus:ring-[#016A62]/20 transition-all font-sans',
    label: 'block text-xs font-semibold text-[#203653] mb-1.5 select-none',
    helper: 'block text-[11px] text-[#627084] mt-1',
  },
  // Cards & Containers
  card: {
    base: 'bg-white rounded-2xl border border-[#E2E6E8] shadow-xs p-4 sm:p-6 transition-all',
    compact: 'bg-white rounded-xl border border-[#E2E6E8] shadow-xs p-3.5 sm:p-4.5',
    interactive: 'bg-white rounded-2xl border border-[#E2E6E8] shadow-xs p-4 sm:p-6 hover:border-[#A8D5C2] hover:shadow-sm transition-all cursor-pointer',
    elevated: 'bg-white rounded-2xl border border-[#E2E6E8] shadow-md p-4 sm:p-6',
  },
  // Status Badges
  badge: {
    available: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#E7F2ED] text-[#1E7B54] border border-[#A8D5C2]',
    intent: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FFF0E6] text-[#E06A26] border border-[#FFD1B3]',
    occupied: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FDE8E8] text-[#C93B3B] border border-[#F8B4B4]',
    selection: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#EBF3FC] text-[#1D63B8] border border-[#A5C7F3]',
    neutral: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F0F4F6] text-[#627084] border border-[#DFE3E5]',
  },
  // Bottom Sheet & Modal Container Wrappers
  sheet: {
    backdrop: 'fixed inset-0 z-50 bg-[#07203C]/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 transition-opacity animate-in fade-in duration-200',
    container: 'bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-6 space-y-4 border-t sm:border border-[#E2E6E8] shadow-2xl max-h-[90dvh] overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] flex flex-col',
    handle: 'w-10 h-1 bg-[#D5DCDF] rounded-full mx-auto sm:hidden -mt-1 mb-1 shrink-0',
  }
} as const;

export type SeatVisualStatus = 'AVAILABLE' | 'INTENT' | 'OCCUPIED' | 'SELECTED' | 'MINE';

export interface RoommateAllocationDialogContext {
  groupId: string;
  cycleId: string;
  roomId: string;
  roomNumber: string;
  buildingId: string;
  buildingName: string;
  floorId: string;
  floorNumber: number;
  leaderName: string;
  targetSeatId: string;
  targetSeatLabel: string;
  allRoomSeats: Array<{
    id: string;
    label: string;
    isTaken: boolean;
    isIntent: boolean;
  }>;
  groupMembers: Array<{
    studentId: string;
    fullName: string;
    priorityNumber: number;
    status: string;
  }>;
  isEligibleForTurn: boolean;
  blockerMessage: string | null;
}
