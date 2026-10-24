import React from 'react';
import { Menu, ChevronDown, MapPin, Building2, LogOut, User } from 'lucide-react';
import { AuthUserProfile } from '../firebase';

export interface SiteOption {
  id: string;
  name: string;
  address?: string;
  planName?: string;
}

interface TopBarProps {
  organisationName: string;
  sites: SiteOption[];
  selectedSiteId: string;
  onSelectSite: (siteId: string) => void;
  isSampleData: boolean;
  onToggleMobileMenu: () => void;
  user?: AuthUserProfile | null;
  onSignOut?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  organisationName,
  sites,
  selectedSiteId,
  onSelectSite,
  isSampleData,
  onToggleMobileMenu,
  user,
  onSignOut,
}) => {
  const roleLabel = user?.role === 'admin' ? 'Admin' : 'Staff';

  return (
    <header className="glass-panel h-[72px] px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile menu hamburger toggle */}
        <button
          onClick={onToggleMobileMenu}
          className="lg:hidden p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-white/50 transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Organisation name */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Building2 className="w-5 h-5 text-slate-400 shrink-0" strokeWidth={2} />
          <span className="font-semibold text-sm text-slate-800 tracking-tight truncate">
            {organisationName || 'Demo Dental Group'}
          </span>
        </div>
      </div>

      {/* Right side: Status badge + Clinic pill + Signed-in user & Sign out */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        {/* Sample data badge */}
        {isSampleData && (
          <span
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{
              background: 'rgba(217, 119, 6, 0.1)',
              color: 'var(--warning)',
              border: '1px solid rgba(217, 119, 6, 0.2)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span>Sample data</span>
          </span>
        )}

        {/* Clinic pill with custom dropdown */}
        <div
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-all"
          style={{
            background: 'rgba(255, 255, 255, 0.5)',
            borderColor: 'var(--glass-border)',
          }}
        >
          <MapPin
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: 'var(--accent-ocean)' }}
            strokeWidth={2.5}
          />
          <div className="relative flex items-center">
            <select
              value={selectedSiteId}
              onChange={(e) => onSelectSite(e.target.value)}
              className="bg-transparent text-[13px] font-semibold text-slate-800 focus:outline-none cursor-pointer pr-5 appearance-none"
              aria-label="Select clinic location"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id} className="text-slate-800 py-1 bg-white">
                  {site.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-0" />
          </div>
        </div>

        {/* Signed-in user name, role, and Sign out button */}
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-black/[0.07]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/60 border border-black/[0.06]">
              <User className="w-3.5 h-3.5 text-slate-500 shrink-0 hidden sm:block" />
              <span className="text-xs sm:text-[13px] font-semibold text-slate-800">
                {user.name}
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  user.role === 'admin'
                    ? 'bg-sky-50 text-sky-800 border-sky-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {roleLabel}
              </span>
            </div>

            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-slate-700 bg-white/75 hover:bg-white border border-slate-200/90 shadow-2xs transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
