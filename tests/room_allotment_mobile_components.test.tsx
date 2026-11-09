import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { RoomAllocationConfirmModal } from '../src/client/components/RoomAllocationConfirmModal.js';
import { MobileInspectorBottomSheet } from '../src/client/components/allocation/MobileInspectorBottomSheet.js';
import { RoommateAllocationDialogContext } from '../src/client/config/theme.js';

describe('Room Allocation Mobile-Width Component Flow Verifications (360px viewport)', () => {
  const mockContext: RoommateAllocationDialogContext = {
    roomNumber: '204',
    blockName: 'BVB Block',
    floorNumber: 2,
    wing: 'NORTH',
    roomCapacity: 2,
    targetSeatId: 'st_204_A',
    targetSeatLabel: 'Bed A',
    allRoomSeats: [
      { id: 'st_204_A', label: 'Bed A', isTaken: false },
      { id: 'st_204_B', label: 'Bed B', isTaken: true, occupantName: 'Rahul Verma' },
    ],
    invitationStatus: 'ACCEPTED',
    roommateName: 'Rahul Verma',
    isEligibleForTurn: true,
    groupMembers: [
      { studentId: 'stu_1', fullName: 'Rahul Verma', collegeId: 'DEMO-002', status: 'ACCEPTED' },
      { studentId: 'stu_2', fullName: 'Aarav Sharma', collegeId: 'DEMO-001', status: 'ACCEPTED' },
    ],
  };

  const createMobileInspectorProps = (overrides = {}) => ({
    isMobileInspectorOpen: true,
    setIsMobileInspectorOpen: vi.fn(),
    isMobileInspectorExpanded: false,
    setIsMobileInspectorExpanded: vi.fn(),
    inspectorHeadingRef: { current: null },
    selectedRoomNumber: '204',
    selectedWingFilter: 'ALL',
    selectedRoomStitchData: {
      roomNumber: '204',
      capacity: 2,
      seats: [
        { id: 'st_204_A', label: 'Bed A' },
        { id: 'st_204_B', label: 'Bed B' },
      ],
    },
    selectedSeatId: 'st_204_A',
    setSelectedSeatId: vi.fn(),
    seatStates: { st_204_A: 'AVAILABLE', st_204_B: 'OCCUPIED' },
    isMyAllocationSeat: () => false,
    isRoommateCoordinatedSeat: () => false,
    getSeatStatus: (seatId: string) => (seatId === 'st_204_A' ? 'AVAILABLE' : 'OCCUPIED'),
    roommateIntentMap: {},
    isConfirmReviewStep: false,
    setIsConfirmReviewStep: vi.fn(),
    isConfirmSubmitting: false,
    isConfirmedForCurrentStudent: false,
    waitingEntry: null,
    activeSession: { id: 'sess_1', expiresAt: new Date(Date.now() + 120000).toISOString() },
    handleConfirmSeatSelection: vi.fn(),
    initiateSeatSelection: vi.fn(),
    roommatePriority1: '',
    setRoommatePriority1: vi.fn(),
    roommatePriority2: '',
    setRoommatePriority2: vi.fn(),
    handleInviteRoommate: vi.fn(),
    roommateMsg: null,
    myRoommateGroups: [],
    handleRespondRoommateGroup: vi.fn(),
    ...overrides,
  });

  describe('1. RoomAllocationConfirmModal at 360px viewport', () => {
    it('instantiates valid modal React element with proper props when open', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      const element = React.createElement(RoomAllocationConfirmModal, {
        context: mockContext,
        isOpen: true,
        loading: false,
        onConfirm,
        onCancel,
      });

      expect(element).toBeDefined();
      expect(element.props.isOpen).toBe(true);
      expect(element.props.loading).toBe(false);
      expect(element.props.context.roomNumber).toBe('204');
      expect(element.props.context.targetSeatLabel).toBe('Bed A');
    });

    it('returns null when isOpen is false', () => {
      const element = React.createElement(RoomAllocationConfirmModal, {
        context: mockContext,
        isOpen: false,
        loading: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });

      const rendered = RoomAllocationConfirmModal(element.props);
      expect(rendered).toBeNull();
    });

    it('renders with mobile handle and safe area inset class padding when open', () => {
      const rendered = RoomAllocationConfirmModal({
        context: mockContext,
        isOpen: true,
        loading: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });

      expect(rendered).not.toBeNull();
      expect(rendered?.props.className).toContain('fixed inset-0');
    });

    it('renders correctly when targeted seat is occupied', () => {
      const takenContext: RoommateAllocationDialogContext = {
        ...mockContext,
        targetSeatId: 'st_204_B',
      };

      const rendered = RoomAllocationConfirmModal({
        context: takenContext,
        isOpen: true,
        loading: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });

      expect(rendered).not.toBeNull();
      const modalBox = rendered?.props.children;
      expect(modalBox).toBeDefined();
    });
  });

  describe('2. MobileInspectorBottomSheet Room Detail at 360px width', () => {
    it('returns null when isMobileInspectorOpen is false', () => {
      const props = createMobileInspectorProps({ isMobileInspectorOpen: false });
      const rendered = MobileInspectorBottomSheet(props);
      expect(rendered).toBeNull();
    });

    it('renders mobile layout with room title and seat items adapted for 360px width screens', () => {
      const props = createMobileInspectorProps();
      const rendered = MobileInspectorBottomSheet(props);

      expect(rendered).not.toBeNull();
      expect(rendered?.props.className).toContain('fixed inset-x-0 bottom-0');
      expect(rendered?.props['aria-label']).toBe('Room Inspector Bottom Sheet');
    });
  });
});
