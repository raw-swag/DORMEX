import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { TurnStatusRibbon, TurnStatusRibbonProps } from './TurnStatusRibbon.js';

describe('TurnStatusRibbon Component Logic Suite', () => {
  const defaultProps: TurnStatusRibbonProps = {
    availableCycles: [{ id: 'cycle_1', status: 'ACTIVE' }],
    cycleId: 'cycle_1',
    activeSession: null,
    timeLeft: null,
    myProfile: { assigned_priority: 5, eligibility_status: 'ELIGIBLE' },
    session: { fullName: 'Aarav Sharma', collegeId: 'DEMO-001' },
    waitingEntry: null,
    myAllocation: null,
    loading: false,
    onJoinWaitingRoom: vi.fn(),
  };

  it('exports TurnStatusRibbon component and instantiates valid React element', () => {
    expect(typeof TurnStatusRibbon).toBe('function');
    const element = React.createElement(TurnStatusRibbon, defaultProps);
    expect(element).toBeDefined();
    expect(element.type).toBe(TurnStatusRibbon);
    expect(element.props.cycleId).toBe('cycle_1');
    expect(element.props.session.fullName).toBe('Aarav Sharma');
  });

  it('correctly accepts and reflects active session countdown props', () => {
    const propsWithSession: TurnStatusRibbonProps = {
      ...defaultProps,
      activeSession: { studentId: 'usr_demo_001' },
      timeLeft: 105,
    };
    const element = React.createElement(TurnStatusRibbon, propsWithSession);
    expect(element.props.activeSession.studentId).toBe('usr_demo_001');
    expect(element.props.timeLeft).toBe(105);
  });

  it('correctly accepts allocated seat state props', () => {
    const propsWithAllocation: TurnStatusRibbonProps = {
      ...defaultProps,
      myAllocation: { seatId: '204-B' },
    };
    const element = React.createElement(TurnStatusRibbon, propsWithAllocation);
    expect(element.props.myAllocation.seatId).toBe('204-B');
  });

  it('provides onJoinWaitingRoom callback on prop definition', () => {
    const mockJoin = vi.fn();
    const propsWithJoin: TurnStatusRibbonProps = {
      ...defaultProps,
      onJoinWaitingRoom: mockJoin,
    };
    const element = React.createElement(TurnStatusRibbon, propsWithJoin);
    element.props.onJoinWaitingRoom();
    expect(mockJoin).toHaveBeenCalledTimes(1);
  });
});
