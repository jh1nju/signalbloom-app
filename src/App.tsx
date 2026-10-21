/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { testConnection, currentProjectId, currentDatabaseId } from './firebase';

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState<string>('Checking cloud connection...');
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    testConnection().then((res) => {
      setIsConnected(res.ok);
      setConnectionStatus(res.message);
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl backdrop-blur-sm">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-4">
          <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
        </div>

        <h1 className="text-xl font-bold tracking-tight text-white mb-2">
          SignalBloom
        </h1>
        <p className="text-xs text-slate-400 mb-6">
          Ready to build. Connected to cloud project:
        </p>

        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 text-left space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Project:</span>
            <span className="text-slate-200 font-semibold">{currentProjectId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Database:</span>
            <span className="text-slate-300 truncate max-w-[200px]" title={currentDatabaseId}>
              {currentDatabaseId}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-800">
            <span className="text-slate-500">Status:</span>
            <span className={`inline-flex items-center gap-1.5 font-medium ${isConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {isConnected ? 'Online' : 'Initializing'}
            </span>
          </div>
        </div>

        <div className="mt-6 text-[11px] text-slate-500">
          Clean slate ready. Standing by for instructions.
        </div>
      </div>
    </div>
  );
}
