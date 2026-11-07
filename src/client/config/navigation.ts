import React from 'react';
import { 
  Building2, 
  Map, 
  Users, 
  Clock, 
  AlertCircle, 
  UserPlus, 
  Utensils, 
  UserCheck, 
  ShieldCheck, 
  FileText,
  Fingerprint, 
  Sliders, 
  Calendar,
  Home,
  CheckCircle2,
  MoreHorizontal,
  User
} from 'lucide-react';
import { Role } from '../context/AuthContext.js';

export interface NavItemConfig {
  id: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  isPrimary?: boolean;
}

export interface RoleNavConfig {
  primaryTabs: NavItemConfig[];
  moreTabs: NavItemConfig[];
}

export function getNavigationForRole(role: Role): RoleNavConfig {
  switch (role) {
    case 'STUDENT':
      return {
        primaryTabs: [
          {
            id: 'student_allocation',
            label: 'Floor Map & Allocation',
            shortLabel: 'Allocation',
            icon: Clock,
            isPrimary: true,
          },
          {
            id: 'student_complaints',
            label: 'Hostel Complaints',
            shortLabel: 'Complaints',
            icon: AlertCircle,
          },
          {
            id: 'student_mess_menu',
            label: 'Weekly Mess Menu',
            shortLabel: 'Mess Menu',
            icon: Utensils,
          },
          {
            id: 'student_profile',
            label: 'Profile & Registration',
            shortLabel: 'Profile',
            icon: User,
          },
        ],
        moreTabs: [],
      };

    case 'HOSTEL_OFFICE':
      return {
        primaryTabs: [
          {
            id: 'admin_overview',
            label: 'Allocation Console',
            shortLabel: 'Console',
            icon: Building2,
            isPrimary: true,
          },
          {
            id: 'admin_students',
            label: 'Hostel Office Registry',
            shortLabel: 'Registry',
            icon: Users,
          },
          {
            id: 'office_admissions',
            label: 'Student Admissions',
            shortLabel: 'Admissions',
            icon: UserPlus,
          },
          {
            id: 'admin_complaints',
            label: 'Complaint Inbox',
            shortLabel: 'Complaints',
            icon: AlertCircle,
          },
        ],
        moreTabs: [
          {
            id: 'office_mess_menu',
            label: 'Mess Menu Management',
            shortLabel: 'Mess Menu',
            icon: Utensils,
          },
          {
            id: 'admin_floor_editor',
            label: '2D Floor Plan Maker',
            shortLabel: 'Floor Plan',
            icon: Map,
          },
        ],
      };

    case 'WARDEN':
      return {
        primaryTabs: [
          {
            id: 'admin_overview',
            label: 'Warden Console',
            shortLabel: 'Dashboard',
            icon: Building2,
            isPrimary: true,
          },
          {
            id: 'admin_complaints',
            label: 'Hostel Complaints',
            shortLabel: 'Complaints',
            icon: AlertCircle,
          },
          {
            id: 'office_mess_menu',
            label: 'Weekly Mess Menu',
            shortLabel: 'Mess',
            icon: Utensils,
          },
          {
            id: 'admin_students',
            label: 'Resident Registry',
            shortLabel: 'Students',
            icon: Users,
          },
        ],
        moreTabs: [
          {
            id: 'office_admissions',
            label: 'Admissions Overview',
            shortLabel: 'Admissions',
            icon: UserPlus,
          },
        ],
      };

    case 'CHIEF_WARDEN':
      return {
        primaryTabs: [
          {
            id: 'admin_overview',
            label: 'Executive Allocation Console',
            shortLabel: 'Console',
            icon: Building2,
            isPrimary: true,
          },
          {
            id: 'admin_students',
            label: 'All-Hostels Registry',
            shortLabel: 'Registry',
            icon: Users,
          },
          {
            id: 'admin_complaints',
            label: 'Central Complaint Desk',
            shortLabel: 'Complaints',
            icon: AlertCircle,
          },
          {
            id: 'admin_floor_editor',
            label: 'Campus Floor Plans',
            shortLabel: 'Floor Plans',
            icon: Map,
          },
        ],
        moreTabs: [
          {
            id: 'office_admissions',
            label: 'Admissions Verification',
            shortLabel: 'Admissions',
            icon: UserPlus,
          },
          {
            id: 'office_mess_menu',
            label: 'Hostels Mess Menu',
            shortLabel: 'Mess Menu',
            icon: Utensils,
          },
        ],
      };

    case 'SUPER_ADMIN':
      return {
        primaryTabs: [
          {
            id: 'admin_devices',
            label: 'Two-Device Demo Auth',
            shortLabel: 'Devices',
            icon: Fingerprint,
            badge: '3 Slots',
          },
          {
            id: 'admin_overview',
            label: 'System Allocation Console',
            shortLabel: 'Console',
            icon: Building2,
            isPrimary: true,
          },
          {
            id: 'admin_students',
            label: 'Hostel Office Registry',
            shortLabel: 'Registry',
            icon: Users,
          },
          {
            id: 'office_admissions',
            label: 'Admissions Management',
            shortLabel: 'Admissions',
            icon: UserPlus,
          },
          {
            id: 'admin_complaints',
            label: 'Central Complaints',
            shortLabel: 'Complaints',
            icon: AlertCircle,
          },
        ],
        moreTabs: [
          {
            id: 'admin_floor_editor',
            label: '2D Floor Plan Maker',
            shortLabel: 'Floor Plan',
            icon: Map,
          },
          {
            id: 'office_mess_menu',
            label: 'Mess Menu Scheduling',
            shortLabel: 'Mess Menu',
            icon: Utensils,
          },
          {
            id: 'admin_devices',
            label: 'Two-Device Demo Auth',
            shortLabel: 'Devices',
            icon: Fingerprint,
            badge: '3 Slots',
          },
        ],
      };

    case 'PROCTOR':
      return {
        primaryTabs: [
          {
            id: 'admin_students',
            label: 'Assigned Mentees & Registry',
            shortLabel: 'Students',
            icon: UserCheck,
            isPrimary: true,
          },
          {
            id: 'admin_overview',
            label: 'Allocation Status Reference',
            shortLabel: 'Allocation',
            icon: Building2,
          },
        ],
        moreTabs: [],
      };

    default:
      return {
        primaryTabs: [
          {
            id: 'student_allocation',
            label: 'Floor Map & Allocation',
            shortLabel: 'Allocation',
            icon: Clock,
            isPrimary: true,
          },
        ],
        moreTabs: [],
      };
  }
}
