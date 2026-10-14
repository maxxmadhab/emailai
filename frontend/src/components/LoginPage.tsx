import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import type { User } from '../types';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if Supabase Google OAuth is actively configured
      const { data, error: supaErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (supaErr) {
        console.error('Supabase OAuth error:', supaErr);
        setError(`Google login failed: ${supaErr.message}`);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      } else {
        setError('No redirect URL returned from Google OAuth provider.');
      }
    } catch (err: any) {
      console.error('OAuth redirect error:', err);
      setError(err?.message || 'Failed to initiate Google sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const userEmail = email.trim() || 'oliver.brown@domain.io';
      const userName = userEmail.split('@')[0] || 'Oliver Brown';
      const res = await api.loginWithDemo(userEmail, userName);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-[420px] bg-white rounded-2xl border border-gray-100 shadow-[0_4px_25px_rgba(0,0,0,0.06)] p-8 sm:p-10 transition-all">
        {/* Title */}
        <h1 className="text-3xl font-bold text-center text-gray-900 mb-8 tracking-tight">
          Login
        </h1>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs text-center">
            {error}
          </div>
        )}

        {/* Login with Google Button */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full h-11 flex items-center justify-center gap-3 rounded-lg bg-[#E8F5E9] hover:bg-[#DCEDC8] text-gray-800 text-sm font-medium transition-colors cursor-pointer"
        >
          {/* Google Multi-colored SVG Icon */}
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Login with Google</span>
        </button>

        {/* Divider */}
        <div className="relative my-7 flex items-center justify-center">
          <div className="w-full border-t border-gray-200"></div>
          <span className="absolute bg-white px-3 text-xs text-gray-400 font-normal">
            or sign up through email
          </span>
        </div>

        {/* Form Inputs */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Email ID"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-4 rounded-lg bg-[#F4F6F5] border-0 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00A340]/40 transition"
            />
          </div>

          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-4 rounded-lg bg-[#F4F6F5] border-0 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00A340]/40 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 mt-2 rounded-lg bg-[#00A340] hover:bg-[#008f37] text-white text-sm font-semibold transition-colors cursor-pointer shadow-sm active:scale-[0.99]"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        {/* Demo Credentials Callout */}
        <div className="mt-6 pt-5 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Demo Credentials</span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded-full">
              Click to Auto-fill
            </span>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setEmail('admin@reachinbox.ai');
                setPassword('admin123');
              }}
              className="w-full text-left p-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 hover:bg-emerald-100/60 transition cursor-pointer flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-semibold text-emerald-950 flex items-center gap-1.5">
                  <span>👑 Admin Account</span>
                  <span className="text-[10px] font-normal text-emerald-700 bg-emerald-200/60 px-1.5 py-0.2 rounded">Full Access</span>
                </div>
                <div className="text-[11px] text-gray-600 font-mono mt-0.5">
                  admin@reachinbox.ai
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-gray-500 font-mono bg-white px-2 py-0.5 rounded border border-emerald-100">
                  admin123
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setEmail('user@reachinbox.ai');
                setPassword('user123');
              }}
              className="w-full text-left p-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100/70 transition cursor-pointer flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                  <span>👤 Standard User</span>
                  <span className="text-[10px] font-normal text-gray-500 bg-gray-200/60 px-1.5 py-0.2 rounded">Limited</span>
                </div>
                <div className="text-[11px] text-gray-600 font-mono mt-0.5">
                  user@reachinbox.ai
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-gray-500 font-mono bg-white px-2 py-0.5 rounded border border-gray-200">
                  user123
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
