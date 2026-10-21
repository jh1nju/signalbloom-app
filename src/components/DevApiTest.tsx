import React, { useState, useEffect } from 'react';
import { 
  Play, 
  CheckCircle2, 
  XCircle, 
  Terminal, 
  Key, 
  Activity, 
  ShieldAlert, 
  ArrowRight, 
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';

interface TestResult {
  title: string;
  endpoint: string;
  method: string;
  statusCode?: number;
  statusText?: string;
  responseJson?: any;
  error?: string;
  timeMs?: number;
}

export const DevApiTest: React.FC = () => {
  // Production guard
  const isProd = import.meta.env.PROD || process.env.NODE_ENV === 'production';
  if (isProd) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-200">404 - Not Found</h1>
          <p className="text-xs text-slate-500 mt-2">This page is not available in production environments.</p>
        </div>
      </div>
    );
  }

  const [setupCode, setSetupCode] = useState('SB-PPT-FPFF');
  const [availableCodes, setAvailableCodes] = useState<string[]>([]);
  const [siteToken, setSiteToken] = useState<string>('');
  const [siteId, setSiteId] = useState<string>('');

  // Results for tests
  const [test1Result, setTest1Result] = useState<TestResult | null>(null);
  const [test2Result1, setTest2Result1] = useState<TestResult | null>(null);
  const [test2Result2, setTest2Result2] = useState<TestResult | null>(null);
  const [test3Result, setTest3Result] = useState<TestResult | null>(null);

  const [isLoading1, setIsLoading1] = useState(false);
  const [isLoading2, setIsLoading2] = useState(false);
  const [isLoading3, setIsLoading3] = useState(false);

  // Fetch available seed setup codes
  const loadAvailableCodes = async () => {
    try {
      const res = await fetch('/api/dev/available-codes');
      if (res.ok) {
        const data = await res.json();
        if (data.codes && data.codes.length > 0) {
          const list = data.codes.map((c: any) => c.code);
          setAvailableCodes(list);
          if (!list.includes(setupCode)) {
            setSetupCode(list[0]);
          }
        }
      }
    } catch (e) {
      console.warn('Could not load available codes:', e);
    }
  };

  useEffect(() => {
    loadAvailableCodes();
  }, []);

  // -------------------------------------------------------------------------
  // Test 1: Register with a seed setup code
  // -------------------------------------------------------------------------
  const runTest1 = async () => {
    setIsLoading1(true);
    setTest1Result(null);
    const start = performance.now();

    try {
      const payload = {
        setup_code: setupCode.trim(),
        agent_version: '0.1.0',
        hostname: 'clinic-laptop-01',
      };

      const res = await fetch('/api/agent/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      const timeMs = Math.round(performance.now() - start);

      setTest1Result({
        title: 'Test 1: Register Agent',
        endpoint: '/api/agent/register',
        method: 'POST',
        statusCode: res.status,
        statusText: res.statusText,
        responseJson: data,
        timeMs,
      });

      if (res.ok && data.site_token) {
        setSiteToken(data.site_token);
        setSiteId(data.site_id);
      }
      loadAvailableCodes();
    } catch (err: any) {
      setTest1Result({
        title: 'Test 1: Register Agent',
        endpoint: '/api/agent/register',
        method: 'POST',
        error: err.message,
      });
    } finally {
      setIsLoading1(false);
    }
  };

  // -------------------------------------------------------------------------
  // Test 2: Send one reading, then send it again (duplicate detection)
  // -------------------------------------------------------------------------
  const runTest2 = async () => {
    setIsLoading2(true);
    setTest2Result1(null);
    setTest2Result2(null);

    const tokenToUse = siteToken || 'sbt_live_placeholder_token_please_run_test_1_first';
    const siteIdToUse = siteId || '00000000-0000-0000-0000-000000000000';
    const fixedTimestamp = new Date().toISOString();

    const readingPayload = {
      site_id: siteIdToUse,
      sent_at: fixedTimestamp,
      readings: [
        {
          measured_at: fixedTimestamp,
          latency_ms: 24.5,
          packet_loss_pct: 0.0,
          internet_up: true,
          download_mbps: 112.4,
          upload_mbps: 42.1,
          error_rate_pct: 0.0,
        },
      ],
      devices: [
        {
          mac: 'aa:bb:cc:dd:ee:01',
          ip: '192.168.1.20',
          hostname: 'reception-pc',
          vendor: 'Dell',
          online: true,
        },
      ],
    };

    // First Call: Expect accepted: 1, duplicates: 0
    try {
      const start1 = performance.now();
      const res1 = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenToUse}`,
        },
        body: JSON.stringify(readingPayload),
      });
      const data1 = await res1.json();
      const timeMs1 = Math.round(performance.now() - start1);

      setTest2Result1({
        title: 'Test 2a: Send First Reading',
        endpoint: '/api/ingest',
        method: 'POST',
        statusCode: res1.status,
        statusText: res1.statusText,
        responseJson: data1,
        timeMs: timeMs1,
      });

      // Second Call: Send identical measured_at reading to test duplicate handling
      const start2 = performance.now();
      const res2 = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenToUse}`,
        },
        body: JSON.stringify(readingPayload),
      });
      const data2 = await res2.json();
      const timeMs2 = Math.round(performance.now() - start2);

      setTest2Result2({
        title: 'Test 2b: Send Same Reading Again (Duplicate Check)',
        endpoint: '/api/ingest',
        method: 'POST',
        statusCode: res2.status,
        statusText: res2.statusText,
        responseJson: data2,
        timeMs: timeMs2,
      });
    } catch (err: any) {
      setTest2Result1({
        title: 'Test 2: Send Readings',
        endpoint: '/api/ingest',
        method: 'POST',
        error: err.message,
      });
    } finally {
      setIsLoading2(false);
    }
  };

  // -------------------------------------------------------------------------
  // Test 3: Wrong token
  // -------------------------------------------------------------------------
  const runTest3 = async () => {
    setIsLoading3(true);
    setTest3Result(null);
    const start = performance.now();

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid_wrong_token_12345',
        },
        body: JSON.stringify({
          site_id: 'any-site-id',
          sent_at: new Date().toISOString(),
          readings: [],
          devices: [],
        }),
      });

      const data = await res.json();
      const timeMs = Math.round(performance.now() - start);

      setTest3Result({
        title: 'Test 3: Wrong Token',
        endpoint: '/api/ingest',
        method: 'POST',
        statusCode: res.status,
        statusText: res.statusText,
        responseJson: data,
        timeMs,
      });
    } catch (err: any) {
      setTest3Result({
        title: 'Test 3: Wrong Token',
        endpoint: '/api/ingest',
        method: 'POST',
        error: err.message,
      });
    } finally {
      setIsLoading3(false);
    }
  };

  const getStatusBadge = (code?: number) => {
    if (!code) return null;
    let color = 'bg-slate-800 text-slate-300 border-slate-700';
    if (code >= 200 && code < 300) color = 'bg-emerald-950/80 text-emerald-300 border-emerald-700';
    else if (code === 401 || code === 403 || code === 410) color = 'bg-amber-950/80 text-amber-300 border-amber-700';
    else if (code >= 400) color = 'bg-rose-950/80 text-rose-300 border-rose-700';

    return (
      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md border ${color}`}>
        HTTP {code}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-400">
                <Terminal className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-white">
                SignalBloom Agent API Test Suite
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800 font-bold">
                DEV ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Test endpoints defined in <code className="text-emerald-400 font-mono">docs/API.md</code> using relative URLs.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/"
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors"
            >
              ← Back to App
            </a>
          </div>
        </div>

        {/* Current State Indicator */}
        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-4 text-xs font-mono flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Active Token:</span>
            {siteToken ? (
              <span className="text-emerald-400 font-bold truncate max-w-[280px]" title={siteToken}>
                {siteToken.slice(0, 22)}...
              </span>
            ) : (
              <span className="text-amber-400/80 italic">None (Run Test 1 to obtain)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Site ID:</span>
            <span className="text-slate-300">{siteId || 'Not set'}</span>
          </div>
        </div>

        {/* ================================================================= */}
        {/* TEST 1 CARD */}
        {/* ================================================================= */}
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold flex items-center justify-center">
                  1
                </span>
                <h3 className="text-sm font-bold text-slate-100">
                  Test 1: Register with Seed Setup Code
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Calls <code className="text-emerald-300 font-mono">POST /api/agent/register</code>. Verifies code, marks it used, and returns plain token.
              </p>
            </div>

            <button
              onClick={runTest1}
              disabled={isLoading1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all disabled:opacity-50 shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isLoading1 ? 'Running...' : 'Run Test 1'}</span>
            </button>
          </div>

          {/* Setup Code selection */}
          <div className="flex items-center gap-2 text-xs flex-wrap pt-2 border-t border-slate-800/60">
            <span className="text-slate-400 font-medium">Setup Code:</span>
            <input
              type="text"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
              placeholder="e.g. SB-PPT-FPFF"
            />
            {availableCodes.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>Available:</span>
                {availableCodes.map((code) => (
                  <button
                    key={code}
                    onClick={() => setSetupCode(code)}
                    className="font-mono text-emerald-400/80 hover:text-emerald-300 underline"
                  >
                    {code}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Result Output */}
          {test1Result && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-slate-400">
                  {test1Result.method} {test1Result.endpoint} ({test1Result.timeMs}ms)
                </span>
                {getStatusBadge(test1Result.statusCode)}
              </div>
              <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
                {JSON.stringify(test1Result.responseJson || { error: test1Result.error }, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* TEST 2 CARD */}
        {/* ================================================================= */}
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-mono font-bold flex items-center justify-center">
                  2
                </span>
                <h3 className="text-sm font-bold text-slate-100">
                  Test 2: Send One Reading, Then Send It Again
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Calls <code className="text-cyan-300 font-mono">POST /api/ingest</code> with 1 reading, then sends the identical reading again to verify duplicate detection.
              </p>
            </div>

            <button
              onClick={runTest2}
              disabled={isLoading2}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all disabled:opacity-50 shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isLoading2 ? 'Running...' : 'Run Test 2'}</span>
            </button>
          </div>

          {/* Results: First Call & Duplicate Call */}
          {(test2Result1 || test2Result2) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              {/* Call 1 */}
              {test2Result1 && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300 font-mono">1st Ingest Call</span>
                    {getStatusBadge(test2Result1.statusCode)}
                  </div>
                  <pre className="text-xs font-mono text-emerald-300 overflow-x-auto">
                    {JSON.stringify(test2Result1.responseJson || { error: test2Result1.error }, null, 2)}
                  </pre>
                  <p className="text-[11px] text-slate-500 font-mono">Expected: accepted: 1, duplicates: 0</p>
                </div>
              )}

              {/* Call 2 */}
              {test2Result2 && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300 font-mono">2nd Duplicate Call</span>
                    {getStatusBadge(test2Result2.statusCode)}
                  </div>
                  <pre className="text-xs font-mono text-amber-300 overflow-x-auto">
                    {JSON.stringify(test2Result2.responseJson || { error: test2Result2.error }, null, 2)}
                  </pre>
                  <p className="text-[11px] text-slate-500 font-mono">Expected: accepted: 0, duplicates: 1</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* TEST 3 CARD */}
        {/* ================================================================= */}
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 text-xs font-mono font-bold flex items-center justify-center">
                  3
                </span>
                <h3 className="text-sm font-bold text-slate-100">
                  Test 3: Wrong Token (Unauthorized)
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Calls <code className="text-rose-300 font-mono">POST /api/ingest</code> with invalid header <code className="font-mono text-slate-400">Authorization: Bearer invalid_wrong_token_12345</code>.
              </p>
            </div>

            <button
              onClick={runTest3}
              disabled={isLoading3}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white transition-all disabled:opacity-50 shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isLoading3 ? 'Running...' : 'Run Test 3'}</span>
            </button>
          </div>

          {/* Result Output */}
          {test3Result && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-slate-400">
                  {test3Result.method} {test3Result.endpoint} ({test3Result.timeMs}ms)
                </span>
                {getStatusBadge(test3Result.statusCode)}
              </div>
              <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs font-mono text-rose-300 overflow-x-auto leading-relaxed">
                {JSON.stringify(test3Result.responseJson || { error: test3Result.error }, null, 2)}
              </pre>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
