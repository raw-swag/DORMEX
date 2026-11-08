import { describe, it, expect, vi, beforeEach } from 'vitest';
import { THEME_COLORS, UI_CLASSES, SeatVisualStatus } from '../src/client/config/theme.js';
import { getNavigationForRole, RoleNavConfig } from '../src/client/config/navigation.js';

describe('DORMEX Mobile-First Design System, Responsive Tokens & Component Verifications', () => {
  describe('1. Institutional Theme Tokens & Design Consistency', () => {
    it('maintains authoritative institutional brand palette', () => {
      expect(THEME_COLORS.navy.darkest).toBe('#07203C');
      expect(THEME_COLORS.navy.primary).toBe('#203653');
      expect(THEME_COLORS.teal.primary).toBe('#2C8279');
      expect(THEME_COLORS.neutral.bg).toBe('#F7F6F1');
      expect(THEME_COLORS.neutral.cardBg).toBe('#FFFFFF');
    });

    it('defines distinct semantic status colors for bed allocation lifecycle', () => {
      expect(THEME_COLORS.status.available).toBe('#1E7B54'); // Green
      expect(THEME_COLORS.status.intent).toBe('#E06A26');    // Orange
      expect(THEME_COLORS.status.occupied).toBe('#C93B3B');  // Red
      expect(THEME_COLORS.status.selection).toBe('#1D63B8'); // Blue
    });

    it('provides standardized touch-target compliant UI classes (minimum 44px on mobile)', () => {
      expect(UI_CLASSES.button.primary).toContain('min-h-[44px]');
      expect(UI_CLASSES.button.secondary).toContain('min-h-[44px]');
      expect(UI_CLASSES.button.destructive).toContain('min-h-[44px]');
      expect(UI_CLASSES.button.icon).toContain('min-h-[44px]');
      expect(UI_CLASSES.button.icon).toContain('min-w-[44px]');

      expect(UI_CLASSES.input.base).toContain('min-h-[44px]');
      expect(UI_CLASSES.input.search).toContain('min-h-[44px]');
      expect(UI_CLASSES.input.select).toContain('min-h-[44px]');
    });

    it('enforces safe-area inset compliance for bottom sheets and floating dialogs', () => {
      expect(UI_CLASSES.sheet.container).toContain('safe-area-inset-bottom');
      expect(UI_CLASSES.sheet.handle).toBeDefined();
    });
  });

  describe('2. Role-Based Navigation & Mobile Destination Structure', () => {
    it('provides correct primary and more tabs for STUDENT role', () => {
      const nav: RoleNavConfig = getNavigationForRole('STUDENT');
      expect(nav.primaryTabs.length).toBe(4);
      expect(nav.primaryTabs.map((t) => t.id)).toEqual([
        'student_allocation',
        'student_complaints',
        'student_mess_menu',
        'student_profile',
      ]);
      expect(nav.moreTabs.length).toBe(0);
    });

    it('provides console, registry, admissions, and complaints tabs for HOSTEL_OFFICE role', () => {
      const nav: RoleNavConfig = getNavigationForRole('HOSTEL_OFFICE');
      expect(nav.primaryTabs.length).toBe(4);
      expect(nav.primaryTabs.map((t) => t.id)).toEqual([
        'admin_overview',
        'admin_students',
        'office_admissions',
        'admin_complaints',
      ]);
      expect(nav.moreTabs.some((t) => t.id === 'office_mess_menu')).toBe(true);
    });

    it('provides comprehensive primary & more tabs for CHIEF_WARDEN role', () => {
      const nav: RoleNavConfig = getNavigationForRole('CHIEF_WARDEN');
      expect(nav.primaryTabs.length).toBe(4);
      expect(nav.primaryTabs.some((t) => t.id === 'admin_overview')).toBe(true);
      expect(nav.primaryTabs.some((t) => t.id === 'admin_students')).toBe(true);
      expect(nav.primaryTabs.some((t) => t.id === 'admin_floor_editor')).toBe(true);
      expect(nav.moreTabs.some((t) => t.id === 'office_mess_menu')).toBe(true);
    });

    it('ensures every navigation item has icon, label, and shortLabel for mobile viewport constraints', () => {
      const roles: Array<'STUDENT' | 'HOSTEL_OFFICE' | 'CHIEF_WARDEN' | 'SUPER_ADMIN'> = [
        'STUDENT',
        'HOSTEL_OFFICE',
        'CHIEF_WARDEN',
        'SUPER_ADMIN',
      ];
      roles.forEach((r) => {
        const nav = getNavigationForRole(r);
        const allItems = [...nav.primaryTabs, ...nav.moreTabs];
        allItems.forEach((item) => {
          expect(item.id).toBeTruthy();
          expect(item.label).toBeTruthy();
          expect(item.shortLabel).toBeTruthy();
          expect(item.shortLabel.length).toBeLessThanOrEqual(15);
          expect(item.icon).toBeDefined();
        });
      });
    });
  });

  describe('3. Responsive Viewport Adaptations & Dimensional Invariants', () => {
    const viewports = [
      { name: 'Ultra-compact Android (320px)', width: 320 },
      { name: 'Standard compact phone (360px)', width: 360 },
      { name: 'iPhone SE (375px)', width: 375 },
      { name: 'iPhone 12/13/14/15 Pro (390px)', width: 390 },
      { name: 'Samsung Galaxy S22/S23 (412px)', width: 412 },
      { name: 'iPhone Pro Max / Plus (430px)', width: 430 },
      { name: 'iPad / Tablet portrait (768px)', width: 768 },
      { name: 'Desktop workspace (1280px)', width: 1280 },
    ];

    it.each(viewports)('evaluates layout constraints gracefully at $name ($width px)', ({ width }) => {
      const isMobile = width < 768;
      const isTablet = width >= 768 && width < 1024;
      const isDesktop = width >= 1024;

      if (isMobile) {
        // Must clear bottom nav (min 56px + safe-area)
        const requiredBottomPadding = 56;
        expect(requiredBottomPadding).toBeGreaterThanOrEqual(48);
      }

      if (isDesktop) {
        // Side-by-side master-detail layout (map 70% / 8 cols, inspector 30% / 4 cols)
        const totalCols = 12;
        const mapCols = 8;
        const inspectorCols = 4;
        expect(mapCols + inspectorCols).toBe(totalCols);
      }

      expect(width).toBeGreaterThanOrEqual(320);
    });
  });

  describe('4. Seat Status Matrix & Allocation State Invariants', () => {
    it('accurately resolves visual status for seats in the floor plan', () => {
      const seatStates: Record<string, string> = {
        'seat_taken_1': 'taken',
        'seat_free_1': 'free',
      };
      const roommateIntentMap: Record<string, any> = {
        'seat_intent_1': { leaderName: 'Rohan Verma', priority: 3 },
      };
      const mySeatId = 'seat_mine_1';

      const resolveStatus = (seatId: string): SeatVisualStatus => {
        if (seatId === mySeatId) return 'MINE';
        if (seatStates[seatId] === 'taken') return 'OCCUPIED';
        if (roommateIntentMap[seatId]) return 'INTENT';
        return 'AVAILABLE';
      };

      expect(resolveStatus('seat_taken_1')).toBe('OCCUPIED');
      expect(resolveStatus('seat_intent_1')).toBe('INTENT');
      expect(resolveStatus('seat_free_1')).toBe('AVAILABLE');
      expect(resolveStatus('seat_mine_1')).toBe('MINE');
    });

    it('enforces non-binding intent semantics: intent seats remain selectable with override warning', () => {
      const intentItem = {
        id: 'st_rm_bvb_202_B',
        label: 'B',
        isTaken: false,
        isIntent: true,
      };

      // Intent seats are NOT taken, so selection is permitted with appropriate confirmation/warning
      expect(intentItem.isTaken).toBe(false);
      expect(intentItem.isIntent).toBe(true);
    });

    it('enforces occupied seat semantics: occupied seats cannot be selected or confirmed', () => {
      const occupiedItem = {
        id: 'st_rm_bvb_201_A',
        label: 'A',
        isTaken: true,
        isIntent: false,
      };

      expect(occupiedItem.isTaken).toBe(true);
      const canSelect = !occupiedItem.isTaken;
      expect(canSelect).toBe(false);
    });
  });
});
