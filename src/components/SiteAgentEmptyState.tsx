import React, { useState, useEffect } from 'react';
import { PlugZap, KeyRound, Radio } from 'lucide-react';
import { authFetch } from '../firebase';

interface SiteAgentEmptyStateProps {
  siteId: string;
  hasRegisteredAgent: boolean;
  hasReadings: boolean;
  setupCode: string | null;
  setupCodeExpiresAt?: string | null;
  onCodeCreated?: (newCode: string, expiresAt: string) => void;
  userRole?: 'admin' | 'staff';
}

export const SiteAgentEmptyState: React.FC<SiteAgentEmptyStateProps> = ({
  siteId,
  hasRegisteredAgent,
  hasReadings,
  setupCode,
  setupCodeExpiresAt,
  onCodeCreated,
  userRole = 'admin',
}) => {
  const isAdmin = userRole === 'admin';
  const [localCode, setLocalCode] = useState<string | null>(setupCode);
  const [localExpiresAt, setLocalExpiresAt] = useState<string | null>(setupCodeExpiresAt ?? null);
  const [creatingCode, setCreatingCode] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setLocalCode(setupCode);
    setLocalExpiresAt(setupCodeExpiresAt ?? null);
    setErrorMessage(null);
  }, [siteId, setupCode, setupCodeExpiresAt]);

  const isCodeValid = Boolean(
    localCode && (!localExpiresAt || new Date(localExpiresAt).getTime() > Date.now())
  );

  const handleCreateSetupCode = async () => {
    if (!siteId || creatingCode || !isAdmin) return;
    setCreatingCode(true);
    setErrorMessage(null);

    try {
      const res = await authFetch(`/api/sites/${encodeURIComponent(siteId)}/setup-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const json = await res.json();
        if (json?.code) {
          setLocalCode(json.code);
          setLocalExpiresAt(json.expiresAt ?? null);
          onCodeCreated?.(json.code, json.expiresAt);
        }
      } else {
        setErrorMessage('Could not create a new setup code. Please try again.');
      }
    } catch {
      setErrorMessage('Could not create a new setup code. Please try again.');
    } finally {
      setCreatingCode(false);
    }
  };

  // State 2: Agent is registered, but no readings have arrived yet
  if (hasRegisteredAgent && !hasReadings) {
    return (
      <div className="bg-white/80 rounded-3xl border border-black/[0.06] p-8 sm:p-12 shadow-2xs flex flex-col items-center justify-center text-center space-y-4">
        <div
          className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center shadow-2xs"
          style={{ color: 'var(--success)' }}
        >
          <Radio className="w-7 h-7 animate-pulse" strokeWidth={2} />
        </div>
        <p className="text-base sm:text-lg font-bold text-slate-900">
          Agent connected. Waiting for the first readings...
        </p>
        <p className="text-xs sm:text-sm text-slate-500 max-w-md leading-relaxed">
          Checking automatically every 10 seconds. Your network health score and connected devices will appear here shortly.
        </p>
      </div>
    );
  }

  // State 1: No registered agent at this site
  return (
    <div className="bg-white/80 rounded-3xl border border-black/[0.06] p-6 sm:p-8 shadow-2xs space-y-6">
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center shrink-0 shadow-2xs"
          style={{ color: 'var(--accent-ocean)' }}
        >
          <PlugZap className="w-6 h-6" strokeWidth={2} />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Connect this site
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Follow these steps to pair the SignalBloom agent and start monitoring this location.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="bg-white/90 rounded-2xl border border-black/[0.06] p-4 sm:p-5 text-sm sm:text-base text-slate-800 font-medium leading-relaxed">
          1) Install the SignalBloom agent on a computer that stays on at this site.
        </div>

        <div className="bg-white/90 rounded-2xl border border-black/[0.06] p-4 sm:p-5 space-y-3">
          {isAdmin ? (
            <>
              <div className="text-sm sm:text-base text-slate-800 font-medium leading-relaxed flex flex-wrap items-center gap-2">
                <span>
                  2) Enter this setup code:{' '}
                  {isCodeValid && localCode ? (
                    <>
                      <code
                        className="font-mono font-bold px-2.5 py-1 rounded-lg text-sm sm:text-base border"
                        style={{
                          background: 'rgba(0, 128, 208, 0.08)',
                          color: 'var(--accent-ocean)',
                          borderColor: 'rgba(0, 128, 208, 0.2)',
                        }}
                      >
                        {localCode}
                      </code>
                      .
                    </>
                  ) : (
                    <span className="text-slate-500 font-normal">No valid setup code.</span>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCreateSetupCode}
                  disabled={creatingCode}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer disabled:opacity-50 shadow-2xs"
                  style={
                    !isCodeValid
                      ? {
                          background: 'var(--accent-blue)',
                          color: 'white',
                        }
                      : {
                          background: 'rgba(0, 128, 208, 0.08)',
                          color: 'var(--accent-ocean)',
                          border: '1px solid rgba(0, 128, 208, 0.2)',
                        }
                  }
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{creatingCode ? 'Creating setup code...' : 'Create new setup code'}</span>
                </button>
                <span className="text-xs text-slate-500">Valid for 24 hours</span>
              </div>

              {errorMessage && (
                <p className="text-xs text-rose-600 font-medium">{errorMessage}</p>
              )}
            </>
          ) : (
            <div className="text-sm sm:text-base text-slate-800 font-medium leading-relaxed">
              2) Ask an admin to enter this site&apos;s setup code.
            </div>
          )}
        </div>

        <div className="bg-white/90 rounded-2xl border border-black/[0.06] p-4 sm:p-5 text-sm sm:text-base text-slate-800 font-medium leading-relaxed">
          3) Your network health appears here within a minute.
        </div>
      </div>
    </div>
  );
};
