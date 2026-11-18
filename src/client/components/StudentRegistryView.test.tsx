/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StudentRegistryView } from './StudentRegistryView.js';

let mockSession: any = {
  role: 'HOSTEL_OFFICE',
  userId: 'usr_office_1',
  profileId: null,
};

let mockApiFetchData: any[] = [];
let mockApiFetchStatus = 200;
let mockApiFetchError = '';

vi.mock('../context/AuthContext.js', () => ({
  useAuth: () => ({
    session: mockSession,
    isAuthenticated: true,
    isLoading: false,
  }),
  apiFetch: vi.fn(async (url: string) => {
    if (url.startsWith('/api/students')) {
      if (mockApiFetchStatus !== 200) {
        return {
          ok: false,
          status: mockApiFetchStatus,
          json: async () => ({ error: mockApiFetchError || 'Access denied' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockApiFetchData,
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [],
    };
  }),
}));

describe('StudentRegistryView Genuine DOM Component Interaction Suite', () => {
  const student1 = {
    id: 'prof_stu_001',
    college_id: '1SI25CS001',
    full_name: 'Ananya Sharma',
    department: 'Computer Science',
    academic_year: 3,
    quota_category: 'MERIT',
    assigned_priority: 1,
    parent_name: 'Mr. Ramesh Sharma',
    parent_relationship: 'Father',
    parent_phone: '+91 94481 11222',
    parent_email: 'ramesh.sharma@example.com',
    local_guardian_address: '#123 Malleshwaram, Bangalore',
    proctor_user_id: 'usr_prc_101',
    proctor_name: 'Dr. K. S. Murthy',
    proctor_department: 'Computer Science',
    fee_status: 'VERIFIED',
    fee_receipt_ref: 'SBICOLLECT-998811',
    fee_payment_timestamp: '2026-07-15T09:30:00.000Z',
    terms_accepted_at: '2026-07-16T10:15:00.000Z',
  };

  const student2 = {
    id: 'prof_stu_002',
    college_id: '1SI25EC002',
    full_name: 'Vikram Patel',
    department: 'Electronics',
    academic_year: 2,
    quota_category: 'GENERAL',
    assigned_priority: 2,
    parent_name: null,
    parent_relationship: null,
    parent_phone: null,
    parent_email: null,
    local_guardian_address: null,
    proctor_user_id: null,
    proctor_name: null,
    proctor_department: null,
    fee_status: 'UNPAID',
    fee_receipt_ref: null,
    fee_payment_timestamp: null,
    terms_accepted_at: null,
  };

  beforeEach(() => {
    mockSession = {
      role: 'HOSTEL_OFFICE',
      userId: 'usr_office_1',
      profileId: null,
    };
    mockApiFetchData = [student1, student2];
    mockApiFetchStatus = 200;
    mockApiFetchError = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Renders StudentRegistryView and mounts student list from API', async () => {
    render(<StudentRegistryView />);

    // Initially shows loading state
    expect(screen.getByText(/Loading registry applications/i)).toBeDefined();

    // Resolves and displays both students in the cohort table
    await waitFor(() => {
      expect(screen.getAllByText('Ananya Sharma').length).toBeGreaterThan(0);
      expect(screen.getAllByText('1SI25CS001').length).toBeGreaterThan(0);
      expect(screen.getByText('Vikram Patel')).toBeDefined();
      expect(screen.getByText('1SI25EC002')).toBeDefined();
    });
  });

  it('2. Opens Student 1 dossier and displays dynamic Guardian and Proctor information', async () => {
    render(<StudentRegistryView />);

    await waitFor(() => {
      expect(screen.getAllByText('Ananya Sharma').length).toBeGreaterThan(0);
    });

    // Student 1 is auto-selected as first candidate
    // Switch to Guardian tab
    const guardianTabBtn = screen.getByRole('button', { name: 'Guardian' });
    fireEvent.click(guardianTabBtn);

    // Assert real guardian data is rendered
    expect(screen.getByText(/Mr\. Ramesh Sharma/i)).toBeDefined();
    expect(screen.getByText(/\(Father\)/i)).toBeDefined();
    expect(screen.getByText(/\+91 94481 11222/)).toBeDefined();
    expect(screen.getByText(/#123 Malleshwaram, Bangalore/)).toBeDefined();

    // Old hardcoded mock data is NOT present
    expect(screen.queryByText(/Dr\. S\. Ramesh \(Father\)/)).toBeNull();

    // Switch to Proctor tab
    const proctorTabBtn = screen.getByRole('button', { name: 'Proctor' });
    fireEvent.click(proctorTabBtn);

    // Assert real proctor data is rendered
    expect(screen.getByText(/Dr\. K\. S\. Murthy/i)).toBeDefined();
    expect(screen.getByText(/Dept of Computer Science/i)).toBeDefined();
    expect(screen.getByText(/Proctor Staff ID: usr_prc_101/)).toBeDefined();

    // Old hardcoded professor name is NOT present
    expect(screen.queryByText(/Prof\. Manjunath Swamy/)).toBeNull();
  });

  it('3. Switches to Student 2 and confirms all information updates without retaining stale data', async () => {
    render(<StudentRegistryView />);

    await waitFor(() => {
      expect(screen.getByText('Vikram Patel')).toBeDefined();
    });

    // Click Student 2 row in the cohort table to select Student 2
    const s2Row = screen.getByText('Vikram Patel').closest('tr');
    expect(s2Row).not.toBeNull();
    fireEvent.click(s2Row!);

    // Open Guardian tab for Student 2
    fireEvent.click(screen.getByRole('button', { name: 'Guardian' }));

    // Student 2 has no guardian: check placeholder
    expect(screen.getByText(/No parent or guardian details recorded for this candidate/i)).toBeDefined();
    // Verify Student 1's guardian is completely gone
    expect(screen.queryByText(/Mr\. Ramesh Sharma/i)).toBeNull();

    // Open Proctor tab for Student 2
    fireEvent.click(screen.getByRole('button', { name: 'Proctor' }));

    // Student 2 has no proctor: check placeholder
    expect(screen.getByText(/Not assigned/i)).toBeDefined();
    expect(screen.getByText(/No faculty proctor is currently assigned to this student profile/i)).toBeDefined();
    // Verify Student 1's proctor is completely gone
    expect(screen.queryByText(/Dr\. K\. S\. Murthy/i)).toBeNull();
  });

  it('4. Renders permission error banner when unauthorized role attempts access', async () => {
    mockApiFetchStatus = 403;
    mockApiFetchError = 'FORBIDDEN: Insufficient permissions to view student registry';

    render(<StudentRegistryView />);

    await waitFor(() => {
      expect(screen.getByText(/Access Authorization Required/i)).toBeDefined();
    });

    // Does not display confidential student tables
    expect(screen.queryAllByText('Ananya Sharma').length).toBe(0);
    expect(screen.queryAllByText('Vikram Patel').length).toBe(0);
  });

  it('5. Renders empty cohort state cleanly when API returns 0 records', async () => {
    mockApiFetchData = [];

    render(<StudentRegistryView />);

    await waitFor(() => {
      expect(screen.getByText(/No Student Applications Found/i)).toBeDefined();
    });
  });
});

