import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  RefreshCw,
  UserCheck,
  Cpu,
  FileText,
  CheckCircle2,
  CreditCard,
  Building2,
  Mail,
  Send,
  KeyRound,
  Copy,
  Check,
  Plus,
  Users as UsersIcon,
  PlugZap,
  ShieldAlert,
} from 'lucide-react';
import { authFetch } from '../firebase';
import { SiteAgentEmptyState } from './SiteAgentEmptyState';

export interface ActivityLogItem {
  id: string;
  siteId: string;
  actorType: 'user' | 'ai' | 'agent';
  action: string;
  plainText: string;
  subText: string | null;
  deviceName: string;
  commandType: string | null;
  status: string | null;
  createdAt: string;
}

interface ActivityLogResponse {
  siteId: string;
  items: ActivityLogItem[];
}

export interface AdminSiteSummaryItem {
  id: string;
  name: string;
  address: string;
  planName: string;
  monthlyPriceNzd: string;
  agentConnected: boolean;
  agentLastSeenAt: string | null;
  agentHostname: string | null;
  setupCode: string | null;
  setupCodeExpiresAt: string | null;
}

interface AdminSitesResponse {
  sites: AdminSiteSummaryItem[];
}

interface BillingSiteItem {
  id: string;
  name: string;
  address: string;
  planName: string;
  monthlyPriceNzd: string;
  priceDisplay?: string;
}

interface BillingResponse {
  currency: string;
  planName?: string;
  pricePerSiteNzd?: string;
  label?: string;
  totalMonthlyNzd: string;
  sites: BillingSiteItem[];
}

interface OrganisationUserItem {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff';
  emailAlerts: boolean;
}

interface OrganisationUsersResponse {
  users: OrganisationUserItem[];
}

export interface EmailOutboxItem {
  id: string;
  userId: string;
  alertId: string;
  subject: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
  recipientName: string;
  recipientEmail: string;
  recipientRole: 'admin' | 'staff';
  siteId: string | null;
  siteName: string | null;
}

interface EmailOutboxResponse {
  resendConfigured: boolean;
  outbox: EmailOutboxItem[];
}

interface AccountSettingsTabProps {
  siteId: string;
  siteName: string;
  organisationName: string;
  userRole?: 'admin' | 'staff';
  onSiteCreatedAndConnect?: (payload: {
    site: { id: string; name: string; address: string; planName?: string };
    setupCode: string;
    setupCodeExpiresAt: string;
  }) => void;
}

function formatActivityTimestamp(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatShortTimestamp(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const AccountSettingsTab: React.FC<AccountSettingsTabProps> = ({
  siteId,
  siteName,
  organisationName,
  userRole = 'admin',
  onSiteCreatedAndConnect,
}) => {
  const isAdmin = userRole === 'admin';

  const [adminSites, setAdminSites] = useState<AdminSiteSummaryItem[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrganisationUserItem[]>([]);
  const [togglingUserIds, setTogglingUserIds] = useState<Record<string, boolean>>({});
  const [outboxItems, setOutboxItems] = useState<EmailOutboxItem[]>([]);
  const [resendConfigured, setResendConfigured] = useState<boolean>(false);
  const [items, setItems] = useState<ActivityLogItem[]>([]);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Add site form state
  const [showAddSiteForm, setShowAddSiteForm] = useState<boolean>(false);
  const [newSiteName, setNewSiteName] = useState<string>('');
  const [newSiteAddress, setNewSiteAddress] = useState<string>('');
  const [addingSite, setAddingSite] = useState<boolean>(false);
  const [addSiteError, setAddSiteError] = useState<string | null>(null);

  // Standalone fallback state if onSiteCreatedAndConnect isn't supplied
  const [activeConnectCard, setActiveConnectCard] = useState<{
    siteId: string;
    siteName: string;
    setupCode: string;
    setupCodeExpiresAt: string;
  } | null>(null);

  // Setup code copy & regeneration state per site
  const [copiedSiteId, setCopiedSiteId] = useState<string | null>(null);
  const [creatingCodeBySiteId, setCreatingCodeBySiteId] = useState<Record<string, boolean>>({});

  const fetchAccountData = useCallback(
    async (silent = false) => {
      if (!siteId || !isAdmin) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      else setIsRefreshing(true);

      try {
        const [sitesRes, usersRes, logRes, billingRes, outboxRes] = await Promise.all([
          authFetch('/api/sites').catch(() => null),
          authFetch('/api/users').catch(() => null),
          authFetch(`/api/sites/${encodeURIComponent(siteId)}/activity-log`).catch(() => null),
          authFetch('/api/billing').catch(() => null),
          authFetch('/api/email-outbox').catch(() => null),
        ]);

        if (
          sitesRes &&
          sitesRes.ok &&
          (sitesRes.headers.get('content-type') || '').includes('application/json')
        ) {
          const sitesJson: AdminSitesResponse | null = await sitesRes.json().catch(() => null);
          if (sitesJson && Array.isArray(sitesJson.sites)) {
            setAdminSites(sitesJson.sites);
          }
        }

        if (
          usersRes &&
          usersRes.ok &&
          (usersRes.headers.get('content-type') || '').includes('application/json')
        ) {
          const usersJson: OrganisationUsersResponse | null = await usersRes.json().catch(() => null);
          if (usersJson && Array.isArray(usersJson.users)) {
            setOrgUsers(usersJson.users);
          }
        }

        if (
          logRes &&
          logRes.ok &&
          (logRes.headers.get('content-type') || '').includes('application/json')
        ) {
          const json: ActivityLogResponse | null = await logRes.json().catch(() => null);
          if (json && Array.isArray(json.items)) {
            setItems(json.items);
          }
        }

        if (
          billingRes &&
          billingRes.ok &&
          (billingRes.headers.get('content-type') || '').includes('application/json')
        ) {
          const billingJson: BillingResponse | null = await billingRes.json().catch(() => null);
          if (billingJson) {
            setBilling(billingJson);
          }
        }

        if (
          outboxRes &&
          outboxRes.ok &&
          (outboxRes.headers.get('content-type') || '').includes('application/json')
        ) {
          const outboxJson: EmailOutboxResponse | null = await outboxRes.json().catch(() => null);
          if (outboxJson && Array.isArray(outboxJson.outbox)) {
            setOutboxItems(outboxJson.outbox);
            setResendConfigured(Boolean(outboxJson.resendConfigured));
          }
        }
      } catch {
        // Ignore transient network errors
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [siteId, isAdmin]
  );

  useEffect(() => {
    setItems([]);
    fetchAccountData(false);
  }, [fetchAccountData]);

  useEffect(() => {
    if (!isAdmin) return;
    const interval = setInterval(() => {
      fetchAccountData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchAccountData, isAdmin]);

  // Strict guard: Staff cannot see Account & Settings
  if (!isAdmin) {
    return (
      <div className="glass-panel p-8 flex-1 flex flex-col items-center justify-center text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Admin access required</h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-sm">
          Account &amp; settings is only available to organisation administrators.
        </p>
      </div>
    );
  }

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newSiteName.trim();
    const trimmedAddress = newSiteAddress.trim();

    if (!trimmedName || !trimmedAddress) {
      setAddSiteError('Please enter both a site name and an address.');
      return;
    }

    setAddingSite(true);
    setAddSiteError(null);

    try {
      const res = await authFetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          address: trimmedAddress,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.site) {
        setAddSiteError(data?.error?.message || 'Could not create site. Please try again.');
        return;
      }

      const createdSite: AdminSiteSummaryItem = {
        id: data.site.id,
        name: data.site.name,
        address: data.site.address,
        planName: 'SignalBloom Standard',
        monthlyPriceNzd: '29.00',
        agentConnected: false,
        agentLastSeenAt: null,
        agentHostname: null,
        setupCode: data.setupCode || data.site.setupCode || null,
        setupCodeExpiresAt: data.setupCodeExpiresAt || data.site.setupCodeExpiresAt || null,
      };

      setAdminSites((prev) => [...prev, createdSite]);
      setNewSiteName('');
      setNewSiteAddress('');
      setShowAddSiteForm(false);

      const code = createdSite.setupCode || '';
      const expiresAt =
        createdSite.setupCodeExpiresAt || new Date(Date.now() + 24 * 3600 * 1000).toISOString();

      if (onSiteCreatedAndConnect) {
        onSiteCreatedAndConnect({
          site: {
            id: createdSite.id,
            name: createdSite.name,
            address: createdSite.address,
            planName: 'SignalBloom Standard',
          },
          setupCode: code,
          setupCodeExpiresAt: expiresAt,
        });
      } else {
        setActiveConnectCard({
          siteId: createdSite.id,
          siteName: createdSite.name,
          setupCode: code,
          setupCodeExpiresAt: expiresAt,
        });
      }
    } catch {
      setAddSiteError('Could not create site. Please try again.');
    } finally {
      setAddingSite(false);
    }
  };

  const handleCopySetupCode = async (targetSiteId: string, code: string | null) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedSiteId(targetSiteId);
      setTimeout(() => {
        setCopiedSiteId((prev) => (prev === targetSiteId ? null : prev));
      }, 2000);
    } catch {
      setCopiedSiteId(targetSiteId);
      setTimeout(() => {
        setCopiedSiteId((prev) => (prev === targetSiteId ? null : prev));
      }, 2000);
    }
  };

  const handleGenerateNewCode = async (targetSiteId: string) => {
    if (creatingCodeBySiteId[targetSiteId]) return;
    setCreatingCodeBySiteId((prev) => ({ ...prev, [targetSiteId]: true }));

    try {
      const res = await authFetch(`/api/sites/${encodeURIComponent(targetSiteId)}/setup-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.code) {
          setAdminSites((prev) =>
            prev.map((s) =>
              s.id === targetSiteId
                ? {
                    ...s,
                    setupCode: data.code,
                    setupCodeExpiresAt: data.expiresAt ?? null,
                  }
                : s
            )
          );
          if (copiedSiteId === targetSiteId) {
            setCopiedSiteId(null);
          }
        }
      }
    } catch {
      // Ignore transient error
    } finally {
      setCreatingCodeBySiteId((prev) => ({ ...prev, [targetSiteId]: false }));
    }
  };

  const handleToggleEmailAlerts = async (userItem: OrganisationUserItem) => {
    const nextVal = !userItem.emailAlerts;
    setTogglingUserIds((prev) => ({ ...prev, [userItem.id]: true }));
    setOrgUsers((prev) =>
      prev.map((u) => (u.id === userItem.id ? { ...u, emailAlerts: nextVal } : u))
    );

    try {
      const res = await authFetch(`/api/users/${encodeURIComponent(userItem.id)}/email-alerts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailAlerts: nextVal }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.user) {
          setOrgUsers((prev) =>
            prev.map((u) =>
              u.id === userItem.id ? { ...u, emailAlerts: data.user.emailAlerts } : u
            )
          );
        }
      } else {
        setOrgUsers((prev) =>
          prev.map((u) => (u.id === userItem.id ? { ...u, emailAlerts: !nextVal } : u))
        );
      }
    } catch {
      setOrgUsers((prev) =>
        prev.map((u) => (u.id === userItem.id ? { ...u, emailAlerts: !nextVal } : u))
      );
    } finally {
      setTogglingUserIds((prev) => ({ ...prev, [userItem.id]: false }));
    }
  };

  const billingSites: BillingSiteItem[] =
    billing?.sites && billing.sites.length > 0
      ? billing.sites
      : adminSites.map((s) => ({
          id: s.id,
          name: s.name,
          address: s.address,
          planName: 'SignalBloom Standard',
          monthlyPriceNzd: '29.00',
        }));

  return (
    <div className="glass-panel p-6 sm:p-8 flex-1 overflow-y-auto space-y-8">
      {/* Top context header (sentence case) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.05]">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: 'var(--accent-mint)' }}
            />
            <span className="font-semibold text-slate-800">Active location: {siteName}</span>
            <span className="text-slate-300">·</span>
            <span>Organisation: {organisationName}</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-2">
            Account &amp; settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Sites, setup codes, billing, users, email alerts, and activity log for {organisationName}.
          </p>
        </div>

        <button
          onClick={() => fetchAccountData(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 bg-white/60 hover:bg-white border border-slate-200 shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 cursor-pointer shrink-0"
          title="Refresh settings"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              isRefreshing ? 'animate-spin text-teal-600' : 'text-slate-400'
            }`}
          />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh now'}</span>
        </button>
      </div>

      {/* Standalone 'Connect this site' card if triggered without parent navigation */}
      {activeConnectCard && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              New site created: {activeConnectCard.siteName}
            </span>
            <button
              type="button"
              onClick={() => setActiveConnectCard(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Back to all settings
            </button>
          </div>
          <SiteAgentEmptyState
            siteId={activeConnectCard.siteId}
            hasRegisteredAgent={false}
            hasReadings={false}
            setupCode={activeConnectCard.setupCode}
            setupCodeExpiresAt={activeConnectCard.setupCodeExpiresAt}
            userRole="admin"
          />
        </div>
      )}

      {/* =================================================================== */}
      {/* 1. SITES SECTION */}
      {/* =================================================================== */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Sites</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Each location in {organisationName} and its current agent connection status.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowAddSiteForm((prev) => !prev);
              setAddSiteError(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white shadow-2xs transition-all cursor-pointer self-start sm:self-auto"
            style={{ background: 'var(--accent-blue)' }}
          >
            <Plus className="w-4 h-4" />
            <span>Add site</span>
          </button>
        </div>

        {/* Add site form */}
        {showAddSiteForm && (
          <form
            onSubmit={handleCreateSite}
            className="bg-white/90 rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Add a new site</h3>
              <span className="text-xs text-slate-500">
                Creates the site and opens its Connect this site card with a new 24-hour setup code
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="add-site-name"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Site name
                </label>
                <input
                  id="add-site-name"
                  type="text"
                  required
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  placeholder="e.g. Takapuna Clinic"
                  className="w-full px-3.5 py-2 rounded-xl text-sm text-slate-900 bg-white border border-slate-200 focus:outline-hidden focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="add-site-address"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Address
                </label>
                <input
                  id="add-site-address"
                  type="text"
                  required
                  value={newSiteAddress}
                  onChange={(e) => setNewSiteAddress(e.target.value)}
                  placeholder="e.g. 18 Hurstmere Road, Takapuna, Auckland"
                  className="w-full px-3.5 py-2 rounded-xl text-sm text-slate-900 bg-white border border-slate-200 focus:outline-hidden focus:border-sky-500"
                />
              </div>
            </div>

            {addSiteError && (
              <p className="text-xs font-medium text-rose-600">{addSiteError}</p>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowAddSiteForm(false);
                  setAddSiteError(null);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200/80 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addingSite}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--accent-blue)' }}
              >
                <PlugZap className="w-3.5 h-3.5" />
                <span>{addingSite ? 'Creating site...' : 'Create site'}</span>
              </button>
            </div>
          </form>
        )}

        {loading && adminSites.length === 0 ? (
          <div className="bg-white/75 rounded-2xl border border-black/[0.06] p-6 flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            <span className="text-sm text-slate-600">Loading sites...</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {adminSites.map((site) => (
              <div
                key={site.id}
                className="bg-white/80 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm sm:text-base font-bold text-slate-900">
                      {site.name}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{site.address}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/[0.05]">
                  {site.agentConnected ? (
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-700 tabular-nums">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-semibold text-emerald-800">Connected</span>
                      {site.agentLastSeenAt && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">
                            Last seen {formatActivityTimestamp(site.agentLastSeenAt)}
                          </span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-700">Not connected</span>
                      </div>
                      {onSiteCreatedAndConnect && (
                        <button
                          type="button"
                          onClick={() =>
                            onSiteCreatedAndConnect({
                              site: {
                                id: site.id,
                                name: site.name,
                                address: site.address,
                                planName: site.planName,
                              },
                              setupCode: site.setupCode || '',
                              setupCodeExpiresAt:
                                site.setupCodeExpiresAt ||
                                new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100/80 border border-sky-200 transition-colors cursor-pointer"
                        >
                          <PlugZap className="w-3.5 h-3.5" />
                          <span>Connect this site</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* 2. SETUP CODES SECTION */}
      {/* =================================================================== */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Setup codes
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              One-time setup codes for pairing an agent at each site (valid for 24 hours). Agent tokens are never shown.
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {adminSites.map((site) => {
            const hasValidCode = Boolean(
              site.setupCode &&
                (!site.setupCodeExpiresAt ||
                  new Date(site.setupCodeExpiresAt).getTime() > Date.now())
            );
            const isCopied = copiedSiteId === site.id;
            const isCreating = Boolean(creatingCodeBySiteId[site.id]);

            return (
              <div
                key={`code-${site.id}`}
                className="bg-white/80 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
              >
                <div className="space-y-1">
                  <div className="text-sm sm:text-base font-bold text-slate-900">
                    {site.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                    {hasValidCode && site.setupCode ? (
                      <>
                        <code
                          className="font-mono font-bold px-2.5 py-0.5 rounded-lg text-xs sm:text-sm border"
                          style={{
                            background: 'rgba(0, 128, 208, 0.08)',
                            color: 'var(--accent-ocean)',
                            borderColor: 'rgba(0, 128, 208, 0.2)',
                          }}
                        >
                          {site.setupCode}
                        </code>
                        <span>·</span>
                        <span>
                          Expires {formatShortTimestamp(site.setupCodeExpiresAt)} (24 hours)
                        </span>
                      </>
                    ) : (
                      <span>No valid setup code · Generate a new 24-hour code</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/[0.05] shrink-0">
                  <button
                    type="button"
                    disabled={!hasValidCode || !site.setupCode}
                    onClick={() => handleCopySetupCode(site.id, site.setupCode)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={isCreating}
                    onClick={() => handleGenerateNewCode(site.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100/80 border border-sky-200 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{isCreating ? 'Creating...' : 'New code'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 3. BILLING SECTION */}
      {/* =================================================================== */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Billing
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Sample pricing, no payments in this prototype.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-600 tabular-nums">
            Sample pricing, no payments in this prototype
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {billingSites.map((site) => (
            <div
              key={`billing-${site.id}`}
              className="bg-white/80 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex items-center justify-between gap-3 shadow-2xs"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0 mt-0.5">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">{site.name}</div>
                  <div className="text-xs text-slate-500">{site.address}</div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Sample pricing, no payments in this prototype
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0 tabular-nums">
                <div className="text-xs font-semibold text-slate-700">
                  SignalBloom Standard
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  NZ$29 a month
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 4. USERS & EMAIL ALERTS SECTION */}
      {/* =================================================================== */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <UsersIcon className="w-4 h-4 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Users
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Team members in {organisationName}, their role, and critical email alert preferences.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500">
            Email alerts: critical alerts only
          </span>
        </div>

        {loading && orgUsers.length === 0 ? (
          <div className="bg-white/75 rounded-2xl border border-black/[0.06] p-6 flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            <span className="text-sm text-slate-600">Loading users...</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {orgUsers.map((userItem) => {
              const isBusy = Boolean(togglingUserIds[userItem.id]);
              return (
                <div
                  key={userItem.id}
                  className="bg-white/80 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm sm:text-base font-bold text-slate-900">
                          {userItem.name}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-xs font-semibold text-slate-700">
                          {userItem.role === 'admin' ? 'Admin' : 'Staff'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{userItem.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/[0.05]">
                    <span className="text-xs font-medium text-slate-600">
                      Email alerts:{' '}
                      <strong
                        className={userItem.emailAlerts ? 'text-emerald-700' : 'text-slate-500'}
                      >
                        {userItem.emailAlerts ? 'On' : 'Off'}
                      </strong>
                    </span>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={userItem.emailAlerts}
                      aria-label={`Email alerts for ${userItem.name}`}
                      disabled={isBusy}
                      onClick={() => handleToggleEmailAlerts(userItem)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50 ${
                        userItem.emailAlerts ? 'bg-teal-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          userItem.emailAlerts ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* 5. OUTBOX SECTION */}
      {/* =================================================================== */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Outbox
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Critical alert emails created in <code className="font-mono text-[11px]">email_outbox</code> and their delivery status.{' '}
              {resendConfigured
                ? 'Sending via Resend (onboarding@resend.dev).'
                : 'RESEND_API_KEY is not set — emails stay queued.'}
            </p>
          </div>
          {outboxItems.length > 0 && (
            <span className="text-xs font-medium text-slate-600 tabular-nums">
              {outboxItems.length} {outboxItems.length === 1 ? 'email' : 'emails'}
            </span>
          )}
        </div>

        {loading && outboxItems.length === 0 ? (
          <div className="bg-white/75 rounded-2xl border border-black/[0.06] p-6 flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            <span className="text-sm text-slate-600">Loading email outbox...</span>
          </div>
        ) : outboxItems.length === 0 ? (
          <div className="bg-white/75 rounded-2xl border border-black/[0.06] p-6 flex items-center gap-3 shadow-2xs">
            <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <span className="text-sm font-medium text-slate-600">
              No critical alert emails in the outbox yet.
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {outboxItems.map((mail) => {
              const statusColor =
                mail.status === 'sent'
                  ? 'text-emerald-700'
                  : mail.status === 'failed'
                    ? 'text-rose-700'
                    : 'text-amber-700';

              const statusLabel =
                mail.status === 'sent'
                  ? 'Sent'
                  : mail.status === 'failed'
                    ? 'Failed'
                    : 'Queued';

              return (
                <div
                  key={mail.id}
                  className="bg-white/80 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex flex-col gap-2.5 shadow-2xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold ${statusColor}`}>
                        {statusLabel}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-sm sm:text-base font-bold text-slate-900">
                        {mail.subject}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0 tabular-nums">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {mail.sentAt
                          ? `Sent ${formatActivityTimestamp(mail.sentAt)}`
                          : `Queued ${formatActivityTimestamp(mail.createdAt)}`}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                    <span>
                      To: <strong className="text-slate-800">{mail.recipientName}</strong> ({mail.recipientEmail})
                    </span>
                    {mail.siteName && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span>Site: {mail.siteName}</span>
                      </>
                    )}
                  </div>

                  <div className="bg-slate-50/90 rounded-xl border border-slate-200/80 p-3 text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {mail.body}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* 6. ACTIVITY LOG SECTION */}
      {/* =================================================================== */}
      <section className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Activity log
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Actions approved by you and results reported by the agent at this site, newest first.
            </p>
          </div>
          {items.length > 0 && (
            <span className="text-xs font-medium text-slate-600 tabular-nums">
              {items.length} {items.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        {loading && items.length === 0 ? (
          <div className="bg-white/75 rounded-2xl border border-black/[0.06] p-8 flex flex-col items-center justify-center text-center">
            <div className="w-8 h-8 rounded-full border-2 border-teal-500 border-t-transparent animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-600">
              Loading activity log for {siteName}...
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white/75 rounded-2xl border border-black/[0.06] p-6 flex items-center gap-3 shadow-2xs">
            <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-medium text-slate-600">
              No activity recorded for this site yet.
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => {
              const isAgent = item.actorType === 'agent';
              return (
                <div
                  key={item.id}
                  className="bg-white/80 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${
                        isAgent
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-sky-50 text-sky-700 border-sky-200'
                      }`}
                    >
                      {isAgent ? (
                        <Cpu className="w-4 h-4" />
                      ) : (
                        <UserCheck className="w-4 h-4" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-semibold ${
                            isAgent ? 'text-emerald-800' : 'text-sky-800'
                          }`}
                        >
                          {isAgent ? 'Agent' : 'You'}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-sm sm:text-base font-bold text-slate-900">
                          {item.plainText}
                        </span>
                      </div>

                      {item.subText && (
                        <p className="text-xs sm:text-sm text-slate-600">
                          {item.subText}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-1.5 text-xs text-slate-500 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/[0.05] tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{formatActivityTimestamp(item.createdAt)}</span>
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Simulated in this prototype
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
