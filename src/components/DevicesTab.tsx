import React, { useState, useEffect, useCallback } from 'react';
import { Laptop, RefreshCw } from 'lucide-react';

interface DeviceItem {
  id: string;
  siteId: string;
  name: string;
  hostname: string | null;
  ip: string;
  mac: string;
  vendor: string;
  online: boolean;
  isKnown: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  isNew: boolean;
}

interface DevicesResponse {
  siteId: string;
  summary: {
    total: number;
    online: number;
    offline: number;
  };
  devices: DeviceItem[];
  lastEvaluatedAt: string;
}

type FilterStatus = 'all' | 'online' | 'offline';

interface DevicesTabProps {
  siteId: string;
  siteName: string;
}

function formatRelativeTime(isoDate: string): string {
  const targetMs = new Date(isoDate).getTime();
  if (isNaN(targetMs)) return 'Unknown';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - targetMs) / 1000));

  if (diffSeconds < 45) {
    return 'Just now';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
}

export const DevicesTab: React.FC<DevicesTabProps> = ({ siteId, siteName }) => {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [, setTick] = useState<number>(0);

  const fetchDevices = useCallback(async (silent = false) => {
    if (!siteId) return;
    if (!silent) setLoading(true);
    else setIsRefreshing(true);

    try {
      const res = await fetch(`/api/sites/${siteId}/devices`);
      if (res.ok) {
        const json: DevicesResponse = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch devices:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchDevices(false);

    const pollInterval = setInterval(() => {
      fetchDevices(true);
    }, 30000); // Refresh every 30 seconds without reloading the page

    const relativeTickInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 15000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(relativeTickInterval);
    };
  }, [fetchDevices]);

  if (loading && !data) {
    return (
      <div className="glass-panel p-10 flex-1 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-600">Loading devices for {siteName}...</p>
      </div>
    );
  }

  const allDevices = data?.devices ?? [];
  const totalCount = data?.summary?.total ?? allDevices.length;
  const onlineCount = data?.summary?.online ?? allDevices.filter((d) => d.online).length;
  const offlineCount = data?.summary?.offline ?? totalCount - onlineCount;

  // Ensure offline first, then alphabetical by name
  const sortedDevices = [...allDevices].sort((a, b) => {
    if (a.online !== b.online) {
      return a.online ? 1 : -1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const filteredDevices = sortedDevices.filter((d) => {
    if (filter === 'online') return d.online;
    if (filter === 'offline') return !d.online;
    return true;
  });

  const renderStatusPill = (online: boolean) => {
    if (online) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Online</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        <span>Offline</span>
      </span>
    );
  };

  return (
    <div className="glass-panel p-6 sm:p-8 flex-1 overflow-y-auto space-y-6">
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
            Devices
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Computers, printers, phones, and equipment connected to this site's network.
          </p>
        </div>

        <button
          onClick={() => fetchDevices(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 bg-white/60 hover:bg-white border border-slate-200 shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 cursor-pointer"
          title="Refresh device list"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-teal-600' : 'text-slate-400'}`} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh now'}</span>
        </button>
      </div>

      {/* Empty state if site has no devices yet */}
      {totalCount === 0 ? (
        <div
          className="rounded-[24px] p-10 sm:p-16 flex flex-col items-center justify-center text-center"
          style={{
            border: '2px dashed rgba(0, 0, 0, 0.08)',
            background: 'rgba(255, 255, 255, 0.2)',
          }}
        >
          <div
            className="w-16 h-16 rounded-[20px] bg-white flex items-center justify-center mb-5 shadow-xs"
            style={{
              color: 'var(--accent-ocean)',
              boxShadow: '0 10px 20px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Laptop className="w-8 h-8" strokeWidth={2} />
          </div>
          <p className="text-sm sm:text-base font-medium text-slate-700 max-w-md leading-relaxed">
            No devices yet. Once the SignalBloom agent is running at this site, devices appear here within a few minutes.
          </p>
        </div>
      ) : (
        <>
          {/* Summary row and filter buttons */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white/60 border border-black/[0.06] rounded-2xl p-4 shadow-2xs">
            <div className="text-sm sm:text-base font-semibold text-slate-800">
              {totalCount} {totalCount === 1 ? 'device' : 'devices'} · {onlineCount} online · {offlineCount} offline
            </div>

            {/* Filter buttons: All, Online, Offline */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/70">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'online', label: 'Online' },
                  { id: 'offline', label: 'Offline' },
                ] as { id: FilterStatus; label: string }[]
              ).map((btn) => {
                const active = filter === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setFilter(btn.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      active
                        ? 'text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                    style={
                      active
                        ? {
                            background: 'var(--gradient)',
                          }
                        : undefined
                    }
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </div>

          {filteredDevices.length === 0 ? (
            <div className="bg-white/60 rounded-2xl border border-black/[0.06] p-10 text-center text-sm text-slate-500">
              No {filter} devices at this site right now.
            </div>
          ) : (
            <>
              {/* Desktop & Laptop Table View */}
              <div className="hidden md:block bg-white/75 rounded-2xl border border-black/[0.06] shadow-2xs overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500">
                      <th className="py-3.5 px-5">Name</th>
                      <th className="py-3.5 px-5">IP address</th>
                      <th className="py-3.5 px-5">MAC address</th>
                      <th className="py-3.5 px-5">Status</th>
                      <th className="py-3.5 px-5">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 text-sm">
                    {filteredDevices.map((device) => (
                      <tr
                        key={device.id}
                        className="hover:bg-white transition-colors"
                      >
                        <td className="py-3.5 px-5 font-medium text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{device.name || 'Unknown device'}</span>
                            {device.isNew && (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                style={{
                                  background: 'rgba(0, 128, 208, 0.1)',
                                  color: 'var(--accent-ocean)',
                                  border: '1px solid rgba(0, 128, 208, 0.2)',
                                }}
                              >
                                New
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-5 text-slate-700">
                          {device.ip}
                        </td>
                        <td className="py-3.5 px-5 text-slate-600">
                          {device.mac}
                        </td>
                        <td className="py-3.5 px-5">
                          {renderStatusPill(device.online)}
                        </td>
                        <td className="py-3.5 px-5 text-slate-600">
                          {formatRelativeTime(device.lastSeenAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone Card View */}
              <div className="md:hidden grid grid-cols-1 gap-3">
                {filteredDevices.map((device) => (
                  <div
                    key={device.id}
                    className="bg-white/80 rounded-2xl border border-black/[0.06] p-4 shadow-2xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900">
                          {device.name || 'Unknown device'}
                        </span>
                        {device.isNew && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                            style={{
                              background: 'rgba(0, 128, 208, 0.1)',
                              color: 'var(--accent-ocean)',
                              border: '1px solid rgba(0, 128, 208, 0.2)',
                            }}
                          >
                            New
                          </span>
                        )}
                      </div>
                      {renderStatusPill(device.online)}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-100">
                      <div>
                        <span className="text-slate-400 block">IP address</span>
                        <span className="text-slate-700 font-medium">{device.ip}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">MAC address</span>
                        <span className="text-slate-700 font-medium">{device.mac}</span>
                      </div>
                      <div className="col-span-2 pt-1">
                        <span className="text-slate-400">Last seen: </span>
                        <span className="text-slate-700 font-medium">
                          {formatRelativeTime(device.lastSeenAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
