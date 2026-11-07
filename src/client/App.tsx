import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { PWAInstallProvider } from './context/PWAInstallContext.js';
import { PWAInstallPrompt } from './components/PWAInstallPrompt.js';
import { AppLayout } from './components/AppLayout.js';
import { FloorPlanEditor } from './components/FloorPlanEditor.js';
import { StudentAllocationView } from './components/StudentAllocationView.js';
import { AdminDashboard } from './components/AdminDashboard.js';
import { StudentRegistryView } from './components/StudentRegistryView.js';
import { ComplaintsView } from './components/ComplaintsView.js';
import { PortalSelectionView } from './components/PortalSelectionView.js';
import { StudentAdmissionManagementView } from './components/StudentAdmissionManagementView.js';
import { MessMenuView } from './components/MessMenuView.js';

const AppContent: React.FC = () => {
  const { session, isAuthenticated, isLoading } = useAuth();

  // Show a neutral clean spinner during session restoration so protected views don't prematurely render
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F6F1] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-[#2C8279] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-[#203653]">Restoring institutional session...</span>
        </div>
      </div>
    );
  }

  // If not authenticated, show the 3 Login Portals Welcome Screen
  if (!isAuthenticated || !session) {
    return (
      <>
        <PortalSelectionView />
        <PWAInstallPrompt />
      </>
    );
  }

  const [currentTab, setCurrentTab] = useState<string>(
    session.role === 'STUDENT' ? 'student_allocation' : 'admin_overview'
  );

  return (
    <>
      <AppLayout currentTab={currentTab} setCurrentTab={setCurrentTab}>
        {currentTab === 'student_allocation' && <StudentAllocationView initialSubTab="allocation_map" />}
        {currentTab === 'student_profile' && <StudentAllocationView initialSubTab="workflow" />}
        {currentTab === 'student_complaints' && <ComplaintsView />}
        {currentTab === 'student_mess_menu' && <MessMenuView />}
        {currentTab === 'admin_overview' && <AdminDashboard />}
        {currentTab === 'admin_students' && <StudentRegistryView />}
        {currentTab === 'admin_floor_editor' && <FloorPlanEditor />}
        {currentTab === 'admin_complaints' && <ComplaintsView />}
        {currentTab === 'office_admissions' && <StudentAdmissionManagementView />}
        {currentTab === 'office_mess_menu' && <MessMenuView />}
      </AppLayout>
      <PWAInstallPrompt />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <PWAInstallProvider>
        <AppContent />
      </PWAInstallProvider>
    </AuthProvider>
  );
};
