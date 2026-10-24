import React, { useState } from 'react';
import { Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';
import { SignalBloomLogo } from './SignalBloomLogo';
import { AuthUserProfile, signInWithEmail } from '../firebase';

interface SignInPageProps {
  onSignedIn: (user: AuthUserProfile) => void;
}

export const SignInPage: React.FC<SignInPageProps> = ({ onSignedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || submitting) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const { user } = await signInWithEmail(email, password);
      onSignedIn(user);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Incorrect email or password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6">
      <div className="glass-panel w-full max-w-md p-6 sm:p-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-white/90 border border-black/[0.06] flex items-center justify-center shadow-xs">
            <SignalBloomLogo size={40} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Sign in to SignalBloom
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Enter your email address and password to view your network health.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-2xl bg-rose-50/90 border border-rose-200 px-4 py-3 flex items-center gap-2.5 text-xs sm:text-sm text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="signin-email"
              className="block text-xs font-semibold text-slate-700"
            >
              Email address
            </label>
            <div className="relative flex items-center">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
              <input
                id="signin-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@signalbloom.test"
                disabled={submitting}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/85 focus:bg-white border border-slate-200 focus:border-teal-600 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all shadow-2xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="signin-password"
              className="block text-xs font-semibold text-slate-700"
            >
              Password
            </label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
              <input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={submitting}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/85 focus:bg-white border border-slate-200 focus:border-teal-600 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all shadow-2xs"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            style={{ background: 'var(--gradient)' }}
          >
            <span>{submitting ? 'Signing in...' : 'Sign in'}</span>
            {!submitting && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};
