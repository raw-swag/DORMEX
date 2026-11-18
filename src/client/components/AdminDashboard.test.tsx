/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AdminDashboard } from './AdminDashboard.js';

let mockSession: any = {
  role: 'SUPER_ADMIN',
  userId: 'usr_admin_1',
  fullName: 'Institutional System Admin',
};

let mockAuditLogs: any[] = [];
let mockAuditStatus = 200;
let mockAuditError = '';

vi.mock('../context/AuthContext.js', () => ({
  useAuth: () => ({
    session: mockSession,
    isAuthenticated: true,
    isLoading: false,
  }),
  apiFetch: vi.fn(async (url: string) => {
    if (url.startsWith('/api/admin/audit-logs')) {
      if (mockAuditStatus !== 200) {
        return {
          ok: false,
          status: mockAuditStatus,
          json: async () => ({ error: mockAuditError || 'Audit log access forbidden' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockAuditLogs,
      };
    }
    if (url.startsWith('/api/admin/overview')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ registeredStudents: 30, eligibleStudents: 24, availableSeats: 72 }),
      };
    }
    if (url.startsWith('/api/allocation-cycles')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'cyc_001',
            academic_year: '2026-27',
            semester: 'ODD',
            status: 'ACTIVE',
            active_turn_priority: 14,
            active_turn_expires_at: '2026-11-20T12:00:00.000Z',
          },
        ],
      };
    }
    if (url.startsWith('/api/buildings')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'bld_001',
            name: 'BVB Block',
            code: 'BVB',
            floors_count: 4,
          },
        ],
      };
    }
    if (url.startsWith('/api/room-change-requests')) {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    if (url.startsWith('/api/students')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'prof_stu_001',
            college_id: '1SI25CS001',
            full_name: 'Ananya Sharma',
            department: 'Computer Science',
            academic_year: 3,
            assigned_priority: 14,
            eligibility_status: 'ELIGIBLE',
            fee_status: 'VERIFIED',
          },
        ],
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [],
    };
  }),
}));

describe('AdminDashboard Genuine DOM Audit Trail Drawer Suite', () => {
  const sampleAuditRecord1 = {
    id: 'aud_rec_001',
    actor_id: 'usr_admin_1',
    actor_name: 'Chief Warden Office',
    action: 'FORCE_ALLOCATION_OVERRIDE',
    target_type: 'ALLOCATION',
    target_id: 'alloc_202',
    reason: 'Emergency medical accommodation approved by Chief Warden',
    created_at: '2026-11-18T10:30:00.000Z',
  };

  const sampleAuditRecord2 = {
    id: 'aud_rec_002',
    actor_id: 'usr_staff_2',
    actor_email: 'accounts@dormex.edu',
    action: 'FEE_VERIFIED',
    target_type: 'STUDENT_PROFILE',
    target_id: 'prof_stu_001',
    reason: null, // Test handling of missing optional field
    created_at: '2026-11-18T11:45:00.000Z',
  };

  beforeEach(() => {
    mockSession = {
      role: 'SUPER_ADMIN',
      userId: 'usr_admin_1',
      fullName: 'Institutional System Admin',
    };
    mockAuditLogs = [sampleAuditRecord1, sampleAuditRecord2];
    mockAuditStatus = 200;
    mockAuditError = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Mounts AdminDashboard and opens Audit Trail drawer with real fetched records', async () => {
    render(<AdminDashboard />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText(/Audit Trail Log/i)).toBeDefined();
    });

    // Find and click the Audit Trail Log header button
    const auditBtn = screen.getByRole('button', { name: /Audit Trail Log/i });
    fireEvent.click(auditBtn);

    // Verify drawer opened with institutional ledger title
    await waitFor(() => {
      expect(screen.getByText('Institutional Audit Ledger')).toBeDefined();
    });

    // Verify real records are rendered
    expect(screen.getByText('Force Allocation Override')).toBeDefined();
    expect(screen.getByText('Emergency medical accommodation approved by Chief Warden')).toBeDefined();
    expect(screen.getByText(/By: Chief Warden Office/i)).toBeDefined();

    expect(screen.getAllByText('Fee Verified').length).toBeGreaterThan(0);
    expect(screen.getByText(/By: accounts@dormex.edu/i)).toBeDefined();
    // Default fallback when reason is null
    expect(screen.getByText('Action on STUDENT_PROFILE (prof_stu_001)')).toBeDefined();

    // Verify old July 2024 static mock entries are completely absent
    expect(screen.queryByText(/Turn Granted \(Slot 14\)/i)).toBeNull();
    expect(screen.queryByText(/Room 202-C Pinned for Selection/i)).toBeNull();
    expect(screen.queryByText(/DUK8932401/i)).toBeNull();
  });

  it('2. Refreshes audit logs within drawer upon clicking Refresh button', async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Audit Trail Log/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Audit Trail Log/i }));

    await waitFor(() => {
      expect(screen.getByText('Institutional Audit Ledger')).toBeDefined();
    });

    // Append new live audit record to mock data before refreshing
    const newRecord = {
      id: 'aud_rec_003',
      actor_id: 'usr_warden_3',
      actor_name: 'Dr. Nagaraj (Hostel Warden)',
      action: 'CYCLE_STATUS_MODIFIED',
      target_type: 'CYCLE',
      target_id: 'cyc_001',
      reason: 'Routine priority turn increment',
      created_at: '2026-11-18T12:00:00.000Z',
    };
    mockAuditLogs = [sampleAuditRecord1, sampleAuditRecord2, newRecord];

    // Find and click the in-drawer Refresh button
    const refreshBtn = screen.getByTitle('Refresh logs');
    fireEvent.click(refreshBtn);

    // Verify the newly appended event appears in the timeline
    await waitFor(() => {
      expect(screen.getByText('Cycle Status Modified')).toBeDefined();
      expect(screen.getByText('Routine priority turn increment')).toBeDefined();
      expect(screen.getByText(/By: Dr. Nagaraj \(Hostel Warden\)/i)).toBeDefined();
    });
  });

  it('3. Renders empty audit state when no events exist in the ledger', async () => {
    mockAuditLogs = [];

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Audit Trail Log/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Audit Trail Log/i }));

    await waitFor(() => {
      expect(screen.getByText('No Audit Events Recorded')).toBeDefined();
      expect(screen.getByText(/No administrative transactions have been committed to this ledger yet/i)).toBeDefined();
    });
  });

  it('4. Renders error message in drawer when audit log API fails', async () => {
    mockAuditStatus = 500;
    mockAuditError = 'CRITICAL_DATABASE_ERROR: Audit table connection failed';

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Audit Trail Log/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Audit Trail Log/i }));

    await waitFor(() => {
      expect(screen.getByText('Audit Fetch Failure')).toBeDefined();
      expect(screen.getByText(/CRITICAL_DATABASE_ERROR: Audit table connection failed/i)).toBeDefined();
    });
  });

  it('5. Closes drawer when Dismiss button or close button is clicked', async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Audit Trail Log/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Audit Trail Log/i }));

    await waitFor(() => {
      expect(screen.getByText('Institutional Audit Ledger')).toBeDefined();
    });

    // Click Dismiss button
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissBtn);

    // Assert drawer is no longer mounted in DOM
    expect(screen.queryByText('Institutional Audit Ledger')).toBeNull();
  });
});

