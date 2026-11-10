import React, { useState, useRef, useEffect } from 'react';
import { useTheme, ThemePreference } from '../context/ThemeContext.js';
import { Sun, Moon, Laptop, Check } from 'lucide-react';

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { themePreference, setThemePreference, resolvedTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const options: Array<{ value: ThemePreference; label: string; icon: React.FC<{ className?: string }> }> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Laptop },
  ];

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Select theme (current: ${themePreference}, active: ${resolvedTheme})`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-[#DFE3E5] dark:border-[#293B52] bg-white dark:bg-[#111F32] text-[#203653] dark:text-[#F1F5F9] hover:bg-[#F0F4F6] dark:hover:bg-[#17283D] transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#63D6C6] shadow-xs cursor-pointer select-none"
      >
        {resolvedTheme === 'dark' ? (
          <Moon className="w-4 h-4 text-[#63D6C6]" aria-hidden="true" />
        ) : (
          <Sun className="w-4 h-4 text-[#D49E34]" aria-hidden="true" />
        )}
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Theme options"
          className="absolute right-0 mt-2 w-36 bg-white dark:bg-[#111F32] rounded-xl border border-[#DFE3E5] dark:border-[#293B52] shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          {options.map((opt) => {
            const Icon = opt.icon;
            const isSelected = themePreference === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setThemePreference(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-xs font-semibold flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'text-[#016A62] dark:text-[#63D6C6] bg-[#E7F2ED] dark:bg-[#0E2F2B]'
                    : 'text-[#203653] dark:text-[#F1F5F9] hover:bg-[#F0F4F6] dark:hover:bg-[#17283D]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{opt.label}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#016A62] dark:text-[#63D6C6]" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
