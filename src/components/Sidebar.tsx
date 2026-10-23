import React from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Laptop, 
  Sparkles, 
  Settings, 
  X
} from 'lucide-react';
import { SignalBloomLogo } from './SignalBloomLogo';

export type TabId = 'health' | 'security' | 'devices' | 'ai' | 'settings';

export interface TabItem {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  description: string;
}

export const TABS: TabItem[] = [
  {
    id: 'health',
    label: 'Network health',
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
    description: "An inventory of every computer, printer, phone, and equipment connected to this site's network.",
  },
  {
    id: 'ai',
    label: 'AI assistant',
    icon: Sparkles,
    description: 'Plain-English explanations of network problems, prioritised recommendations, and troubleshooting chat.',
  },
  {
    id: 'settings',
    label: 'Account & settings',
    icon: Settings,
    description: 'Site locations, one-time agent setup codes, staff user permissions, and email alert preferences.',
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
          {/* Sidebar Header with blue-to-green flower logo and SignalBloom text only */}
          <div className="p-6 border-b border-black/[0.05] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="shrink-0 drop-shadow-xs">
                <SignalBloomLogo size={36} />
              </div>
              <span className="font-bold text-[1.2rem] tracking-tight text-slate-900">
                SignalBloom
              </span>
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

          {/* Navigation Items (Sentence Case) */}
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
      </aside>
    </>
  );
};
