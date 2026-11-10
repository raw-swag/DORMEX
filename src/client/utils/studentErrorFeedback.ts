/**
 * DORMEX Student-Facing Error Formatter
 * 
 * Maps raw backend technical errors and network exceptions to clear, actionable,
 * and reassuring messages for students without exposing internal SQL, stack traces,
 * or technical implementation details.
 */

export enum AllocationFeedbackType {
  CONFIGURATION_PENDING = 'CONFIGURATION_PENDING',
  TERMS_REQUIRED = 'TERMS_REQUIRED',
  STUDENT_INELIGIBLE = 'STUDENT_INELIGIBLE',
  CYCLE_INACTIVE = 'CYCLE_INACTIVE',
  SEAT_CONTENTION = 'SEAT_CONTENTION',
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  TURN_NOT_ACTIVE = 'TURN_NOT_ACTIVE',
  UNKNOWN = 'UNKNOWN',
}

export interface FormattedError {
  /** High-level feedback classification */
  type: AllocationFeedbackType;
  /** Clean, student-friendly explanation */
  friendlyMessage: string;
  /** Preserved raw error for developer diagnostics or telemetry */
  rawError?: string;
  /** Whether the error is actionable (e.g. contact office or retry) */
  actionable?: string;
}

export function formatStudentAllocationError(error: unknown): FormattedError {
  const rawMessage = error instanceof Error 
    ? error.message 
    : typeof error === 'string' 
      ? error 
      : 'Unknown error occurred';

  // 1. Missing pool configuration for student's quota and academic year
  if (rawMessage.includes('NO_MATCHING_POOL')) {
    return {
      type: AllocationFeedbackType.CONFIGURATION_PENDING,
      friendlyMessage: 'Allocation is not available for your current category and academic year yet. Please contact the Hostel Office if you need assistance.',
      rawError: rawMessage,
      actionable: 'Please visit or email the Hostel Office to verify your quota and academic year cohort setup.',
    };
  }

  // 2. Terms of Responsibility Agreement not accepted
  if (rawMessage.includes('TERMS_NOT_ACCEPTED')) {
    return {
      type: AllocationFeedbackType.TERMS_REQUIRED,
      friendlyMessage: 'You must review and accept the Hostel Room Responsibility Agreement before entering the allocation queue.',
      rawError: rawMessage,
      actionable: 'Please accept the mandatory residency agreement to proceed.',
    };
  }

  // 3. Student Ineligible (e.g. Fee Pending or Academic Hold)
  if (rawMessage.includes('INELIGIBLE')) {
    return {
      type: AllocationFeedbackType.STUDENT_INELIGIBLE,
      friendlyMessage: 'Your account is currently pending administrative eligibility clearance. Please verify your fee payment with the Hostel Office.',
      rawError: rawMessage,
      actionable: 'Ensure SBI Collect payment verification has been certified by the warden desk.',
    };
  }

  // 4. Allocation Cycle Closed, Inactive, or Concluded
  if (rawMessage.includes('CYCLE_CLOSED') || rawMessage.includes('cycle is currently in')) {
    return {
      type: AllocationFeedbackType.CYCLE_INACTIVE,
      friendlyMessage: 'The allocation cycle is not currently accepting entries. Please wait for the Hostel Office to open the process.',
      rawError: rawMessage,
    };
  }

  // 5. Concurrent Seat Collision / Contention
  if (rawMessage.includes('SEAT_UNAVAILABLE') || rawMessage.includes('claimed concurrently') || rawMessage.includes('uq_seat_current')) {
    return {
      type: AllocationFeedbackType.SEAT_CONTENTION,
      friendlyMessage: 'This bed was just selected by another student ahead of you in priority order. Please select another available green bed.',
      rawError: rawMessage,
      actionable: 'Choose an alternate open bed on the floor map.',
    };
  }

  // 6. Request Timeout / Abort
  if (
    rawMessage.includes('REQUEST_TIMEOUT') || 
    rawMessage.includes('timed out') || 
    rawMessage.includes('AbortError') ||
    rawMessage.includes('signal is aborted')
  ) {
    return {
      type: AllocationFeedbackType.NETWORK_OFFLINE,
      friendlyMessage: 'The request took too long to respond. Please try again.',
      rawError: rawMessage,
      actionable: 'Please try again or refresh your browser.',
    };
  }

  // 7. Network Offline / Fetch Failure
  if (
    rawMessage.includes('Failed to fetch') || 
    rawMessage.includes('NetworkError') || 
    rawMessage.includes('Load failed') ||
    (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator && !navigator.onLine)
  ) {
    return {
      type: AllocationFeedbackType.NETWORK_OFFLINE,
      friendlyMessage: 'Unable to reach the hostel server. Please check your internet connection and try again.',
      rawError: rawMessage,
      actionable: 'Check your Wi-Fi or mobile data connection.',
    };
  }

  // 8. Turn Not Active or Forbidden Action
  if (rawMessage.includes('FORBIDDEN') || rawMessage.includes('NOT_ACTIVE_TURN_OWNER')) {
    return {
      type: AllocationFeedbackType.TURN_NOT_ACTIVE,
      friendlyMessage: 'It is not currently your turn to confirm a room. Please wait until your priority turn window becomes active.',
      rawError: rawMessage,
    };
  }

  // 9. Sanitized fallback for unhandled technical / database errors
  // Strips SQL keywords, postgres codes, and technical jargon
  const isTechnicalLeak = /sql|postgres|relation|table|foreign key|syntax error|stack trace|at line|select \*|insert into/i.test(rawMessage);
  
  if (isTechnicalLeak) {
    return {
      type: AllocationFeedbackType.UNKNOWN,
      friendlyMessage: 'An unexpected system issue occurred. Please refresh or contact hostel support if this persists.',
      rawError: rawMessage,
    };
  }

  // Fallback: If it's a reasonably clean message, use it or fallback to safe generic text
  return {
    type: AllocationFeedbackType.UNKNOWN,
    friendlyMessage: rawMessage && rawMessage.length < 150 
      ? rawMessage 
      : 'Unable to complete allocation action. Please try again shortly.',
    rawError: rawMessage,
  };
}
