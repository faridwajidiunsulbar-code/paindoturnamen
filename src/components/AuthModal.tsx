import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Lock, Mail, User, X, Loader2, Key } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
}

export default function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  if (!isSupabaseConfigured) {
    return (
      <div className="fixed inset-0 bg-navy/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="auth-unconfigured-modal">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl border border-slate-100 text-center space-y-4">
          <div className="bg-amber-50 text-amber-600 p-4 rounded-xl inline-flex">
            <Lock className="h-10 w-10 animate-bounce" />
          </div>
          <h3 className="text-lg font-extrabold text-slate-850">Supabase Belum Dikonfigurasi</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Kunci API Supabase (URL dan Anon Key) belum diatur di variabel lingkungan (.env). Silakan atur <code className="bg-slate-100 p-1 rounded font-mono">VITE_SUPABASE_URL</code> dan <code className="bg-slate-100 p-1 rounded font-mono">VITE_SUPABASE_ANON_KEY</code> terlebih dahulu.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-slate-200 hover:bg-slate-350 text-slate-700 font-bold text-xs rounded-xl transition"
          >
            Tutup
          </button>
        </div>
      </div>
    );
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      if (isSignUp) {
        // Register a new user
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName || email.split('@')[0]
            }
          }
        });

        if (signUpError) throw signUpError;

        if (data.user && data.session) {
          setSuccessMsg('Pendaftaran berhasil! Akun langsung masuk.');
          setTimeout(() => {
            onAuthSuccess();
            onClose();
          }, 1500);
        } else {
          setSuccessMsg('Registrasi berhasil! Silakan periksa email Anda untuk konfirmasi jika diperlukan.');
        }
      } else {
        // Sign In existing user
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (signInError) throw signInError;

        if (data.user) {
          setSuccessMsg('Login berhasil! Menghubungkan database...');
          setTimeout(() => {
            onAuthSuccess();
            onClose();
          }, 1000);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-navy/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="auth-modal-overlay">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-100 overflow-hidden relative flex flex-col" id="auth-modal">
        
        {/* Header */}
        <div className="bg-navy p-6 text-white relative">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition p-1.5 rounded-lg hover:bg-navy-light/45"
            id="auth-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
          
          <div className="flex items-center gap-3">
            <div className="bg-neon p-2 rounded-xl text-navy">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-md font-extrabold uppercase tracking-tight text-neon">
                {isSignUp ? 'Buat Akun Admin' : 'Login Admin Turnamen'}
              </h2>
              <p className="text-[10px] text-slate-350">
                {isSignUp ? 'Daftarkan email Anda untuk mengelola turnamen cloud' : 'Masuk untuk sinkronisasi multi-device & cloud backup'}
              </p>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleAuth} className="p-6 space-y-4 flex-1">
          {error && (
            <div className="p-3 bg-rose-50 border-l-4 border-rose-500 text-rose-700 text-xs rounded-lg font-medium animate-pulse" id="auth-error">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-xs rounded-lg font-medium" id="auth-success">
              {successMsg}
            </div>
          )}

          {isSignUp && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Nama Lengkap</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Contoh: Farid Wijaya"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-navy focus:ring-1 focus:ring-navy outline-none transition"
                  required={isSignUp}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Alamat Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="email"
                placeholder="admin@turnamen.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-navy focus:ring-1 focus:ring-navy outline-none transition"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Kata Sandi (Min 6 Karakter)</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="password"
                placeholder="******"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-navy focus:ring-1 focus:ring-navy outline-none transition"
                required
                minLength={6}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-navy hover:bg-navy-light text-neon font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 mt-4"
            id="auth-submit-btn"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-neon" />
                <span>Memproses...</span>
              </>
            ) : (
              <span>{isSignUp ? 'Buat Akun' : 'Masuk Sekarang'}</span>
            )}
          </button>

          {/* Toggle login vs signup */}
          <div className="pt-3 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError('');
                setSuccessMsg('');
              }}
              className="text-xs text-slate-500 hover:text-navy hover:underline transition font-semibold"
              id="auth-toggle-mode"
            >
              {isSignUp ? 'Sudah memiliki akun? Login di sini' : 'Belum punya akun? Registrasi Admin Baru'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
