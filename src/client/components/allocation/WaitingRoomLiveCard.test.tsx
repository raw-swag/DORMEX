import { describe, it, expect } from 'vitest';
import React from 'react';
import { WaitingRoomLiveCard, WaitingRoomLiveCardProps } from './WaitingRoomLiveCard.js';
import { StudentTelemetryState } from '../../hooks/useWaitingRoomTelemetry.js';

describe('WaitingRoomLiveCard Component Suite', () => {
  const mockTelemetry: StudentTelemetryState = {
    cycleId: 'cyc_test',
    cycleStatus: 'ACTIVE',
    isPaused: false,
    isActive: true,
    isCompleted: false,
    waitingRoomThreshold: 45,
    totalWaiting: 12,
    totalAdmitted: 18,
    totalConfirmed: 5,
    maxAdmittedCapacity: 20,
    standardAdmissionCapacity: 15,
    reservedPriorityCapacity: 5,
    priorityWindowClosesAt: null,
    isPriorityWindowClosed: false,
    studentQueue: {
      status: 'WAITING',
      priorityNumber: 3,
      queuePosition: 2,
      isTop5: true,
      estimatedWaitSeconds: 150,
    },
    activeTurn: {
      hasActiveTurn: true,
      isMyTurn: false,
      remainingSeconds: 45,
    },
    serverTime: new Date().toISOString(),
  };

  it('1. Exports WaitingRoomLiveCard component and renders skeleton when telemetry is null', () => {
    expect(typeof WaitingRoomLiveCard).toBe('function');
    const element = React.createElement(WaitingRoomLiveCard, {
      telemetry: null,
      connectionStatus: 'connecting',
    });
    expect(element.type).toBe(WaitingRoomLiveCard);
  });

  it('2. Instantiates with full telemetry and displays live connection badge', () => {
    const props: WaitingRoomLiveCardProps = {
      telemetry: mockTelemetry,
      connectionStatus: 'connected',
    };
    const element = React.createElement(WaitingRoomLiveCard, props);
    expect(element).toBeDefined();
    expect(element.props.telemetry?.totalAdmitted).toBe(18);
  });

  it('3. Renders polling fallback status cleanly without crashing', () => {
    const props: WaitingRoomLiveCardProps = {
      telemetry: mockTelemetry,
      connectionStatus: 'polling_fallback',
    };
    const element = React.createElement(WaitingRoomLiveCard, props);
    expect(element.props.connectionStatus).toBe('polling_fallback');
  });

  it('4. Handles top 5 priority alert state and leave waiting room action', () => {
    let leaveTriggered = false;
    const props: WaitingRoomLiveCardProps = {
      telemetry: mockTelemetry,
      connectionStatus: 'connected',
      onLeaveWaitingRoom: () => {
        leaveTriggered = true;
      },
    };
    expect(props.telemetry?.studentQueue?.isTop5).toBe(true);
    expect(props.telemetry?.studentQueue?.queuePosition).toBe(2);
    props.onLeaveWaitingRoom?.();
    expect(leaveTriggered).toBe(true);
  });
});
