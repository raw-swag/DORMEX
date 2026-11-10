import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  formatStudentAllocationError,
  AllocationFeedbackType,
} from './studentErrorFeedback.js';
import { TurnStatusRibbon } from '../components/allocation/TurnStatusRibbon.js';

describe('Student Experience Phase 1: Friendly Error Handling & Allocation Queue Entry', () => {
  describe('Priority 1: formatStudentAllocationError unit scenarios', () => {
    it('1. maps NO_MATCHING_POOL to friendly configuration message', () => {
      const err = new Error('NO_MATCHING_POOL: No allocation pool configured for this quota/year');
      const feedback = formatStudentAllocationError(err);
      expect(feedback.type).toBe(AllocationFeedbackType.CONFIGURATION_PENDING);
      expect(feedback.friendlyMessage).toContain('Allocation is not available for your current category and academic year yet');
      expect(feedback.actionable).toContain('Hostel Office');
    });

    it('2. maps network failures to connection guidance', () => {
      const err = new Error('Failed to fetch: NetworkError when attempting to fetch resource');
      const feedback = formatStudentAllocationError(err);
      expect(feedback.type).toBe(AllocationFeedbackType.NETWORK_OFFLINE);
      expect(feedback.friendlyMessage).toContain('Unable to reach the hostel server');
      expect(feedback.friendlyMessage).not.toContain('NetworkError');
    });

    it('3. maps timeout errors to retry guidance', () => {
      const err = new Error('Request timed out after 10000ms');
      const feedback = formatStudentAllocationError(err);
      expect(feedback.type).toBe(AllocationFeedbackType.NETWORK_OFFLINE);
      expect(feedback.friendlyMessage).toContain('took too long to respond');
      expect(feedback.actionable).toContain('try again');
    });

    it('4. sanitizes unknown / technical SQL leaks without exposing syntax or tables', () => {
      const err = new Error('error: syntax error at or near "SELECT * FROM allocation_pools WHERE" (08P01)');
      const feedback = formatStudentAllocationError(err);
      expect(feedback.type).toBe(AllocationFeedbackType.UNKNOWN);
      expect(feedback.friendlyMessage).toBe('An unexpected system issue occurred. Please refresh or contact hostel support if this persists.');
      expect(feedback.friendlyMessage).not.toContain('SELECT');
      expect(feedback.friendlyMessage).not.toContain('08P01');
    });

    it('5. maps TERMS_NOT_ACCEPTED and INELIGIBLE correctly', () => {
      const termsErr = new Error('TERMS_NOT_ACCEPTED: Acceptance of responsibility agreement is required');
      const termsFb = formatStudentAllocationError(termsErr);
      expect(termsFb.type).toBe(AllocationFeedbackType.TERMS_REQUIRED);
      expect(termsFb.friendlyMessage).toContain('Hostel Room Responsibility Agreement');

      // INELIGIBLE with explicit status
      const ineligErr = new Error('INELIGIBLE: Student eligibility status is PENDING_VERIFICATION');
      const ineligFb = formatStudentAllocationError(ineligErr);
      expect(ineligFb.type).toBe(AllocationFeedbackType.STUDENT_INELIGIBLE);
      expect(ineligFb.friendlyMessage).toContain('status: PENDING VERIFICATION');
      expect(ineligFb.friendlyMessage).not.toContain('SBI Collect');
      expect(ineligFb.friendlyMessage).not.toContain('fee payment');

      // INELIGIBLE without explicit status uses safe generic message
      const genericInelig = formatStudentAllocationError(new Error('INELIGIBLE: Student not eligible'));
      expect(genericInelig.type).toBe(AllocationFeedbackType.STUDENT_INELIGIBLE);
      expect(genericInelig.friendlyMessage).toContain('Your account is currently not eligible for allocation');
      expect(genericInelig.friendlyMessage).not.toContain('SBI Collect');
      expect(genericInelig.friendlyMessage).not.toContain('fee payment');
    });

    it('5b. SEAT_UNAVAILABLE does not invent priority information', () => {
      const seatErr = new Error('SEAT_UNAVAILABLE');
      const feedback = formatStudentAllocationError(seatErr);
      expect(feedback.type).toBe(AllocationFeedbackType.SEAT_CONTENTION);
      expect(feedback.friendlyMessage).toBe('This bed is no longer available. Please select another available bed.');
      expect(feedback.friendlyMessage).not.toContain('ahead of you in priority');
      expect(feedback.friendlyMessage).not.toContain('higher-priority');
    });
  });

  describe('Priority 2: Allocation Queue Button States in TurnStatusRibbon', () => {
    const baseProps = {
      availableCycles: [{ id: 'cycle-1', status: 'ACTIVE' }],
      cycleId: 'cycle-1',
      activeSession: null,
      timeLeft: null,
      myProfile: { assigned_priority: 1, eligibility_status: 'ELIGIBLE' },
      session: { fullName: 'Aarav Sharma', collegeId: '1SI21CS001', profileId: 'prof-1' },
      waitingEntry: null,
      myAllocation: null,
      loading: false,
      onJoinWaitingRoom: vi.fn(),
      onOpenGuide: vi.fn(),
    };

    it('6. cycle not started disables queue entry button and shows waiting explanation', () => {
      const rendered = TurnStatusRibbon({
        ...baseProps,
        availableCycles: [{ id: 'cycle-1', status: 'READY' }],
      });

      expect(rendered).toBeDefined();
      const stringified = JSON.stringify(rendered);
      expect(stringified).toContain('Waiting for Allocation to Open');
      expect(stringified).toContain('The Hostel Office has not started the allocation cycle yet.');
    });

    it('7. active cycle and eligible student renders enabled Enter Allocation Queue button', () => {
      const rendered = TurnStatusRibbon(baseProps);
      expect(rendered).toBeDefined();
      const stringified = JSON.stringify(rendered);
      expect(stringified).toContain('Enter Allocation Queue');
    });

    it('8. already entered students show queue status and hide entry button', () => {
      const rendered = TurnStatusRibbon({
        ...baseProps,
        waitingEntry: { id: 'wait-1', queuePosition: 3, poolId: 'pool-1' },
      });

      expect(rendered).toBeDefined();
      const stringified = JSON.stringify(rendered);
      expect(stringified).not.toContain('Enter Allocation Queue');
      expect(stringified).toContain('in Queue');
      expect(stringified).toContain('3');
    });

    it('9. loading state renders Entering Queue feedback and aria-busy', () => {
      const rendered = TurnStatusRibbon({
        ...baseProps,
        loading: true,
      });

      expect(rendered).toBeDefined();
      const stringified = JSON.stringify(rendered);
      expect(stringified).toContain('Entering Queue...');
      expect(stringified).toContain('aria-busy');
    });

    it('10. paused and completed cycles display correct state badges and disable entry', () => {
      const pausedRendered = TurnStatusRibbon({
        ...baseProps,
        availableCycles: [{ id: 'cycle-1', status: 'PAUSED' }],
      });
      const pausedStr = JSON.stringify(pausedRendered);
      expect(pausedStr).toContain('Temporarily Paused');
      expect(pausedStr).not.toContain('Enter Allocation Queue');

      const publishedRendered = TurnStatusRibbon({
        ...baseProps,
        availableCycles: [{ id: 'cycle-1', status: 'PUBLISHED' }],
      });
      const publishedStr = JSON.stringify(publishedRendered);
      expect(publishedStr).toContain('Cycle Concluded');
      expect(publishedStr).not.toContain('Enter Allocation Queue');
    });
  });

  describe('Priority 3: queueEntryMutexRef behavior for queue entry', () => {
    it('11. simulates queueEntryMutexRef locking out concurrent invocations and releasing in finally', async () => {
      let activeCalls = 0;
      let maxConcurrent = 0;
      const queueEntryMutexRef = { current: false };

      const simulateQueueEntry = async (shouldFail = false) => {
        if (queueEntryMutexRef.current) return 'BLOCKED';
        queueEntryMutexRef.current = true;
        try {
          activeCalls++;
          maxConcurrent = Math.max(maxConcurrent, activeCalls);
          // Simulate network delay
          await new Promise((r) => setTimeout(r, 10));
          if (shouldFail) throw new Error('Network failure');
          return 'SUCCESS';
        } finally {
          activeCalls--;
          queueEntryMutexRef.current = false;
        }
      };

      // Concurrent invocations
      const [res1, res2] = await Promise.all([
        simulateQueueEntry(),
        simulateQueueEntry(),
      ]);

      expect(maxConcurrent).toBe(1);
      expect([res1, res2]).toContain('SUCCESS');
      expect([res1, res2]).toContain('BLOCKED');
      expect(queueEntryMutexRef.current).toBe(false);

      // Verify release on failure
      const failRes = await simulateQueueEntry(true).catch((e) => e.message);
      expect(failRes).toBe('Network failure');
      expect(queueEntryMutexRef.current).toBe(false);

      // Subsequent invocation works after failure release
      const followUpRes = await simulateQueueEntry(false);
      expect(followUpRes).toBe('SUCCESS');
      expect(queueEntryMutexRef.current).toBe(false);
    });

    it('12. prevents submission if student has already entered waiting queue', () => {
      const queueEntryMutexRef = { current: false };
      const waitingEntry = { id: 'wait-1', queuePosition: 2 };

      const handleJoinWaitingRoomSim = (entry: any) => {
        if (entry) return 'ALREADY_ENTERED';
        if (queueEntryMutexRef.current) return 'MUTEX_LOCKED';
        queueEntryMutexRef.current = true;
        try {
          return 'PROCEED';
        } finally {
          queueEntryMutexRef.current = false;
        }
      };

      expect(handleJoinWaitingRoomSim(waitingEntry)).toBe('ALREADY_ENTERED');
      expect(handleJoinWaitingRoomSim(null)).toBe('PROCEED');
    });
  });
});
