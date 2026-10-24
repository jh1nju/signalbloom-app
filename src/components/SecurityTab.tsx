import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Clock,
  Repeat,
  RefreshCw,
} from 'lucide-react';
import { AlertAiSection, AlertItem, formatAlertDuration } from './NetworkHealthTab';
import { authFetch } from '../firebase';

interface AlertsResponse {
  siteId: string;
  activeHealthAlerts: AlertItem[];
  activeSecurityAlerts: AlertItem[];
  resolvedSecurityAlerts: AlertItem[];
  lastEvaluatedAt: string;
}

interface SecurityTabProps {
  siteId: string;
  siteName: string;
  userRole?: 'admin' | 'staff';
}

function formatRelativeAgo(isoDate: string): string {
  const targetMs = new Date(isoDate).getTime();
  if (isNaN(targetMs)) return 'Recently';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - targetMs) / 1000));
  if (diffSeconds < 60) return 'Just now';

  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export const SecurityTab: React.FC<SecurityTabProps> = ({
  siteId,
  siteName,
  userRole = 'admin',
}) => {
  const [activeAlerts, setActiveAlerts] = useState<AlertItem[]>([]);
  const [resolvedAlerts, setResolvedAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchSecurityAlerts = useCallback(async (silent = false) => {
    if (!siteId) return;
    if (!silent) setLoading(true);
    else setIsRefreshing(true);

    try {
      const res = await authFetch(`/api/sites/${encodeURIComponent(siteId)}/alerts`).catch(() => null);
      if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const json: AlertsResponse | null = await res.json().catch(() => null);
        if (json) {
          setActiveAlerts(json.activeSecurityAlerts ?? []);
          setResolvedAlerts(json.resolvedSecurityAlerts ?? []);
        }
      }
    } catch {
      // Ignore transient network errors during dev server restarts
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchSecurityAlerts(false);

    const interval = setInterval(() => {
      fetchSecurityAlerts(true);
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [fetchSecurityAlerts]);

  if (loading && activeAlerts.length === 0 && resolvedAlerts.length === 0) {
    return (
      <div className="glass-panel p-10 flex-1 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-600">Loading security alerts for {siteName}...</p>
      </div>
    );
  }

  const sortedActive = [...activeAlerts].sort((a, b) => {
    const rank = (s: string) => (s === 'critical' ? 0 : s === 'warning' ? 1 : 2);
    return rank(a.severity) - rank(b.severity);
  });

  return (
    <div className="glass-panel p-6 sm:p-8 flex-1 overflow-y-auto space-y-8">
      {/* Top context header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.05]">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: 'rgba(19, 232, 152, 0.1)',
                color: 'var(--success)',
                border: '1px solid rgba(19, 232, 152, 0.2)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-mint)' }} />
              <span>Active location: {siteName}</span>
            </span>
            <span className="text-[11px] text-slate-500">
              Auto-refreshes every 30s
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-2">
            Security
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Unknown device alerts and recent security events at this site.
          </p>
        </div>

        <button
          onClick={() => fetchSecurityAlerts(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 bg-white/60 hover:bg-white border border-slate-200 shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 cursor-pointer"
          title="Refresh security alerts"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-teal-600' : 'text-slate-400'}`} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh now'}</span>
        </button>
      </div>

      {/* Active security alerts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Active alerts
          </h2>
          {sortedActive.length > 0 && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              {sortedActive.length} active
            </span>
          )}
        </div>

        {sortedActive.length === 0 ? (
          <div className="bg-white/75 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex items-center gap-3 shadow-2xs">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200/70 flex items-center justify-center text-emerald-600 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-medium text-slate-700">
              No problems right now
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {sortedActive.map((alert) => {
              const isCritical = alert.severity === 'critical';
              return (
                <div
                  key={alert.id}
                  className={`rounded-2xl border p-4 sm:p-5 transition-all shadow-2xs ${
                    isCritical
                      ? 'bg-rose-50/75 border-rose-200/90'
                      : 'bg-amber-50/75 border-amber-200/90'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          isCritical
                            ? 'bg-rose-100 text-rose-700 border border-rose-200'
                            : 'bg-amber-100 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {isCritical ? (
                          <AlertOctagon className="w-5 h-5" />
                        ) : (
                          <AlertTriangle className="w-5 h-5" />
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                              isCritical
                                ? 'bg-rose-600 text-white border-rose-700'
                                : 'bg-amber-500 text-white border-amber-600'
                            }`}
                          >
                            {isCritical ? 'Critical' : 'Warning'}
                          </span>
                          <h3 className="text-sm sm:text-base font-bold text-slate-900">
                            {alert.title}
                          </h3>
                        </div>

                        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                          {alert.reason}
                        </p>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-2 text-xs text-slate-600 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/[0.06]">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Happening for {formatAlertDuration(alert.firstSeenAt)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/80 border border-black/[0.08] font-semibold text-slate-700">
                        <Repeat className="w-3 h-3 text-slate-400" />
                        <span>
                          {alert.occurrenceCount}{' '}
                          {alert.occurrenceCount === 1 ? 'time' : 'times'}
                        </span>
                      </span>
                    </div>
                  </div>

                  <AlertAiSection alert={alert} userRole={userRole} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resolved alerts from the last 7 days */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Resolved in the last 7 days
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Previous security alerts at this site that have been resolved.
            </p>
          </div>
        </div>

        {resolvedAlerts.length === 0 ? (
          <div className="bg-white/60 rounded-2xl border border-black/[0.06] p-6 text-center text-sm text-slate-500">
            No resolved security alerts in the last 7 days.
          </div>
        ) : (
          <div className="space-y-2.5">
            {resolvedAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-white/70 rounded-2xl border border-black/[0.06] p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs"
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0 mt-0.5">
                    <ShieldCheck className="w-5 h-5" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        Resolved
                      </span>
                      <h3 className="text-sm sm:text-base font-semibold text-slate-800">
                        {alert.title}
                      </h3>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                      {alert.reason}
                    </p>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-2 text-xs text-slate-500 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/[0.06]">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      Resolved {formatRelativeAgo(alert.lastSeenAt)} (lasted{' '}
                      {formatAlertDuration(alert.firstSeenAt, alert.lastSeenAt)})
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 font-medium text-slate-600">
                    <Repeat className="w-3 h-3 text-slate-400" />
                    <span>
                      {alert.occurrenceCount}{' '}
                      {alert.occurrenceCount === 1 ? 'time' : 'times'}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
