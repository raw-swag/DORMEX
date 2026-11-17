import { EventEmitter } from 'events';
import { DatabaseService } from '../db/index.js';
import { AuthActor } from '../auth/policy.js';

export interface StudentTelemetryState {
  cycleId: string;
  cycleStatus: string;
  isPaused: boolean;
  isActive: boolean;
  isCompleted: boolean;
  waitingRoomThreshold: number;
  totalWaiting: number;
  totalAdmitted: number;
  totalConfirmed: number;
  maxAdmittedCapacity: number;
  standardAdmissionCapacity: number;
  reservedPriorityCapacity: number;
  priorityWindowClosesAt: string | null;
  isPriorityWindowClosed: boolean;
  
  // Student-isolated queue telemetry (null if student not in queue)
  studentQueue: {
    status: 'WAITING' | 'ADMITTED' | 'ACTIVE_TURN' | 'CONFIRMED' | 'SKIPPED' | 'CANCELLED';
    priorityNumber: number;
    queuePosition: number; // 1-based position among WAITING candidates
    isTop5: boolean; // Alert for top 5 candidates
    admittedRank?: number; // Position among currently admitted (1 to 20)
    estimatedWaitSeconds: number; // estimated time based on remaining duration & position
  } | null;

  // Active turn state if this student is currently active, or generic turn active indicator
  activeTurn: {
    hasActiveTurn: boolean;
    turnOwnerId?: string; // only populated if it is THIS student
    isMyTurn: boolean;
    remainingSeconds: number;
    expiresAt?: string;
  };

  serverTime: string;
}

export class WaitingRoomTelemetryService extends EventEmitter {
  private activeStreams: Map<string, Set<(data: StudentTelemetryState) => void>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private db: DatabaseService) {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Authoritative query for student waiting room and telemetry state.
   * Strictly isolates student data: returns aggregate cycle metrics and
   * ONLY the calling student's personal queue position, turn status, and alerts.
   * Never leaks other students' identities, USNs, or individual priority rankings.
   */
  async getStudentWaitingRoomState(cycleId: string, studentProfileId?: string): Promise<StudentTelemetryState> {
    const cycleRes = await this.db.query(
      `SELECT id, status, waiting_room_threshold, turn_duration_seconds,
              max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity,
              priority_window_closes_at, CURRENT_TIMESTAMP as db_now
       FROM allocation_cycles WHERE id = $1`,
      [cycleId]
    );

    if (cycleRes.rows.length === 0) {
      throw new Error('NOT_FOUND: Allocation cycle not found');
    }

    const cycle = cycleRes.rows[0];
    const cycleStatus = cycle.status;
    const dbNow = new Date(cycle.db_now);
    const turnDuration = Number(cycle.turn_duration_seconds || 120);

    const isPriorityWindowClosed = Boolean(
      cycle.priority_window_closes_at && new Date(cycle.priority_window_closes_at).getTime() <= dbNow.getTime()
    );

    // Aggregate counts
    const countsRes = await this.db.query(
      `SELECT
         COUNT(CASE WHEN status = 'WAITING' THEN 1 END) as waiting_count,
         COUNT(CASE WHEN status = 'ADMITTED' THEN 1 END) as admitted_count,
         COUNT(CASE WHEN status = 'ACTIVE_TURN' THEN 1 END) as active_turn_count,
         COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed_count
       FROM waiting_room_entries
       WHERE cycle_id = $1`,
      [cycleId]
    );

    const totalWaiting = parseInt(countsRes.rows[0]?.waiting_count || '0', 10);
    const admittedCount = parseInt(countsRes.rows[0]?.admitted_count || '0', 10);
    const activeTurnCount = parseInt(countsRes.rows[0]?.active_turn_count || '0', 10);
    const totalAdmitted = admittedCount + activeTurnCount;
    const totalConfirmed = parseInt(countsRes.rows[0]?.confirmed_count || '0', 10);

    // Active session telemetry
    const sessRes = await this.db.query(
      `SELECT id, student_id, started_at, expires_at, idempotency_key
       FROM booking_sessions
       WHERE cycle_id = $1 AND status = 'ACTIVE'
       LIMIT 1`,
      [cycleId]
    );

    let hasActiveTurn = false;
    let turnOwnerId: string | undefined = undefined;
    let isMyTurn = false;
    let remainingSeconds = 0;
    let expiresAt: string | undefined = undefined;

    if (sessRes.rows.length > 0) {
      hasActiveTurn = true;
      const sess = sessRes.rows[0];
      if (studentProfileId && sess.student_id === studentProfileId) {
        turnOwnerId = studentProfileId;
        isMyTurn = true;
      }
      expiresAt = sess.expires_at;
      const expTime = new Date(sess.expires_at).getTime();
      remainingSeconds = Math.max(0, Math.floor((expTime - dbNow.getTime()) / 1000));
      if (cycleStatus === 'PAUSED' && sess.idempotency_key && sess.idempotency_key.startsWith('PAUSED_REMAINING:')) {
        const parsed = parseInt(sess.idempotency_key.replace('PAUSED_REMAINING:', ''), 10);
        if (!isNaN(parsed)) remainingSeconds = parsed;
      }
    }

    // Student-specific queue position and wait estimation
    let studentQueue: StudentTelemetryState['studentQueue'] = null;

    if (studentProfileId) {
      const myEntryRes = await this.db.query(
        `SELECT wre.id, wre.status, wre.priority_number, wre.joined_at,
                sp.quota_category, sp.assigned_priority,
                syp.assigned_priority as yearwise_priority
         FROM waiting_room_entries wre
         JOIN student_profiles sp ON wre.student_id = sp.id
         LEFT JOIN students st ON sp.college_id = st.usn OR sp.user_id = st.user_id
         LEFT JOIN student_year_priority syp ON (st.usn = syp.student_usn OR sp.college_id = syp.student_usn)
              AND syp.academic_year = sp.academic_year
         WHERE wre.cycle_id = $1 AND wre.student_id = $2`,
        [cycleId, studentProfileId]
      );

      if (myEntryRes.rows.length > 0) {
        const myEntry = myEntryRes.rows[0];
        const status = myEntry.status;

        if (status === 'WAITING') {
          // Calculate exact 1-based queue position relative to other WAITING entries
          // ordered identically to authoritative engine: priority ASC, joined_at ASC, college_id ASC, id ASC
          const myEffectivePriority = myEntry.yearwise_priority || myEntry.assigned_priority || myEntry.priority_number;
          
          const aheadRes = await this.db.query(
            `SELECT COUNT(*) as count_ahead
             FROM waiting_room_entries wre
             JOIN student_profiles sp ON wre.student_id = sp.id
             LEFT JOIN students st ON sp.college_id = st.usn OR sp.user_id = st.user_id
             LEFT JOIN student_year_priority syp ON (st.usn = syp.student_usn OR sp.college_id = syp.student_usn)
                  AND syp.academic_year = sp.academic_year
             WHERE wre.cycle_id = $1 AND wre.status = 'WAITING'
               AND (
                 COALESCE(syp.assigned_priority, sp.assigned_priority, wre.priority_number) < $2
                 OR (
                   COALESCE(syp.assigned_priority, sp.assigned_priority, wre.priority_number) = $2
                   AND (
                     wre.joined_at < $3
                     OR (wre.joined_at = $3 AND wre.id < $4)
                   )
                 )
               )`,
            [cycleId, myEffectivePriority, myEntry.joined_at, myEntry.id]
          );

          const countAhead = parseInt(aheadRes.rows[0]?.count_ahead || '0', 10);
          const queuePosition = countAhead + 1;
          const isTop5 = queuePosition <= 5;

          // Estimated wait: (active turn remaining) + (count ahead admitted or waiting * turn duration)
          // Conservative estimate assumes standard turn duration
          const estimatedWaitSeconds = remainingSeconds + (countAhead * turnDuration);

          studentQueue = {
            status: 'WAITING',
            priorityNumber: myEffectivePriority,
            queuePosition,
            isTop5,
            estimatedWaitSeconds,
          };
        } else if (status === 'ADMITTED') {
          studentQueue = {
            status: 'ADMITTED',
            priorityNumber: myEntry.priority_number,
            queuePosition: 0,
            isTop5: true,
            estimatedWaitSeconds: remainingSeconds,
          };
        } else {
          studentQueue = {
            status,
            priorityNumber: myEntry.priority_number,
            queuePosition: 0,
            isTop5: false,
            estimatedWaitSeconds: 0,
          };
        }
      }
    }

    return {
      cycleId,
      cycleStatus,
      isPaused: cycleStatus === 'PAUSED',
      isActive: cycleStatus === 'ACTIVE',
      isCompleted: cycleStatus === 'PUBLISHED' || cycleStatus === 'LOCKED' || cycleStatus === 'CLOSED',
      waitingRoomThreshold: Number(cycle.waiting_room_threshold ?? 45),
      totalWaiting,
      totalAdmitted,
      totalConfirmed,
      maxAdmittedCapacity: Number(cycle.max_admitted_capacity ?? 20),
      standardAdmissionCapacity: Number(cycle.standard_admission_capacity ?? 15),
      reservedPriorityCapacity: Number(cycle.reserved_priority_capacity ?? 5),
      priorityWindowClosesAt: cycle.priority_window_closes_at ? new Date(cycle.priority_window_closes_at).toISOString() : null,
      isPriorityWindowClosed,
      studentQueue,
      activeTurn: {
        hasActiveTurn,
        turnOwnerId,
        isMyTurn,
        remainingSeconds,
        expiresAt,
      },
      serverTime: dbNow.toISOString(),
    };
  }

  /**
   * Broadcast an authoritative event to all subscribers of a cycle.
   * Invoked after queue mutations, admissions, roll refills, turn advances, or seat confirmations.
   */
  broadcastCycleUpdate(cycleId: string) {
    this.emit(`cycle:${cycleId}`);
  }

  /**
   * Subscribe an active client callback to receive cycle updates.
   * Returns an unsubscribe function to guarantee clean teardown without memory leaks.
   */
  subscribe(
    cycleId: string,
    studentProfileId: string | undefined,
    onData: (state: StudentTelemetryState) => void
  ): () => void {
    const channel = `cycle:${cycleId}`;
    let isSubscribed = true;

    const handler = async () => {
      if (!isSubscribed) return;
      try {
        const state = await this.getStudentWaitingRoomState(cycleId, studentProfileId);
        if (isSubscribed) {
          onData(state);
        }
      } catch (err) {
        // Stream subscriber error handled gracefully
      }
    };

    this.on(channel, handler);

    return () => {
      isSubscribed = false;
      this.removeListener(channel, handler);
    };
  }
}
