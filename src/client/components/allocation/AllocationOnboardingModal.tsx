import React, { useState, useEffect } from 'react';
import {
  Compass,
  CheckCircle2,
  Clock,
  Users,
  Building,
  AlertCircle,
  X,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  HelpCircle
} from 'lucide-react';

interface AllocationOnboardingModalProps {
  onClose: () => void;
}

const ONBOARDING_COMPLETED_KEY = 'dormex_allocation_guide_completed';

export const isAllocationOnboardingCompleted = (): boolean => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
    }
  } catch {
    return false;
  }
  return false;
};

export const markAllocationOnboardingCompleted = (): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    }
  } catch {}
};

export const resetAllocationOnboarding = (): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    }
  } catch {}
};

export const AllocationOnboardingModal: React.FC<AllocationOnboardingModalProps> = ({ onClose }) => {
  const [step, setStep] = useState<number>(0);

  const steps = [
    {
      title: 'Welcome to DORMEX Allocation',
      subtitle: 'Institutional Room Selection Process',
      icon: Compass,
      content: (
        <div className="space-y-3 text-xs text-[#203653] leading-relaxed">
          <p>
            DORMEX is your college&apos;s authoritative hostel allotment engine. Allocations are strictly ordered by official institutional priority ranks.
          </p>
          <div className="p-3 bg-[#F0F4F6] rounded-xl border border-[#D5DCDF] space-y-1.5">
            <div className="font-bold text-[#07203C] flex items-center gap-1.5">
              <Building className="w-4 h-4 text-[#016A62]" aria-hidden="true" />
              <span>Pilot Scope & Eligibility</span>
            </div>
            <p className="text-[11px] text-[#627084]">
              Currently live for the <strong>BVB Block Floor 2</strong> cohort. Only students with verified institutional eligibility and fee clearance can select rooms.
            </p>
          </div>
        </div>
      ),
    },
    {
      title: 'Roommate Intent & Preferences',
      subtitle: 'What Orange & Blue Markers Mean',
      icon: Users,
      content: (
        <div className="space-y-3 text-xs text-[#203653] leading-relaxed">
          <p>
            You can indicate non-binding roommate preferences before your turn starts.
          </p>
          <div className="space-y-2">
            <div className="p-2.5 bg-[#FFF0E6] rounded-xl border border-[#FFD1B3] flex items-start gap-2">
              <span className="w-3 h-3 rounded-full bg-[#E06A26] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <strong className="text-[#E06A26]">Orange Seats (Intent):</strong> Another student invited you or indicated intent for this room. If you select it, you respect their group coordination.
              </div>
            </div>
            <div className="p-2.5 bg-[#EBF3FC] rounded-xl border border-[#1D63B8]/30 flex items-start gap-2">
              <span className="w-3 h-3 rounded-full bg-[#1D63B8] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <strong className="text-[#1D63B8]">Blue Seats:</strong> Represents your currently inspected or confirmed bed.
              </div>
            </div>
            <div className="p-2.5 bg-[#E7F2ED] rounded-xl border border-[#A8D5C2] flex items-start gap-2">
              <span className="w-3 h-3 rounded-full bg-[#1E7B54] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <strong className="text-[#1E7B54]">Green Seats:</strong> Open and available for selection.
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Your Active Turn Window',
      subtitle: 'Strict Queue Progression',
      icon: Clock,
      content: (
        <div className="space-y-3 text-xs text-[#203653] leading-relaxed">
          <p>
            When your priority turn becomes active, your countdown window opens at the top of the screen:
          </p>
          <ul className="list-disc pl-4 space-y-1.5 text-[11px] text-[#4E6178]">
            <li><strong>Exclusive Pick Window:</strong> Only the current active turn owner can confirm an open seat.</li>
            <li><strong>Awaiting Turn:</strong> When your turn is approaching, you can join the queue to hold your place.</li>
            <li><strong>Expiry Safety:</strong> If a student&apos;s turn timer elapses before confirmation, the turn automatically advances to the next eligible priority rank.</li>
          </ul>
        </div>
      ),
    },
    {
      title: 'Confirming Your Allotment',
      subtitle: 'Authoritative Two-Step Seat Lock',
      icon: CheckCircle2,
      content: (
        <div className="space-y-3 text-xs text-[#203653] leading-relaxed">
          <p>
            To confirm a room during your active turn:
          </p>
          <ol className="list-decimal pl-4 space-y-1.5 text-[11px] text-[#4E6178]">
            <li>Select an open green seat on the 2D interactive floor map.</li>
            <li>Review the room amenities, wing, and bed label in the bottom inspector panel.</li>
            <li>Click <strong>&quot;Confirm Room Allocation&quot;</strong>. The seat is locked atomically in the database and immediately generates your provisional allocation pass.</li>
          </ol>
          <div className="p-2.5 bg-[#E7F2ED] rounded-xl border border-[#A8D5C2] text-[#1E7B54] text-[11px] font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Turn time advances immediately upon confirmation so other students aren&apos;t kept waiting.</span>
          </div>
        </div>
      ),
    },
  ];

  const currentStep = steps[step];
  const StepIcon = currentStep.icon;

  const handleFinish = () => {
    markAllocationOnboardingCompleted();
    onClose();
  };

  const handleSkip = () => {
    markAllocationOnboardingCompleted();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#203653]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-guide-title"
    >
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-5 border border-[#E2E6E8] shadow-2xl animate-fadeIn">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#E2E6E8] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#E7F2ED] text-[#1E7B54] flex items-center justify-center font-bold shrink-0">
              <StepIcon className="w-5 h-5 text-[#1E7B54]" aria-hidden="true" />
            </div>
            <div>
              <h2 id="onboarding-guide-title" className="text-base font-bold text-[#203653]">
                {currentStep.title}
              </h2>
              <p className="text-xs text-[#627084]">{currentStep.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            aria-label="Skip onboarding"
            className="p-1 rounded-lg text-[#627084] hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Step Indicator Progress */}
        <div className="flex items-center justify-between gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i === step ? 'bg-[#016A62]' : i < step ? 'bg-[#A8D5C2]' : 'bg-[#E5E9EB]'
              }`}
            />
          ))}
        </div>

        {/* Body Content */}
        <div className="min-h-[190px] py-1">{currentStep.content}</div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between pt-3 border-t border-[#E2E6E8]">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs font-semibold text-[#627084] hover:text-[#203653] py-2 px-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
          >
            Skip Guide
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="py-2 px-3 border border-[#E2E6E8] text-[#203653] hover:bg-slate-50 text-xs font-bold rounded-xl transition-colors flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Back</span>
              </button>
            )}

            {step < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="py-2 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="py-2 px-4 bg-[#016A62] hover:bg-[#0d6f66] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#016A62]"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Get Started</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
