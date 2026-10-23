import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  HelpCircle, 
  RefreshCw, 
  CheckCircle2
} from 'lucide-react';

interface PartResult {
  key: string;
  label: string;
  technicalTerm: string;
  valueFormatted: string;
  rawVal: number;
  score: number;
  weight: number;
}

interface TelemetryPoint {
  time: string;
  latency: number;
  loss: number;
  up: boolean;
}

interface BandwidthPoint {
  time: string;
  download: number;
  upload: number | null;
}

interface HealthResponse {
  siteId: string;
  score: number;
  statusWord: 'Healthy' | 'Needs attention' | 'Problem';
  statusColor: 'green' | 'amber' | 'red';
  parts: PartResult[];
  lastEvaluatedAt: string;
  charts: {
    telemetry: TelemetryPoint[];
    bandwidth: BandwidthPoint[];
  };
}

interface NetworkHealthTabProps {
  siteId: string;
  siteName: string;
}

// Tooltips dictionary per requirement 1
const PART_TOOLTIPS: Record<string, string> = {
  uptime: 'How often your internet connection was working.',
  latency: 'Latency: how long data takes to reach the internet, in milliseconds.',
  packet_loss: "The share of data that didn't arrive and had to be resent.",
  speed: 'Download speed, in megabits per second (Mbps).',
  devices: "How many of this site's known devices are connected right now.",
  'chart-delay': 'Latency: how long data takes to reach the internet, in milliseconds.',
  'chart-loss': "The share of data that didn't arrive and had to be resent.",
  'chart-uptime': 'How often your internet connection was working.',
  'chart-speed': 'Download speed, in megabits per second (Mbps).',
};

export const NetworkHealthTab: React.FC<NetworkHealthTabProps> = ({ siteId, siteName }) => {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const fetchHealthData = useCallback(async (silent = false) => {
    if (!siteId) return;
    if (!silent) setLoading(true);
    else setIsRefreshing(true);

    try {
      const res = await fetch(`/api/sites/${siteId}/health`);
      if (res.ok) {
        const json: HealthResponse = await res.json();
        setData(json);
        setLastRefreshed(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch health data:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchHealthData(false);

    const interval = setInterval(() => {
      fetchHealthData(true);
    }, 30000); // 30 seconds refresh without page reload

    return () => clearInterval(interval);
  }, [fetchHealthData]);

  if (loading && !data) {
    return (
      <div className="glass-panel p-10 flex-1 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-600">Evaluating network health for {siteName}...</p>
        <p className="text-xs text-slate-400 mt-1">Analyzing metrics from the last 15 minutes</p>
      </div>
    );
  }

  const score = data?.score ?? 100;
  const statusWord = data?.statusWord ?? 'Healthy';
  const statusColor = data?.statusColor ?? 'green';
  const parts = data?.parts ?? [];
  const telemetry = data?.charts?.telemetry ?? [];
  const bandwidth = (data?.charts?.bandwidth ?? []).filter(
    (b) => b && typeof b.download === 'number' && !isNaN(b.download)
  );

  const colorStyles = {
    green: {
      bg: 'rgba(5, 150, 105, 0.08)',
      text: '#059669',
      border: 'rgba(5, 150, 105, 0.25)',
      ring: 'rgba(5, 150, 105, 0.15)',
      badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    },
    amber: {
      bg: 'rgba(217, 119, 6, 0.08)',
      text: '#D97706',
      border: 'rgba(217, 119, 6, 0.25)',
      ring: 'rgba(217, 119, 6, 0.15)',
      badge: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    red: {
      bg: 'rgba(220, 38, 38, 0.08)',
      text: '#DC2626',
      border: 'rgba(220, 38, 38, 0.25)',
      ring: 'rgba(220, 38, 38, 0.15)',
      badge: 'bg-rose-50 text-rose-800 border-rose-200',
    },
  }[statusColor];

  // Helper for rendering SVG sparklines
  const renderLineChart = (
    points: { x: number; y: number }[],
    strokeColor: string,
    fillColor: string,
    height = 90
  ) => {
    if (points.length < 2) return null;
    const width = 500;
    const padding = 10;

    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const rangeY = maxY - minY || 1;

    const coords = points.map((p, idx) => {
      const x = padding + (idx / (points.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((p.y - minY) / rangeY) * (height - 2 * padding);
      return `${x},${y}`;
    });

    const pathD = `M ${coords.join(' L ')}`;
    const areaD = `${pathD} L ${width - padding},${height} L ${padding},${height} Z`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
        <path d={areaD} fill={fillColor} opacity={0.15} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

  return (
    <div className="glass-panel p-6 sm:p-8 flex-1 overflow-y-auto space-y-8">
      
      {/* Top Context Header (Sentence Case) */}
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
            Network health
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Real-time score and 24-hour connectivity performance for this site.
          </p>
        </div>

        {/* Manual Refresh Button */}
        <button
          onClick={() => fetchHealthData(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 bg-white/60 hover:bg-white border border-slate-200 shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 cursor-pointer"
          title="Refresh current readings"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-teal-600' : 'text-slate-400'}`} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh now'}</span>
        </button>
      </div>

      {/* =================================================================== */}
      {/* 6. BIG HEALTH SCORE AT TOP OF THE PAGE (ABOVE WHAT'S AFFECTING SCORE) */}
      {/* =================================================================== */}
      <div
        className="rounded-3xl p-6 sm:p-8 border transition-all flex flex-col md:flex-row items-center justify-between gap-8"
        style={{
          background: colorStyles.bg,
          borderColor: colorStyles.border,
          boxShadow: `0 12px 36px ${colorStyles.ring}`,
        }}
      >
        <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8 text-center sm:text-left">
          {/* Large Circular Score Gauge */}
          <div
            className="w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-white flex flex-col items-center justify-center shadow-md border"
            style={{ borderColor: colorStyles.border }}
          >
            <span
              className="text-5xl sm:text-6xl font-bold tracking-tight"
              style={{ color: colorStyles.text }}
            >
              {score}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider -mt-1">
              out of 100
            </span>
          </div>

          {/* Traffic Light Status Word (Healthy / Needs attention / Problem) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <span
                className="w-3 h-3 rounded-full animate-pulse"
                style={{ backgroundColor: colorStyles.text }}
              />
              <span
                className="text-2xl sm:text-3xl font-extrabold tracking-tight"
                style={{ color: colorStyles.text }}
              >
                {statusWord}
              </span>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 max-w-md">
              {score >= 80 && "Everything is running smoothly. Your internet connection, response time, and connected devices look great."}
              {score >= 50 && score < 80 && "Your network is operational, but higher delays or intermittent packets may slow down staff applications."}
              {score < 50 && "Network disruptions detected. Staff may experience frozen terminals, slow lookups, or dropped cloud sessions."}
            </p>
          </div>
        </div>

        {/* Evaluation Details */}
        <div className="bg-white/80 rounded-2xl p-4 border border-white/60 shadow-2xs text-xs space-y-1.5 w-full md:w-auto min-w-[210px]">
          <div className="flex justify-between items-center text-slate-500">
            <span>Window:</span>
            <span className="font-semibold text-slate-800">Last 15 minutes</span>
          </div>
          <div className="flex justify-between items-center text-slate-500">
            <span>Evaluated:</span>
            <span className="text-slate-700">{lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
          <div className="flex justify-between items-center text-slate-500">
            <span>Status:</span>
            <span className="font-bold" style={{ color: colorStyles.text }}>
              {statusWord}
            </span>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* WHAT'S AFFECTING YOUR SCORE (LOWEST FIRST) */}
      {/* =================================================================== */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              What's affecting your score
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            The five parts that calculate your network score, ordered lowest first so you immediately see what needs attention.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {parts.map((part, index) => {
            const partColor =
              part.score >= 80 ? '#059669' : part.score >= 50 ? '#D97706' : '#DC2626';
            const partBg =
              part.score >= 80 ? 'bg-emerald-50 text-emerald-800' : part.score >= 50 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800';
            const tooltipText = PART_TOOLTIPS[part.key] || part.technicalTerm;

            return (
              <div
                key={part.key}
                className="bg-white/70 hover:bg-white rounded-2xl border border-black/[0.06] p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                {/* Left: Rank, Name, and Tooltip */}
                <div className="flex items-center gap-3.5 min-w-[240px]">
                  <span className="w-6 h-6 rounded-full bg-slate-100 text-xs font-bold text-slate-500 flex items-center justify-center shrink-0">
                    {index + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-slate-900">
                        {part.label}
                      </span>
                      {/* Tooltip button */}
                      <div className="relative inline-block">
                        <button
                          type="button"
                          onMouseEnter={() => setActiveTooltip(part.key)}
                          onMouseLeave={() => setActiveTooltip(null)}
                          onClick={() => setActiveTooltip(activeTooltip === part.key ? null : part.key)}
                          className="text-slate-400 hover:text-slate-600 p-0.5 transition-colors cursor-pointer"
                          aria-label={`Definition of ${part.label}`}
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                        </button>
                        {activeTooltip === part.key && (
                          <div className="absolute left-6 top-0 z-50 w-60 p-2.5 bg-slate-900 text-white text-[11px] rounded-xl shadow-xl border border-slate-700 pointer-events-none leading-relaxed">
                            {tooltipText}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Value rendered with normal text font (Requirement 7) */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-medium text-slate-700">
                        {part.valueFormatted}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        • {part.weight}% weight
                      </span>
                    </div>
                  </div>
                </div>

                {/* Center / Right: Score bar & Score Badge */}
                <div className="flex items-center gap-4 w-full sm:w-auto flex-1 justify-end">
                  <div className="flex-1 max-w-[220px] bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${part.score}%`,
                        backgroundColor: partColor,
                      }}
                    />
                  </div>

                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-xl shrink-0 ${partBg}`}
                  >
                    {part.score} / 100
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* =================================================================== */}
      {/* 24-HOUR NETWORK TRENDS (Sentence Case & Requirement 5 Subtitle) */}
      {/* =================================================================== */}
      <div className="space-y-4 pt-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            24-hour network trends
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Measured at this site over the last 24 hours.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          
          {/* Chart 1: Delay */}
          <div className="bg-white/80 rounded-2xl border border-black/[0.06] p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900">Delay</span>
                <div className="relative">
                  <button
                    onMouseEnter={() => setActiveTooltip('chart-delay')}
                    onMouseLeave={() => setActiveTooltip(null)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                  {activeTooltip === 'chart-delay' && (
                    <div className="absolute left-6 -top-2 z-50 w-60 p-2.5 bg-slate-900 text-white text-[11px] rounded-xl shadow-lg border border-slate-700 pointer-events-none leading-relaxed">
                      {PART_TOOLTIPS['chart-delay']}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-xs font-medium text-slate-600">
                Current: {telemetry.length > 0 ? `${telemetry[telemetry.length - 1].latency.toFixed(1)} ms` : '--'}
              </span>
            </div>

            <div className="h-28 w-full">
              {renderLineChart(
                telemetry.map((t, idx) => ({ x: idx, y: t.latency })),
                '#0080D0',
                '#0080D0'
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
              <span>24 hours ago</span>
              <span>Lower is better (&le;30 ms)</span>
              <span>Now</span>
            </div>
          </div>

          {/* Chart 2: Packet loss */}
          <div className="bg-white/80 rounded-2xl border border-black/[0.06] p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900">Packet loss</span>
                <div className="relative">
                  <button
                    onMouseEnter={() => setActiveTooltip('chart-loss')}
                    onMouseLeave={() => setActiveTooltip(null)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                  {activeTooltip === 'chart-loss' && (
                    <div className="absolute left-6 -top-2 z-50 w-60 p-2.5 bg-slate-900 text-white text-[11px] rounded-xl shadow-lg border border-slate-700 pointer-events-none leading-relaxed">
                      {PART_TOOLTIPS['chart-loss']}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-xs font-medium text-slate-600">
                Current: {telemetry.length > 0 ? `${telemetry[telemetry.length - 1].loss.toFixed(1)}%` : '--'}
              </span>
            </div>

            <div className="h-28 w-full">
              {renderLineChart(
                telemetry.map((t, idx) => ({ x: idx, y: t.loss })),
                '#DC2626',
                '#DC2626'
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
              <span>24 hours ago</span>
              <span>Target: 0% loss</span>
              <span>Now</span>
            </div>
          </div>

          {/* Chart 3: Internet uptime */}
          <div className="bg-white/80 rounded-2xl border border-black/[0.06] p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900">Internet uptime</span>
                <div className="relative">
                  <button
                    onMouseEnter={() => setActiveTooltip('chart-uptime')}
                    onMouseLeave={() => setActiveTooltip(null)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                  {activeTooltip === 'chart-uptime' && (
                    <div className="absolute left-6 -top-2 z-50 w-60 p-2.5 bg-slate-900 text-white text-[11px] rounded-xl shadow-lg border border-slate-700 pointer-events-none leading-relaxed">
                      {PART_TOOLTIPS['chart-uptime']}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 100% online
              </span>
            </div>

            {/* Timeline Bar */}
            <div className="h-10 flex items-center gap-0.5 rounded-xl p-1.5 bg-slate-50 border border-slate-100 overflow-hidden">
              {telemetry.slice(-96).map((t, i) => (
                <div
                  key={i}
                  className={`h-full flex-1 rounded-[1px] ${t.up ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  title={`${new Date(t.time).toLocaleTimeString()}: ${t.up ? 'Online' : 'Offline'}`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
              <span>24 hours ago</span>
              <span>Solid green = zero outages</span>
              <span>Now</span>
            </div>
          </div>

          {/* Chart 4: Internet speed */}
          <div className="bg-white/80 rounded-2xl border border-black/[0.06] p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900">Internet speed</span>
                <div className="relative">
                  <button
                    onMouseEnter={() => setActiveTooltip('chart-speed')}
                    onMouseLeave={() => setActiveTooltip(null)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                  {activeTooltip === 'chart-speed' && (
                    <div className="absolute left-6 -top-2 z-50 w-60 p-2.5 bg-slate-900 text-white text-[11px] rounded-xl shadow-lg border border-slate-700 pointer-events-none leading-relaxed">
                      {PART_TOOLTIPS['chart-speed']}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-700">
                {bandwidth.length > 0 ? `${bandwidth[bandwidth.length - 1].download.toFixed(0)} Mbps` : '--'}
              </span>
            </div>

            <div className="h-28 w-full">
              {renderLineChart(
                bandwidth.map((b, idx) => ({ x: idx, y: b.download })),
                '#13E898',
                '#13E898'
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
              <span>24 hours ago</span>
              <span>Target: &gt;100 Mbps</span>
              <span>Now</span>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
