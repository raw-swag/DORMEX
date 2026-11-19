/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { StudentAllocationView } from './StudentAllocationView.js';

let mockSession: any = {
  role: 'STUDENT',
  userId: 'usr_demo_001',
  profileId: 'prof_demo_001',
  collegeId: 'DEMO-001',
  fullName: 'Aarav Sharma',
};

let mockAllocationStatus = 200;
let mockAllocationData: any = null;
let mockProfileData: any = {
  id: 'prof_demo_001',
  user_id: 'usr_demo_001',
  college_id: 'DEMO-001',
  full_name: 'Aarav Sharma',
  academic_year: 2,
  quota_category: 'GENERAL',
  eligibility_status: 'ELIGIBLE',
  allocated_seat_id: 'st_rm_bvb_204_A', // Stale profile fallback candidate
  allocated_room_number: '204',
  allocated_seat_label: 'A',
  allocated_building_name: 'BVB Block',
};

vi.mock('../context/AuthContext.js', () => ({
  useAuth: () => ({
    session: mockSession,
    isAuthenticated: true,
    isLoading: false,
  }),
  apiFetch: vi.fn(async (url: string) => {
    if (url.startsWith('/api/students/prof_demo_001/allocation')) {
      if (mockAllocationStatus === 200) {
        return {
          ok: true,
          status: 200,
          json: async () => mockAllocationData,
        };
      }
      return {
        ok: false,
        status: mockAllocationStatus,
        json: async () => mockAllocationData || { error: `HTTP ${mockAllocationStatus}` },
      };
    }
    if (url.startsWith('/api/students/prof_demo_001/terms-status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, version: 1 }),
      };
    }
    if (url.startsWith('/api/students/prof_demo_001')) {
      return {
        ok: true,
        status: 200,
        json: async () => mockProfileData,
      };
    }
    if (url.startsWith('/api/allocation-cycles')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{
          id: 'cyc_bvb_pilot_2026',
          name: 'BVB Block Floor 2 Pilot',
          status: 'ACTIVE',
          academic_year: 2,
        }],
      };
    }
    if (url.startsWith('/api/buildings')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'bld_bvb', name: 'BVB Block' }],
      };
    }
    if (url.includes('/floors')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'flr_bvb_2', floor_number: 2, name: 'Floor 2' }],
      };
    }
    if (url.includes('/map')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ bounds: [0, 0, 900, 650], elements: [] }),
      };
    }
    if (url.includes('/rooms')) {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    if (url.includes('/roommate-groups')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ incoming: [], outgoing: null }),
      };
    }
    if (url.includes('/room-change-requests')) {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    if (url.includes('/state') || url.includes('/roommate-intent') || url.includes('/active-turn')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    };
  }),
}));

vi.mock('../../hooks/useWaitingRoomTelemetry.js', () => ({
  useWaitingRoomTelemetry: () => ({
    telemetry: null,
    connectionStatus: 'connected',
    reconnect: vi.fn(),
  }),
}));

describe('StudentAllocationView Allocation Retrieval Consistency Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem('dormex_allocation_guide_completed', 'true');
  });

  afterEach(() => {
    cleanup();
  });

  it('1. HTTP 200 with valid confirmed allocation renders authoritative allocation', async () => {
    mockAllocationStatus = 200;
    mockAllocationData = {
      allocation_id: 'alloc_auth_001',
      seat_id: 'st_rm_bvb_204_A',
      room_number: '204',
      seat_label: 'A',
      building_name: 'BVB Block',
      allocation_status: 'CURRENT',
      confirmed_at: '2026-11-19T10:00:00.000Z',
      cycle_id: 'cyc_bvb_pilot_2026',
    };

    render(React.createElement(StudentAllocationView, { initialSubTab: 'allocation_map' }));

    await waitFor(() => {
      const confirmedElements = screen.getAllByText(/Room Confirmed/i);
      expect(confirmedElements.length).toBeGreaterThan(0);
    });
  });

  it('2. HTTP 200 with empty/null allocation clears state without retaining stale data', async () => {
    mockAllocationStatus = 200;
    mockAllocationData = null; // HTTP 200 with no valid allocation object

    render(React.createElement(StudentAllocationView, { initialSubTab: 'allocation_map' }));

    await waitFor(() => {
      // Must not render "Room Confirmed"
      expect(screen.queryByText(/Room Confirmed/i)).toBeNull();
    });
  });

  it('3. HTTP 404 clears current allocation and never resurrects profile fallback data', async () => {
    mockAllocationStatus = 404;
    mockAllocationData = { error: 'NOT_FOUND: No current allocation found for student' };

    render(React.createElement(StudentAllocationView, { initialSubTab: 'allocation_map' }));

    await waitFor(() => {
      // Even though mockProfileData has allocated_seat_id: 'st_rm_bvb_204_A', 404 must clear allocation
      expect(screen.queryByText(/Room Confirmed/i)).toBeNull();
    });
  });

  it('4. HTTP 401/403 does not fall back to profile data and displays authorization error', async () => {
    mockAllocationStatus = 403;
    mockAllocationData = { error: 'FORBIDDEN: Students can only view their own allocation details' };

    render(React.createElement(StudentAllocationView, { initialSubTab: 'allocation_map' }));

    await waitFor(() => {
      expect(screen.queryByText(/Room Confirmed/i)).toBeNull();
      expect(screen.getByText(/FORBIDDEN: Students can only view their own allocation details/i)).toBeDefined();
    });
  });

  it('5. HTTP 500 displays clear retrieval error and prevents stale data from being mistaken for valid', async () => {
    mockAllocationStatus = 500;
    mockAllocationData = { error: 'INTERNAL_SERVER_ERROR: Database connection failure' };

    render(React.createElement(StudentAllocationView, { initialSubTab: 'allocation_map' }));

    await waitFor(() => {
      expect(screen.queryByText(/Room Confirmed/i)).toBeNull();
      expect(screen.getByText(/INTERNAL_SERVER_ERROR: Database connection failure/i)).toBeDefined();
    });
  });
});
