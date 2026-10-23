import React from 'react';
import { TabItem } from './Sidebar';
import { SiteOption } from './TopBar';

interface TabPlaceholderProps {
  tab: TabItem;
  currentSite?: SiteOption;
}

export const TabPlaceholder: React.FC<TabPlaceholderProps> = ({ tab, currentSite }) => {
  const Icon = tab.icon;
  const siteName = currentSite ? currentSite.name : 'Selected site';

  return (
    <div className="glass-panel p-6 sm:p-10 flex-1 overflow-y-auto">
      {/* Active location pill */}
      <div className="mb-6">
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
          style={{
            background: 'rgba(19, 232, 152, 0.1)',
            color: 'var(--success)',
            border: '1px solid rgba(19, 232, 152, 0.2)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--accent-mint)' }}
          />
          <span>Active location: {siteName}</span>
        </span>
      </div>

      {/* Meta label */}
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500 mb-1">
        Monitoring interface
      </p>

      {/* Title */}
      <h1 className="text-2xl sm:text-[32px] font-bold tracking-[-0.03em] text-slate-900 mt-2 mb-2 leading-tight">
        {tab.label}
      </h1>

      {/* One-line plain description */}
      <p className="text-sm text-slate-500 max-w-[540px] leading-relaxed mb-10">
        {tab.description}
      </p>

      {/* Glass dashed placeholder card */}
      <div
        className="rounded-[24px] p-10 sm:p-16 flex flex-col items-center justify-center text-center"
        style={{
          border: '2px dashed rgba(0, 0, 0, 0.08)',
          background: 'rgba(255, 255, 255, 0.2)',
        }}
      >
        <div
          className="w-16 h-16 rounded-[20px] bg-white flex items-center justify-center mb-6 shadow-xs"
          style={{
            color: 'var(--accent-ocean)',
            boxShadow: '0 10px 20px rgba(0, 0, 0, 0.05)',
          }}
        >
          <Icon className="w-8 h-8" strokeWidth={2} />
        </div>

        <h3 className="text-base font-semibold text-slate-800 mb-2">
          {tab.label} dashboard module
        </h3>
        <p className="text-[13px] text-slate-500 max-w-[340px] leading-relaxed">
          Detailed metrics for {siteName}. Connection verified and reporting stable.
        </p>
      </div>
    </div>
  );
};
