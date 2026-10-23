import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  RefreshCw,
  UserCheck,
  Cpu,
  FileText,
  CheckCircle2,
} from 'lucide-react';

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

interface AccountSettingsTabProps {
  siteId: string;
  siteName: string;
  organisationName: string;
}

function formatActivityTimestamp(isoDate: string): string {
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

export const AccountSettingsTab: React.FC<AccountSettingsTabProps> = ({
  siteId,
  siteName,
  organisationName,
}) => {
  const [items, setItems] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchActivityLog = useCallback(
    async (silent = false) => {
      if (!siteId) return;
      if (!silent) setLoading(true);
      else setIsRefreshing(true);

      try {
        const res = await fetch(
          `/api/sites/${encodeURIComponent(siteId)}/activity-log`
        ).catch(() => null);
        if (
          res &&
          res.ok &&
          (res.headers.get('content-type') || '').includes('application/json')
        ) {
          const json: ActivityLogResponse | null = await res.json().catch(() => null);
          if (json && Array.isArray(json.items)) {
            setItems(json.items);
          }
        }
      } catch {
        // Ignore transient network errors
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [siteId]
  );

  useEffect(() => {
    setItems([]);
    fetchActivityLog(false);
  }, [fetchActivityLog]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchActivityLog(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchActivityLog]);

  return (
    <div className="glass-panel p-6 sm:p-8 flex-1 overflow-y-auto space-y-8">
      {/* Top context header (sentence case) */}
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
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--accent-mint)' }}
              />
              <span>Active location: {siteName}</span>
            </span>
            <span className="text-[11px] text-slate-500">
              Organisation: {organisationName}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-2">
            Account &amp; settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Activity log and site actions recorded for {siteName}.
          </p>
        </div>

        <button
          onClick={() => fetchActivityLog(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 bg-white/60 hover:bg-white border border-slate-200 shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 cursor-pointer"
          title="Refresh activity log"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              isRefreshing ? 'animate-spin text-teal-600' : 'text-slate-400'
            }`}
          />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh now'}</span>
        </button>
      </div>

      {/* Activity log section */}
      <div className="space-y-4">
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
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
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
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                            isAgent
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-sky-50 text-sky-800 border-sky-200'
                          }`}
                        >
                          {isAgent ? 'Agent' : 'You'}
                        </span>
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

                  <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-1.5 text-xs text-slate-500 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/[0.05]">
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
      </div>
    </div>
  );
};
