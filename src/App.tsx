/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Tournament, Division } from './types';
import { getInitialTournament, DEFAULT_EVENTS, DEFAULT_AGE_GROUPS } from './utils/mockData';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import { 
  getCurrentUser, 
  saveTournamentToSupabase, 
  loadTournamentFromSupabase, 
  listUserTournaments 
} from './services/tournamentService';
import AuthModal from './components/AuthModal';

// Component Imports
import OverallSummary from './components/OverallSummary';
import TournamentConfig from './components/TournamentConfig';
import DivisionEntries from './components/DivisionEntries';
import DivisionGroups from './components/DivisionGroups';
import DivisionRoundRobin from './components/DivisionRoundRobin';
import DivisionKnockout from './components/DivisionKnockout';
import { exportTournamentToPDF } from './utils/pdfExport';

// Icons
import {
  Trophy,
  Settings,
  LayoutDashboard,
  Award,
  Users,
  Grid3X3,
  Calendar,
  RotateCcw,
  Sparkles,
  ChevronRight,
  ClipboardList,
  Cloud,
  CloudOff,
  Database,
  LogIn,
  LogOut,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Share2,
  Link
} from 'lucide-react';

const LOCAL_STORAGE_KEY = 'pickleball_tournament_data_v1';

export default function App() {
  const [tournament, setTournament] = useState<Tournament>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error parsing tournament data from localStorage', e);
      }
    }
    return getInitialTournament();
  });

  // Supabase states
  const [user, setUser] = useState<any>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [onlineTournaments, setOnlineTournaments] = useState<Array<{ id: string; name: string; date: string }>>([]);
  const [showSyncSuccessMsg, setShowSyncSuccessMsg] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    // Clear toast automatically after 4 seconds
    const timer = setTimeout(() => setToast(null), 4000);
    return timer;
  };

  // Navigation Menu: 'dashboard' | 'config' | 'div-detail'
  const [selectedMenu, setSelectedMenu] = useState<'dashboard' | 'config' | 'div-detail'>('dashboard');
  
  // Selected Division ID for 'div-detail' view
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>('');
  
  // Sub-tabs inside division details: 'entries' | 'groups' | 'round-robin' | 'knockout'
  const [divisionTab, setDivisionTab] = useState<'entries' | 'groups' | 'round-robin' | 'knockout'>('entries');

  // Track Auth Session on startup
  useEffect(() => {
    if (isSupabaseConfigured) {
      getCurrentUser().then(currUser => {
        setUser(currUser);
      });

      // Listen for auth state changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });

      return () => subscription.unsubscribe();
    }
  }, []);

  // Load tournament from URL query parameter on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTId = params.get('t') || params.get('id');
    if (urlTId && isSupabaseConfigured) {
      const loadFromUrl = async () => {
        setIsSyncing('syncing');
        const loaded = await loadTournamentFromSupabase(urlTId);
        if (loaded) {
          setTournament(loaded);
          setIsSyncing('synced');
          setSelectedMenu('dashboard');
          setSelectedDivisionId('');
          showToast('Turnamen berhasil dimuat dari tautan cloud!', 'success');
        } else {
          setIsSyncing('error');
          showToast('Gagal memuat turnamen dari tautan cloud.', 'error');
        }
      };
      loadFromUrl();
    }
  }, []);

  // Fetch online tournaments list when user is logged in
  const refreshOnlineTournamentsList = async () => {
    if (user && isSupabaseConfigured) {
      const list = await listUserTournaments();
      setOnlineTournaments(list);
    } else {
      setOnlineTournaments([]);
    }
  };

  useEffect(() => {
    refreshOnlineTournamentsList();
  }, [user]);

  // Sync to local storage and Supabase (if logged in)
  useEffect(() => {
    // 1. Sync to local storage always (offline first)
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tournament));
    
    // 2. Sync to Supabase in the background if logged in
    if (user && isSupabaseConfigured) {
      const performSync = async () => {
        setIsSyncing('syncing');
        const success = await saveTournamentToSupabase(tournament);
        if (success) {
          setIsSyncing('synced');
          setShowSyncSuccessMsg(true);
          const timer = setTimeout(() => setShowSyncSuccessMsg(false), 2000);
          refreshOnlineTournamentsList(); // refresh dropdown items
          return () => clearTimeout(timer);
        } else {
          setIsSyncing('error');
          const lastErr = (window as any).lastSupabaseError || 'Gagal sinkronisasi data turnamen ke cloud.';
          showToast(`Gagal Sinkronisasi: ${lastErr}`, 'error');
        }
      };
      
      // Debounce sync slightly to avoid rapid continuous writes
      const timeoutId = setTimeout(performSync, 1000);
      return () => clearTimeout(timeoutId);
    } else {
      setIsSyncing('idle');
    }
  }, [tournament, user]);

  // Handler to update the entire tournament object
  const handleTournamentUpdate = (updatedTournament: Tournament) => {
    setTournament(updatedTournament);
  };

  // Handler to update a specific active division's data
  const handleUpdateDivision = (updatedDivision: Division) => {
    const updatedDivisions = tournament.activeDivisions.map(div => {
      if (div.id === updatedDivision.id) {
        return updatedDivision;
      }
      return div;
    });

    setTournament({
      ...tournament,
      activeDivisions: updatedDivisions
    });
  };

  // Reset to demo template data
  const handleResetToDemo = () => {
    setShowConfirm({
      title: 'Muat Ulang Data Demo',
      message: 'Apakah Anda yakin ingin memuat ulang Data Demo? Seluruh data pendaftaran dan skor turnamen saat ini akan ditimpa.',
      onConfirm: () => {
        setTournament(getInitialTournament());
        setSelectedMenu('dashboard');
        setSelectedDivisionId('');
        setShowConfirm(null);
        showToast('Data demo berhasil dimuat!', 'success');
      }
    });
  };

  // Clear tournament data to start clean/fresh
  const handleStartFresh = () => {
    setShowConfirm({
      title: 'Buat Turnamen Baru',
      message: 'Apakah Anda yakin ingin membuat Turnamen Baru? Seluruh data yang tersimpan saat ini akan dibersihkan.',
      onConfirm: () => {
        const rand = Math.random().toString(36).substring(2, 7);
        const tId = `t-fresh-${Date.now()}`;
        const freshTournament: Tournament = {
          id: tId,
          name: 'Turnamen Pickleball Baru',
          date: new Date().toISOString().split('T')[0],
          location: '',
          events: DEFAULT_EVENTS.map(ev => ({ ...ev, id: `${ev.id}-${rand}` })),
          ageGroups: DEFAULT_AGE_GROUPS.map(ag => ({ ...ag, id: `${ag.id}-${rand}` })),
          activeDivisions: []
        };
        setTournament(freshTournament);
        setSelectedMenu('config');
        setSelectedDivisionId('');
        setShowConfirm(null);
        showToast('Turnamen baru berhasil dibuat!', 'success');
      }
    });
  };

  // Load an online tournament from Supabase
  const handleLoadOnlineTournament = async (tId: string) => {
    if (!tId) return;
    setIsSyncing('syncing');
    const loaded = await loadTournamentFromSupabase(tId);
    if (loaded) {
      setTournament(loaded);
      setIsSyncing('synced');
      setSelectedMenu('dashboard');
      setSelectedDivisionId('');
      showToast('Berhasil memuat turnamen dari cloud!', 'success');
    } else {
      setIsSyncing('error');
      showToast('Gagal memuat data turnamen dari cloud. Periksa hak akses Anda.', 'error');
    }
  };

  // Copy a clean short share link of the tournament to the clipboard
  const handleShareTournament = () => {
    if (!tournament.id) return;
    const shareUrl = `${window.location.origin}/?t=${tournament.id}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Tautan pendek turnamen berhasil disalin ke clipboard!', 'success');
    }).catch(() => {
      showToast('Gagal menyalin tautan secara otomatis.', 'error');
    });
  };

  // Force manual push/migration of local data to Supabase
  const handleMigrateLocalData = async () => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }
    setIsSyncing('syncing');
    const success = await saveTournamentToSupabase(tournament);
    if (success) {
      setIsSyncing('synced');
      showToast('Migrasi Berhasil! Data lokal telah disimpan di database online Supabase.', 'success');
      refreshOnlineTournamentsList();
    } else {
      setIsSyncing('error');
      showToast('Migrasi gagal. Silakan periksa koneksi internet Anda.', 'error');
    }
  };

  // Logout handler
  const handleLogout = async () => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      // Auto-reset confirmation after 4 seconds
      setTimeout(() => setConfirmLogout(false), 4000);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setIsSyncing('idle');
    setConfirmLogout(false);
    showToast('Anda telah keluar dari Akun Cloud.', 'success');
  };

  // Quick navigation helpers
  const navigateToDivision = (divisionId: string) => {
    setSelectedDivisionId(divisionId);
    setSelectedMenu('div-detail');
    setDivisionTab('entries');
  };

  const currentDiv = tournament.activeDivisions.find(div => div.id === selectedDivisionId);
  const matchedEvent = currentDiv ? tournament.events.find(e => e.id === currentDiv.eventId) : null;
  const isDouble = matchedEvent ? matchedEvent.isDouble : true;

  // Differentiate between Admin and Public/Viewer mode
  const isAdmin = !tournament.ownerId || (user !== null && user.id === tournament.ownerId);

  return (
    <div className="min-h-screen bg-softbg flex flex-col md:flex-row text-slate-800 font-sans" id="app-container">
      
      {/* 1. SIDEBAR PANEL */}
      <aside className="w-full md:w-80 bg-navy text-slate-200 flex flex-col shrink-0 border-r border-navy-light/65" id="sidebar">
        
        {/* App Title Header */}
        <div className="p-6 border-b border-navy-light/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-neon p-2.5 rounded-xl shadow-md text-navy">
              <Trophy className="h-6 w-6 font-black" />
            </div>
            <div>
              <h1 className="font-black text-sm tracking-tight leading-none uppercase text-neon">Pickleball</h1>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-0.5">EO Tournament Manager</span>
            </div>
          </div>
        </div>

        {/* Cloud Status / Auth Panel */}
        <div className="mx-4 mt-4 p-4 bg-navy-light/40 rounded-xl border border-navy-light/40 space-y-3" id="cloud-status-panel">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Database className="h-3 w-3 text-neon" /> Koneksi Cloud
            </span>
            {user ? (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold rounded-full flex items-center gap-1">
                <Cloud className="h-2.5 w-2.5" /> Online
              </span>
            ) : (
              <span className="px-2 py-0.5 bg-slate-500/20 text-slate-400 border border-slate-500/30 text-[9px] font-bold rounded-full flex items-center gap-1">
                <CloudOff className="h-2.5 w-2.5" /> Offline
              </span>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-navy-light/20 pt-2 pb-1">
            <span className="text-[10px] font-bold text-slate-450 uppercase tracking-wider">
              Level Akses
            </span>
            {isAdmin ? (
              <span className="px-2 py-0.5 bg-neon/20 text-neon border border-neon/30 text-[9px] font-black rounded-full flex items-center gap-1 uppercase tracking-wider">
                ⚡ Mode Admin
              </span>
            ) : (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-black rounded-full flex items-center gap-1 uppercase tracking-wider animate-pulse">
                👁️ Mode Publik
              </span>
            )}
          </div>

          {user ? (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-300 truncate" title={user.email}>
                Email: <span className="text-neon">{user.email}</span>
              </div>
              
              {/* Sync Indicators */}
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                {isSyncing === 'syncing' && (
                  <span className="flex items-center gap-1 text-neon/95">
                    <RefreshCw className="h-3 w-3 animate-spin text-neon" /> Sinkronisasi database...
                  </span>
                )}
                {isSyncing === 'synced' && (
                  <span className="flex items-center gap-1 text-emerald-400 font-bold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Database sinkron
                  </span>
                )}
                {isSyncing === 'error' && (
                  <span className="flex items-center gap-1 text-rose-400 font-bold">
                    <AlertCircle className="h-3.5 w-3.5" /> Gagal sinkronisasi
                  </span>
                )}
              </div>

              {/* Online Tournament Selector */}
              {onlineTournaments.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Pilih Turnamen Cloud</label>
                  <select
                    onChange={(e) => handleLoadOnlineTournament(e.target.value)}
                    value={tournament.id}
                    className="w-full bg-navy border border-navy-light/60 rounded-lg py-1.5 px-2 text-[11px] font-semibold text-slate-200 outline-none focus:border-neon focus:ring-1 focus:ring-neon"
                    id="online-tournament-selector"
                  >
                    <option value="">-- Pilih dari Database --</option>
                    {onlineTournaments.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.date})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Share link button */}
              <button
                onClick={handleShareTournament}
                className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 shadow-xs"
                id="sidebar-share-btn"
              >
                <Share2 className="h-3 w-3" />
                <span>Bagikan Turnamen (Tautan Pendek)</span>
              </button>

              <button
                onClick={handleLogout}
                className={`w-full py-1.5 border rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1.5 ${
                  confirmLogout 
                    ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 animate-pulse' 
                    : 'bg-navy-light hover:bg-navy-light/80 text-rose-400 hover:text-rose-300 border-rose-500/15'
                }`}
                id="cloud-logout-btn"
              >
                <LogOut className="h-3 w-3" />
                <span>{confirmLogout ? 'Yakin? Klik Sekali Lagi' : 'Keluar Akun Cloud'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Anda berada di <b>Mode Offline (Demo)</b>. Masuk untuk mengaktifkan sinkronisasi multi-device & cloud backup otomatis.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setIsAuthModalOpen(true)}
                  className="py-1.5 bg-neon text-navy hover:bg-neon/90 rounded-lg text-[10px] font-black uppercase tracking-wider transition flex items-center justify-center gap-1"
                  id="cloud-login-trigger"
                >
                  <LogIn className="h-3 w-3" /> Login Admin
                </button>
                <button
                  onClick={handleMigrateLocalData}
                  className="py-1.5 bg-navy-light hover:bg-navy-light/80 text-slate-300 border border-navy-light/60 rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1"
                  title="Unggah data saat ini ke Supabase"
                  id="local-migrate-btn"
                >
                  <Download className="h-3 w-3 text-neon rotate-180" /> Migrasi Data
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation links */}
        <div className="p-4 flex-1 space-y-6 overflow-y-auto" id="sidebar-nav">
          
          {/* Section: Menu Utama */}
          <div className="space-y-1.5">
            <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Menu Utama</span>
            
            <button
              onClick={() => setSelectedMenu('dashboard')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all ${
                selectedMenu === 'dashboard'
                  ? 'bg-navy-light text-neon shadow-sm font-black border-l-4 border-l-neon'
                  : 'text-slate-400 hover:text-white hover:bg-navy-light/40'
              }`}
              id="nav-dashboard"
            >
              <span className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" /> Dashboard Rekap
              </span>
              <ChevronRight className="h-3 w-3 opacity-60" />
            </button>

            <button
              onClick={() => setSelectedMenu('config')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all ${
                selectedMenu === 'config'
                  ? 'bg-navy-light text-neon shadow-sm font-black border-l-4 border-l-neon'
                  : 'text-slate-400 hover:text-white hover:bg-navy-light/40'
              }`}
              id="nav-config"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" /> Atur Turnamen & Matriks
              </span>
              <ChevronRight className="h-3 w-3 opacity-60" />
            </button>
          </div>

          {/* Section: Daftar Divisi Aktif */}
          <div className="space-y-1.5 pt-2">
            <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Divisi Pertandingan Aktif</span>
            
            {tournament.activeDivisions.length === 0 ? (
              <p className="px-3 text-xs text-slate-500 italic leading-relaxed">
                Belum ada divisi aktif. Aktifkan kombinasi di tab Atur Turnamen.
              </p>
            ) : (
              <div className="space-y-1" id="sidebar-active-divisions-list">
                {tournament.activeDivisions.map(div => {
                  const isActive = selectedMenu === 'div-detail' && selectedDivisionId === div.id;
                  return (
                    <button
                      key={div.id}
                      onClick={() => navigateToDivision(div.id)}
                      className={`w-full px-3 py-2 rounded-lg text-xs font-medium text-left transition flex items-center gap-2 truncate ${
                        isActive
                          ? 'bg-navy-light text-neon font-bold border-l-2 border-l-neon'
                          : 'text-slate-450 hover:text-slate-200 hover:bg-navy-light/40'
                      }`}
                      id={`nav-division-${div.id}`}
                    >
                      <Award className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-neon' : 'text-slate-500'}`} />
                      <span className="truncate">{div.eventName} {div.ageGroupName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Sidebar Footer: Data control */}
        <div className="p-4 border-t border-navy-light/40 space-y-2 bg-navy-light/20" id="sidebar-footer">
          {isAdmin && !user && (
            <button
              onClick={handleResetToDemo}
              className="w-full px-3 py-2 bg-navy-light hover:bg-navy-light/80 text-slate-300 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5"
              id="reset-demo-action"
            >
              <RotateCcw className="h-3.5 w-3.5 text-neon" /> Muat Ulang Data Demo
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleStartFresh}
              className="w-full px-3 py-2 bg-neon/10 hover:bg-neon/20 text-neon rounded-lg text-[11px] font-bold border border-neon/30 transition flex items-center justify-center gap-1.5"
              id="start-fresh-action"
            >
              <Sparkles className="h-3.5 w-3.5" /> Buat Turnamen Baru
            </button>
          )}
          {!isAdmin && (
            <div className="p-2 text-center text-[10px] text-slate-500 font-medium italic border border-dashed border-slate-700/40 rounded-lg">
              Mode Lihat Saja. Masuk sebagai pembuat turnamen untuk mengedit.
            </div>
          )}
        </div>

      </aside>

      {/* 2. MAIN APPLICATION CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0" id="main-content-panel">
        
        {/* Top Navbar / Title Bar */}
        <header className="bg-white border-b border-slate-100 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0" id="top-navbar">
          <div className="space-y-0.5">
            <h2 className="text-xl font-extrabold tracking-tight text-slate-850">
              {selectedMenu === 'dashboard' && 'Dashboard Rekap Juara'}
              {selectedMenu === 'config' && 'Pengaturan Turnamen & Matriks'}
              {selectedMenu === 'div-detail' && currentDiv && `${currentDiv.eventName} ${currentDiv.ageGroupName}`}
            </h2>
            <p className="text-xs text-slate-450 font-medium">
              {selectedMenu === 'dashboard' && 'Hasil akhir dan podium juara dari semua divisi pertandingan.'}
              {selectedMenu === 'config' && 'Konfigurasi kategori kelompok umur, nomor lomba, dan matriks pendaftaran.'}
              {selectedMenu === 'div-detail' && currentDiv && `Sistem turnamen fase grup & gugur untuk nomor ${matchedEvent?.name || 'Ganda'}`}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 font-medium" id="top-navbar-stats">
            <button
              onClick={() => exportTournamentToPDF(tournament)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-navy hover:bg-navy-light text-neon font-extrabold rounded-lg text-xs transition duration-200 shadow-xs cursor-pointer"
              title="Ekspor Seluruh Hasil & Hasil Pertandingan ke PDF"
              id="export-pdf-top-btn"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Unduh PDF</span>
            </button>
            {isSupabaseConfigured && (
              <button
                onClick={handleShareTournament}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition duration-200 shadow-xs"
                title="Salin Tautan Pendek Turnamen"
                id="share-tournament-top-btn"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Bagikan Link</span>
              </button>
            )}
            {!isAdmin && (
              <span className="px-2.5 py-1 bg-amber-500/10 text-amber-600 border border-amber-200 rounded-full font-black text-[10px] uppercase tracking-wider flex items-center gap-1">
                👁️ Lihat Saja
              </span>
            )}
            <span className="px-2.5 py-1 bg-navy/10 text-navy rounded-full font-bold">
              {tournament.activeDivisions.length} Divisi Aktif
            </span>
            <span className="text-slate-300">|</span>
            <span className="font-semibold text-slate-650 truncate max-w-[200px]" title={tournament.name}>
              {tournament.name}
            </span>
          </div>
        </header>

        {/* Tab-driven Content Container */}
        <div className="flex-1 p-6 md:p-8 overflow-y-auto" id="dynamic-content-scroller">
          
          {selectedMenu === 'dashboard' && (
            <OverallSummary tournament={tournament} onNavigateToDivision={navigateToDivision} />
          )}

          {selectedMenu === 'config' && (
            <TournamentConfig tournament={tournament} onChange={handleTournamentUpdate} isAdmin={isAdmin} />
          )}

          {selectedMenu === 'div-detail' && currentDiv && (
            <div className="space-y-6" id="division-details-flow">
              
              {/* Horizontal Division Sub-tabs */}
              <div className="flex border-b border-slate-200 overflow-x-auto bg-white p-1 rounded-xl card-shadow border" id="division-subtabs">
                <button
                  onClick={() => setDivisionTab('entries')}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition shrink-0 flex items-center gap-1.5 ${
                    divisionTab === 'entries'
                      ? 'bg-navy text-neon shadow-xs'
                      : 'text-slate-500 hover:text-navy hover:bg-slate-100'
                  }`}
                  id="tab-entries"
                >
                  <Users className="h-3.5 w-3.5" /> 1. Aturan & Peserta
                </button>

                <button
                  onClick={() => setDivisionTab('groups')}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition shrink-0 flex items-center gap-1.5 ${
                    divisionTab === 'groups'
                      ? 'bg-navy text-neon shadow-xs'
                      : 'text-slate-500 hover:text-navy hover:bg-slate-100'
                  }`}
                  id="tab-groups"
                >
                  <Grid3X3 className="h-3.5 w-3.5" /> 2. Pembagian Grup
                </button>

                <button
                  onClick={() => setDivisionTab('round-robin')}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition shrink-0 flex items-center gap-1.5 ${
                    divisionTab === 'round-robin'
                      ? 'bg-navy text-neon shadow-xs'
                      : 'text-slate-500 hover:text-navy hover:bg-slate-100'
                  }`}
                  id="tab-round-robin"
                >
                  <ClipboardList className="h-3.5 w-3.5" /> 3. Round Robin (Grup)
                </button>

                <button
                  onClick={() => setDivisionTab('knockout')}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition shrink-0 flex items-center gap-1.5 ${
                    divisionTab === 'knockout'
                      ? 'bg-navy text-neon shadow-xs'
                      : 'text-slate-500 hover:text-navy hover:bg-slate-100'
                  }`}
                  id="tab-knockout"
                >
                  <Trophy className="h-3.5 w-3.5" /> 4. Fase Gugur (Knockout)
                </button>
              </div>

              {/* Render Selected Sub-tab Component */}
              <div className="pt-2" id="subtab-component-container">
                {divisionTab === 'entries' && (
                  <DivisionEntries
                    division={currentDiv}
                    isDouble={isDouble}
                    onUpdateDivision={handleUpdateDivision}
                    isAdmin={isAdmin}
                  />
                )}

                {divisionTab === 'groups' && (
                  <DivisionGroups
                    division={currentDiv}
                    onUpdateDivision={handleUpdateDivision}
                    isAdmin={isAdmin}
                  />
                )}

                {divisionTab === 'round-robin' && (
                  <DivisionRoundRobin
                    division={currentDiv}
                    onUpdateDivision={handleUpdateDivision}
                    isAdmin={isAdmin}
                  />
                )}

                {divisionTab === 'knockout' && (
                  <DivisionKnockout
                    division={currentDiv}
                    onUpdateDivision={handleUpdateDivision}
                    isAdmin={isAdmin}
                  />
                )}
              </div>

            </div>
          )}

        </div>

      </main>

      {/* Auth Modal Overlay */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={refreshOnlineTournamentsList}
      />

      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="app-confirm-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl transform transition-all animate-scale-up" id="app-confirm-card">
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-amber-50 border border-amber-200 text-amber-600 font-bold text-lg shrink-0">⚠️</span>
              {showConfirm.title}
            </h3>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              {showConfirm.message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowConfirm(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                id="app-confirm-cancel-button"
              >
                Batalkan
              </button>
              <button
                type="button"
                onClick={showConfirm.onConfirm}
                className="px-4 py-2 text-sm font-extrabold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition"
                id="app-confirm-submit-button"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div 
          className={`fixed bottom-6 right-6 z-[100] max-w-sm p-4 rounded-xl shadow-2xl border flex items-center gap-3 transition-all duration-350 transform translate-y-0 scale-100 ${
            toast.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-850' 
              : toast.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-850'
              : 'bg-navy text-slate-200 border-navy-light/40'
          }`}
          id="toast-notification"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />
          ) : (
            <Cloud className="h-5 w-5 text-neon shrink-0 animate-pulse" />
          )}
          <span className="text-xs font-black tracking-tight">{toast.message}</span>
        </div>
      )}

    </div>
  );
}
