import React from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Laptop, 
  Sparkles, 
  Settings, 
  X,
  Radio
} from 'lucide-react';

export type TabId = 'health' | 'security' | 'devices' | 'ai' | 'settings';

export interface TabItem {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string; width?: number; height?: number; strokeWidth?: number }>;
  description: string;
}

export const TABS: TabItem[] = [
  {
    id: 'health',
    label: 'Network Health',
    icon: Activity,
    description: 'Overall health score, connection speed, response time, and trend graphs for your internet line.',
  },
  {
    id: 'security',
    label: 'Security',
    icon: ShieldCheck,
    description: 'Network safety status, unknown device alerts, and recent security events.',
  },
  {
    id: 'devices',
    label: 'Devices',
    icon: Laptop,
    description: "An inventory of every computer, printer, phone, and equipment connected to this clinic's network.",
  },
  {
    id: 'ai',
    label: 'AI Assistant',
    icon: Sparkles,
    description: 'Plain-English explanations of network problems, prioritised recommendations, and troubleshooting chat.',
  },
  {
    id: 'settings',
    label: 'Account & Settings',
    icon: Settings,
    description: 'Clinic locations, one-time agent setup codes, staff user permissions, and email alert preferences.',
  },
];

interface SidebarProps {
  currentTab: TabId;
  onSelectTab: (tab: TabId) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
}) => {
  return (
    <>
      {/* Mobile backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-900/25 backdrop-blur-xs z-40 lg:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Glass Panel */}
      <aside
        className={`fixed top-4 bottom-4 left-4 z-50 w-[260px] glass-panel flex flex-col justify-between transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0 shadow-2xl' : '-translate-x-[115%] lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col flex-1">
          {/* Sidebar Header */}
          <div className="p-6 border-b border-black/[0.05] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                style={{
                  background: 'var(--gradient)',
                  boxShadow: '0 4px 12px rgba(11, 79, 168, 0.2)',
                }}
              >
                <Radio className="w-5 h-5" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <span className="font-bold text-[1.1rem] tracking-tight block text-slate-900 leading-tight">
                  SignalBloom
                </span>
                <span className="font-mono text-[10px] uppercase text-slate-500/70 tracking-wider block">
                  Office Network Manager
                </span>
              </div>
            </div>

            {/* Mobile close button */}
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/60 transition-colors"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="p-3 flex-1 space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    onSelectTab(tab.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-left mb-1 ${
                    isActive
                      ? 'text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                  }`}
                  style={
                    isActive
                      ? {
                          background: 'var(--gradient)',
                          boxShadow: '0 4px 12px rgba(0, 128, 208, 0.2)',
                        }
                      : undefined
                  }
                >
                  <Icon
                    className={`w-[18px] h-[18px] shrink-0 ${
                      isActive ? 'text-white' : 'text-slate-500'
                    }`}
                    strokeWidth={2}
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="p-5 bg-white/30 border-t border-black/[0.05] rounded-b-[15px]">
          <p className="font-mono text-[10px] uppercase text-slate-500/70 tracking-wider">
            Dental Clinic Network
          </p>
          <p className="text-[11px] font-medium text-slate-700 mt-0.5">
            Designed for office managers
          </p>
        </div>
      </aside>
    </>
  );
};
