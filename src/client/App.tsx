import React, { useState, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { ThemeProvider } from './context/ThemeContext.js';
import { PWAInstallProvider } from './context/PWAInstallContext.js';
import { PWAInstallPrompt } from './components/PWAInstallPrompt.js';
import { NetworkStatusBanner } from './components/NetworkStatusBanner.js';
import { AppLayout } from './components/AppLayout.js';
import { PortalSelectionView } from './components/PortalSelectionView.js';
import { ChunkLoadErrorBoundary } from './components/ChunkLoadErrorBoundary.js';

// Route-level dynamic code splitting for internal post-login views (excluding PortalSelectionView)
const FloorPlanEditor = lazy(() => import('./components/FloorPlanEditor.js').then((m) => ({ default: m.FloorPlanEditor })));
const StudentAllocationView = lazy(() => import('./components/StudentAllocationView.js').then((m) => ({ default: m.StudentAllocationView })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard.js').then((m) => ({ default: m.AdminDashboard })));
const StudentRegistryView = lazy(() => import('./components/StudentRegistryView.js').then((m) => ({ default: m.StudentRegistryView })));
const ComplaintsView = lazy(() => import('./components/ComplaintsView.js').then((m) => ({ default: m.ComplaintsView })));
const StudentAdmissionManagementView = lazy(() => import('./components/StudentAdmissionManagementView.js').then((m) => ({ default: m.StudentAdmissionManagementView })));
const MessMenuView = lazy(() => import('./components/MessMenuView.js').then((m) => ({ default: m.MessMenuView })));
const DeviceManagementView = lazy(() => import('./components/DeviceManagementView.js').then((m) => ({ default: m.DeviceManagementView })));

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
        <NetworkStatusBanner />
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
      <NetworkStatusBanner />
      <AppLayout currentTab={currentTab} setCurrentTab={setCurrentTab}>
        <ChunkLoadErrorBoundary>
          <Suspense
            fallback={
              <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className="w-8 h-8 border-3 border-[#2C8279] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-stone-500 font-medium">Loading view...</p>
              </div>
            }
          >
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
            {currentTab === 'admin_devices' && <DeviceManagementView />}
          </Suspense>
        </ChunkLoadErrorBoundary>
      </AppLayout>
      <PWAInstallPrompt />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PWAInstallProvider>
          <AppContent />
        </PWAInstallProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};
