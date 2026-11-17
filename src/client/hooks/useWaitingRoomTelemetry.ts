import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../context/AuthContext.js';

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
  studentQueue: {
    status: 'WAITING' | 'ADMITTED' | 'ACTIVE_TURN' | 'CONFIRMED' | 'SKIPPED' | 'CANCELLED';
    priorityNumber: number;
    queuePosition: number;
    isTop5: boolean;
    admittedRank?: number;
    estimatedWaitSeconds: number;
  } | null;
  activeTurn: {
    hasActiveTurn: boolean;
    turnOwnerId?: string;
    isMyTurn: boolean;
    remainingSeconds: number;
    expiresAt?: string;
  };
  serverTime: string;
}

export interface UseWaitingRoomTelemetryResult {
  telemetry: StudentTelemetryState | null;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'polling_fallback' | 'error' | 'disconnected';
  lastUpdated: Date | null;
  reconnect: () => void;
  error: string | null;
}

export function useWaitingRoomTelemetry(
  cycleId: string | null,
  enabled: boolean = true
): UseWaitingRoomTelemetryResult {
  const [telemetry, setTelemetry] = useState<StudentTelemetryState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<UseWaitingRoomTelemetryResult['connectionStatus']>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);
  const isFallbackRef = useRef<boolean>(false);

  // Fallback REST polling mechanism
  const fetchAuthoritativePolling = async () => {
    if (!cycleId) return;
    try {
      const res = await apiFetch(`/api/allocation-cycles/${cycleId}/waiting-room/status`);
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
        setLastUpdated(new Date());
        setError(null);
        if (isFallbackRef.current) {
          setConnectionStatus('polling_fallback');
        }
      } else if (res.status === 401 || res.status === 403) {
        setError('Authentication expired or unauthorized');
        setConnectionStatus('error');
      }
    } catch (err: any) {
      setError(err.message || 'Telemetry network error');
      if (isFallbackRef.current) {
        setConnectionStatus('error');
      }
    }
  };

  const startPollingFallback = () => {
    isFallbackRef.current = true;
    setConnectionStatus('polling_fallback');
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    
    // Immediate poll
    fetchAuthoritativePolling();
    // Schedule periodic polling every 4 seconds
    pollTimerRef.current = setInterval(fetchAuthoritativePolling, 4000);
  };

  const connectSSE = () => {
    if (!cycleId || !enabled) return;

    if (typeof EventSource === 'undefined') {
      startPollingFallback();
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setConnectionStatus(retryCountRef.current > 0 ? 'reconnecting' : 'connecting');
    isFallbackRef.current = false;

    try {
      const sseUrl = `/api/allocation-cycles/${cycleId}/waiting-room/live`;
      const es = new EventSource(sseUrl, { withCredentials: true });
      eventSourceRef.current = es;

      es.addEventListener('open', () => {
        setConnectionStatus('connected');
        retryCountRef.current = 0;
        setError(null);
      });

      es.addEventListener('state', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setTelemetry(parsed);
          setLastUpdated(new Date());
          setError(null);
        } catch (e) {
          console.error('Failed to parse waiting room telemetry stream event:', e);
        }
      });

      es.onerror = () => {
        retryCountRef.current += 1;
        if (retryCountRef.current >= 3) {
          // Gracefully fallback to REST polling after consecutive failures
          startPollingFallback();
        } else {
          setConnectionStatus('reconnecting');
        }
      };
    } catch {
      startPollingFallback();
    }
  };

  useEffect(() => {
    if (!cycleId || !enabled) {
      setConnectionStatus('disconnected');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    retryCountRef.current = 0;
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [cycleId, enabled]);

  return {
    telemetry,
    connectionStatus,
    lastUpdated,
    reconnect: () => {
      retryCountRef.current = 0;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      connectSSE();
    },
    error,
  };
}
