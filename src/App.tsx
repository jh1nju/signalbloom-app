/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Sidebar, TABS, TabId } from './components/Sidebar';
import { TopBar, SiteOption } from './components/TopBar';
import { TabPlaceholder } from './components/TabPlaceholder';
import { NetworkHealthTab } from './components/NetworkHealthTab';
import { DevicesTab } from './components/DevicesTab';
import { SecurityTab } from './components/SecurityTab';
import { AiAssistantTab } from './components/AiAssistantTab';
import { DevApiTest } from './components/DevApiTest';
import { Terminal } from 'lucide-react';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_SITES: SiteOption[] = [
  { id: 'f227aede-afcb-40d3-9455-298e461d96ec', name: 'Manukau Clinic', address: '15 Putney Way, Manukau' },
  { id: 'a4bd5bb9-ef0a-4784-ad16-77b6f261e3dd', name: 'Papatoetoe Clinic', address: '128 St George St, Papatoetoe' },
  { id: 'e0c18da5-39ab-4fd6-b7a2-182369c64bc4', name: 'Botany Clinic', address: '588 Chapel Rd, Botany' },
];

export default function App() {
  const isProd = import.meta.env.PROD || process.env.NODE_ENV === 'production';
  const [path, setPath] = useState(window.location.pathname);

  // Shell state
  const [currentTab, setCurrentTab] = useState<TabId>('health');
  const [organisationName, setOrganisationName] = useState<string>('Demo Dental Group');
  const [sites, setSites] = useState<SiteOption[]>(DEFAULT_SITES);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(() => {
    const stored = localStorage.getItem('signalbloom_selected_site_id') || '';
    return UUID_REGEX.test(stored) ? stored : DEFAULT_SITES[0].id;
  });
  const [isSampleData, setIsSampleData] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Handle browser popstate navigation
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Fetch organisation, sites, and sample_data setting
  useEffect(() => {
    const fetchShellData = async () => {
      try {
        const res = await fetch('/api/app-shell');
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json().catch(() => null);
          if (!data) return;
          if (data.organisation?.name) {
            setOrganisationName(data.organisation.name);
          }
          if (Array.isArray(data.sites) && data.sites.length > 0) {
            setSites(data.sites);
            setSelectedSiteId((prev) => {
              const exists = data.sites.some((s: SiteOption) => s.id === prev);
              const nextId = exists ? prev : data.sites[0].id;
              localStorage.setItem('signalbloom_selected_site_id', nextId);
              return nextId;
            });
          }
          setIsSampleData(Boolean(data.sampleData));
        }
      } catch {
        // Ignore transient network errors during dev server restarts
      }
    };

    fetchShellData();
  }, []);

  const handleSelectSite = (siteId: string) => {
    setSelectedSiteId(siteId);
    localStorage.setItem('signalbloom_selected_site_id', siteId);
  };

  // Dedicated dev-only testing route
  if (path === '/dev/api-test') {
    if (isProd) {
      return (
        <div className="min-h-screen bg-[#F0F4F8] text-[#1A2B3B] flex items-center justify-center p-6">
          <div className="glass-panel p-8 text-center max-w-sm">
            <h1 className="text-xl font-bold text-slate-800">404 - Not Found</h1>
            <p className="text-xs text-slate-500 mt-2">This page is not available in production.</p>
          </div>
        </div>
      );
    }
    return <DevApiTest selectedSiteId={selectedSiteId} />;
  }

  const activeTabItem = TABS.find((t) => t.id === currentTab) || TABS[0];
  const activeSite = sites.find((s) => s.id === selectedSiteId) || sites[0];

  return (
    <div className="min-h-screen lg:h-screen w-full p-3 sm:p-4 box-border overflow-x-hidden lg:overflow-hidden">
      <div className="h-full w-full flex flex-col lg:grid lg:grid-cols-[260px_1fr] gap-4">
        {/* Left Sidebar */}
        <Sidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          isOpenMobile={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
        />

        {/* Main View Area */}
        <main className="flex-1 flex flex-col gap-4 min-w-0 h-full overflow-hidden">
          {/* Header */}
          <TopBar
            organisationName={organisationName}
            sites={sites}
            selectedSiteId={selectedSiteId}
            onSelectSite={handleSelectSite}
            isSampleData={isSampleData}
            onToggleMobileMenu={() => setIsMobileMenuOpen(true)}
          />

          {/* Tab Content View */}
          {currentTab === 'health' ? (
            <NetworkHealthTab
              siteId={selectedSiteId}
              siteName={activeSite?.name || 'Selected site'}
            />
          ) : currentTab === 'security' ? (
            <SecurityTab
              siteId={selectedSiteId}
              siteName={activeSite?.name || 'Selected site'}
            />
          ) : currentTab === 'devices' ? (
            <DevicesTab
              siteId={selectedSiteId}
              siteName={activeSite?.name || 'Selected site'}
            />
          ) : currentTab === 'ai' ? (
            <AiAssistantTab
              siteId={selectedSiteId}
              siteName={activeSite?.name || 'Selected site'}
            />
          ) : (
            <TabPlaceholder tab={activeTabItem} currentSite={activeSite} />
          )}
        </main>
      </div>

      {/* Dev helper pill (Strictly hidden when NODE_ENV is production) */}
      {!isProd && process.env.NODE_ENV !== 'production' && (
        <button
          onClick={() => {
            window.history.pushState({}, '', '/dev/api-test');
            setPath('/dev/api-test');
          }}
          className="fixed bottom-6 right-6 z-40 px-4 py-2 rounded-full font-mono text-[11px] font-medium flex items-center gap-2 shadow-xl transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          style={{
            background: 'rgba(26, 43, 59, 0.9)',
            color: 'white',
            backdropFilter: 'blur(10px)',
          }}
          title="Open dev test runner"
        >
          <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--accent-mint)' }} strokeWidth={2.5} />
          <span>dev/api-test</span>
        </button>
      )}
    </div>
  );
}
