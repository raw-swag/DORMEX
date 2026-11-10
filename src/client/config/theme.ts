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
  },
  midnight: {
    bg: '#080F1C',
    nav: '#0D1929',
    card: '#111F32',
    elevated: '#17283D',
    inset: '#0A1626',
    border: '#293B52',
    borderSubtle: '#1B2C42',
    textPrimary: '#F1F5F9',
    textSecondary: '#B7C6D8',
    textMuted: '#91A4BA',
    teal: '#63D6C6',
    tealHover: '#82E6D8',
    selectionBlue: '#60A5FA',
  }
} as const;

/**
 * Standard Institutional UI Component Classes
 * Unified mobile-first styling helpers for buttons, inputs, cards, dialogs, and badges.
 */
export const UI_CLASSES = {
  // Buttons (All adhere strictly to minimum 44px/48px tap targets on touch devices)
  button: {
    primary: 'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-[#016A62] text-white hover:bg-[#0d6f66] active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-[#63D6C6] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer select-none',
    secondary: 'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm bg-white dark:bg-[#111F32] border border-[#E2E6E8] dark:border-[#293B52] text-[#203653] dark:text-[#F1F5F9] hover:bg-[#F0F4F6] dark:hover:bg-[#17283D] active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-[#63D6C6] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer select-none',
    destructive: 'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-[#C93B3B] text-white hover:bg-[#a12828] active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-[#C93B3B] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer select-none',
    ghost: 'inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[38px] px-3 py-2 rounded-lg font-medium text-xs sm:text-sm text-[#627084] dark:text-[#91A4BA] hover:text-[#203653] dark:hover:text-[#F1F5F9] hover:bg-[#F0F4F6] dark:hover:bg-[#17283D] transition-colors focus:outline-none cursor-pointer select-none',
    icon: 'inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[#627084] dark:text-[#91A4BA] hover:text-[#203653] dark:hover:text-[#F1F5F9] hover:bg-[#F0F4F6] dark:hover:bg-[#17283D] transition-colors focus:outline-none cursor-pointer',
  },
  // Form Controls
  input: {
    base: 'w-full min-h-[44px] px-3.5 py-2.5 text-xs sm:text-sm bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl text-[#203653] dark:text-[#F1F5F9] placeholder-[#627084]/70 dark:placeholder-[#91A4BA]/60 focus:outline-none focus:bg-white dark:focus:bg-[#111F32] focus:border-[#016A62] dark:focus:border-[#63D6C6] focus:ring-2 focus:ring-[#016A62]/20 dark:focus:ring-[#63D6C6]/20 transition-all font-sans',
    search: 'w-full min-h-[44px] pl-9 pr-3.5 py-2.5 text-xs sm:text-sm bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl text-[#203653] dark:text-[#F1F5F9] placeholder-[#627084]/70 dark:placeholder-[#91A4BA]/60 focus:outline-none focus:bg-white dark:focus:bg-[#111F32] focus:border-[#016A62] dark:focus:border-[#63D6C6] focus:ring-2 focus:ring-[#016A62]/20 dark:focus:ring-[#63D6C6]/20 transition-all font-sans',
    select: 'w-full min-h-[44px] px-3.5 py-2.5 text-xs sm:text-sm bg-[#F7F6F1] dark:bg-[#0A1626] border border-[#E2E6E8] dark:border-[#293B52] rounded-xl text-[#203653] dark:text-[#F1F5F9] focus:outline-none focus:bg-white dark:focus:bg-[#111F32] focus:border-[#016A62] dark:focus:border-[#63D6C6] focus:ring-2 focus:ring-[#016A62]/20 dark:focus:ring-[#63D6C6]/20 transition-all font-sans',
    label: 'block text-xs font-semibold text-[#203653] dark:text-[#E2E8F0] mb-1.5 select-none',
    helper: 'block text-[11px] text-[#627084] dark:text-[#91A4BA] mt-1',
  },
  // Cards & Containers
  card: {
    base: 'bg-white dark:bg-[#111F32] rounded-2xl border border-[#E2E6E8] dark:border-[#293B52] shadow-xs p-4 sm:p-6 transition-all',
    compact: 'bg-white dark:bg-[#111F32] rounded-xl border border-[#E2E6E8] dark:border-[#293B52] shadow-xs p-3.5 sm:p-4.5',
    interactive: 'bg-white dark:bg-[#111F32] rounded-2xl border border-[#E2E6E8] dark:border-[#293B52] shadow-xs p-4 sm:p-6 hover:border-[#A8D5C2] dark:hover:border-[#63D6C6] hover:shadow-sm transition-all cursor-pointer',
    elevated: 'bg-white dark:bg-[#17283D] rounded-2xl border border-[#E2E6E8] dark:border-[#293B52] shadow-md p-4 sm:p-6',
  },
  // Status Badges
  badge: {
    available: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#1E7B54] dark:text-[#63D6C6] border border-[#A8D5C2] dark:border-[#1E5C50]',
    intent: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FFF0E6] dark:bg-[#2C1A0E] text-[#E06A26] dark:text-[#FBA468] border border-[#FFD1B3] dark:border-[#5E3114]',
    occupied: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FDE8E8] dark:bg-[#2D1214] text-[#C93B3B] dark:text-[#F87171] border border-[#F8B4B4] dark:border-[#5C2326]',
    selection: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#EBF3FC] dark:bg-[#0E2442] text-[#1D63B8] dark:text-[#60A5FA] border border-[#A5C7F3] dark:border-[#1D4E89]',
    neutral: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F0F4F6] dark:bg-[#0D1929] text-[#627084] dark:text-[#91A4BA] border border-[#DFE3E5] dark:border-[#293B52]',
  },
  // Bottom Sheet & Modal Container Wrappers
  sheet: {
    backdrop: 'fixed inset-0 z-50 bg-[#07203C]/70 dark:bg-[#080F1C]/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 transition-opacity animate-in fade-in duration-200',
    container: 'bg-white dark:bg-[#111F32] rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-6 space-y-4 border-t sm:border border-[#E2E6E8] dark:border-[#293B52] shadow-2xl max-h-[90dvh] overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] flex flex-col text-[#203653] dark:text-[#F1F5F9]',
    handle: 'w-10 h-1 bg-[#D5DCDF] dark:bg-[#293B52] rounded-full mx-auto sm:hidden -mt-1 mb-1 shrink-0',
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
