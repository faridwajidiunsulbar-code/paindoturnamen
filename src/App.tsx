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
  getLatestTournamentFromSupabase,
  listUserTournaments,
  deleteTournamentFromSupabase
} from './services/tournamentService';
import AuthModal from './components/AuthModal';
import CreateTournamentModal from './components/CreateTournamentModal';

// Component Imports
import OverallSummary from './components/OverallSummary';
import TournamentConfig from './components/TournamentConfig';
import DivisionEntries from './components/DivisionEntries';
import DivisionGroups from './components/DivisionGroups';
import DivisionRoundRobin from './components/DivisionRoundRobin';
import DivisionKnockout from './components/DivisionKnockout';
import TournamentClosureSection from './components/TournamentClosureSection';
import { isTournamentReadOnly } from './utils/closureHelpers';
import { exportTournamentToPDF } from './utils/pdfExport';
import { generateRoundRobinMatches } from './utils/tournamentHelpers';
import { Match } from './types';

function getTournamentDataScore(t: Tournament | null): number {
  if (!t || !t.activeDivisions) return 0;
  let score = t.activeDivisions.length * 100;
  t.activeDivisions.forEach(div => {
    score += (div.entries?.length || 0) * 10;
    score += (div.groups?.length || 0) * 5;
    score += (div.roundRobinMatches?.length || 0) * 2;
    score += (div.knockoutStage?.matches?.length || 0) * 2;
    if (div.roundRobinMatches) {
      score += div.roundRobinMatches.filter(m => m.status === 'selesai' || m.score1 !== undefined).length * 5;
    }
    if (div.knockoutStage?.matches) {
      score += div.knockoutStage.matches.filter(m => m.status === 'selesai' || m.score1 !== undefined).length * 5;
    }
  });
  return score;
}

function sanitizeTournamentData(t: Tournament): Tournament {
  if (!t || !t.activeDivisions) return t;

  const sanitizedDivisions = t.activeDivisions.map(div => {
    // 1. Sanitize group names (remove duplicate "Grup Pool " -> "Pool ")
    const cleanGroups = (div.groups || []).map(g => {
      let cleanName = g.name || '';
      if (cleanName.startsWith('Grup Pool ')) {
        cleanName = cleanName.replace('Grup Pool ', 'Pool ');
      } else if (cleanName.startsWith('Grup Grup ')) {
        cleanName = cleanName.replace('Grup Grup ', 'Grup ');
      }
      return { ...g, name: cleanName };
    });

    // 2. Check if roundRobinMatches exist and align group names if needed
    let matches = div.roundRobinMatches || [];

    // Align match groupName with clean group names if needed
    matches = matches.map(m => {
      if (!m.groupName) return m;
      let mGroupName = m.groupName;
      if (mGroupName.startsWith('Grup Pool ')) {
        mGroupName = mGroupName.replace('Grup Pool ', 'Pool ');
      } else if (mGroupName.startsWith('Grup Grup ')) {
        mGroupName = mGroupName.replace('Grup Grup ', 'Grup ');
      }
      return { ...m, groupName: mGroupName };
    });

    return {
      ...div,
      groups: cleanGroups,
      roundRobinMatches: matches
    };
  });

  return {
    ...t,
    activeDivisions: sanitizedDivisions
  };
}

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
  Link,
  Trash2,
  Save,
  CloudUpload,
  HardDrive
} from 'lucide-react';

export default function App() {
  const [tournament, setTournament] = useState<Tournament>(() => {
    try {
      const saved = localStorage.getItem('paindo_active_tournament_v2') || localStorage.getItem('paindo_active_tournament_backup');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name) {
          return sanitizeTournamentData(parsed);
        }
      }
    } catch (e) {
      console.warn('Gagal memuat data turnamen lokal:', e);
    }
    return sanitizeTournamentData(getInitialTournament());
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(false);

  // Concurrency conflict modal state
  const [conflictData, setConflictData] = useState<{
    localRevision?: number;
    cloudRevision?: number;
    localUpdatedAt?: string;
    cloudUpdatedAt?: string;
  } | null>(null);

  // Supabase & Modal states
  const [user, setUser] = useState<any>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
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

  const initialDivId = tournament.activeDivisions && tournament.activeDivisions.length > 0 
    ? tournament.activeDivisions[0].id 
    : '';

  // Navigation Menu: 'dashboard' | 'config' | 'div-detail'
  const [selectedMenu, setSelectedMenu] = useState<'dashboard' | 'config' | 'div-detail'>('dashboard');
  
  // Selected Division ID for 'div-detail' view
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>(initialDivId);
  
  // Sub-tabs inside division details: 'entries' | 'groups' | 'round-robin' | 'knockout'
  const [divisionTab, setDivisionTab] = useState<'entries' | 'groups' | 'round-robin' | 'knockout'>('groups');

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

  // Warn user before closing or refreshing tab if there are unsaved local changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Centralized function to update tournament in state and persist to LocalStorage
  const updateTournamentState = (updated: Tournament, isFromCloud = false) => {
    const now = new Date().toISOString();
    const sanitized = sanitizeTournamentData({
      ...updated,
      updatedAt: !isFromCloud ? now : (updated.updatedAt || now),
      cloudUpdatedAt: isFromCloud ? (updated.cloudUpdatedAt || now) : updated.cloudUpdatedAt,
      cloudSyncedAt: isFromCloud ? now : updated.cloudSyncedAt
    });
    setTournament(sanitized);
    try {
      localStorage.setItem('paindo_active_tournament_v2', JSON.stringify(sanitized));
      if (sanitized.activeDivisions && sanitized.activeDivisions.length > 0) {
        localStorage.setItem('paindo_active_tournament_backup', JSON.stringify(sanitized));
      }
    } catch (e) {
      console.warn('Gagal menyimpan data turnamen ke LocalStorage:', e);
    }
    if (!isFromCloud) {
      setHasUnsavedChanges(true);
    } else {
      setHasUnsavedChanges(false);
    }
  };

  // Startup effect: Always preserve local saved state on page refresh.
  // Do NOT fetch or overwrite from Cloud automatically when refreshed.
  useEffect(() => {
    let localSaved: Tournament | null = null;
    try {
      const raw = localStorage.getItem('paindo_active_tournament_v2') || localStorage.getItem('paindo_active_tournament_backup');
      if (raw) localSaved = JSON.parse(raw);
    } catch (e) {}

    const hasLocalContent = localSaved && (
      (localSaved.activeDivisions && localSaved.activeDivisions.length > 0) ||
      (localSaved.name && localSaved.name !== 'Belum Ada Turnamen')
    );

    if (hasLocalContent) {
      // Local tournament is already restored via useState initial state. Just select first division if needed.
      if (!selectedDivisionId && localSaved.activeDivisions && localSaved.activeDivisions.length > 0) {
        setSelectedDivisionId(localSaved.activeDivisions[0].id);
      }
      setIsSyncing('synced');
      return;
    }

    // Only if local storage is completely empty, attempt loading from Cloud as fallback
    if (isSupabaseConfigured) {
      const loadFromCloud = async () => {
        const params = new URLSearchParams(window.location.search);
        const urlTId = params.get('t') || params.get('id');

        setIsSyncing('syncing');
        let loaded: Tournament | null = null;
        if (urlTId) {
          loaded = await loadTournamentFromSupabase(urlTId);
        } else {
          loaded = await getLatestTournamentFromSupabase();
        }

        if (loaded) {
          updateTournamentState(loaded, true);
          setIsSyncing('synced');
          setSelectedMenu('dashboard');
          if (loaded.activeDivisions && loaded.activeDivisions.length > 0) {
            setSelectedDivisionId(loaded.activeDivisions[0].id);
          }
        } else {
          setIsSyncing('idle');
        }
      };
      loadFromCloud();
    }
  }, []);

  // Keep URL query parameter ?t=... in sync with active tournament ID so refresh preserves active tournament
  useEffect(() => {
    if (tournament && tournament.id && tournament.id !== '') {
      try {
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.get('t') !== tournament.id) {
          currentUrl.searchParams.set('t', tournament.id);
          window.history.replaceState({}, '', currentUrl.toString());
        }
      } catch (e) {
        console.warn('URL state update error:', e);
      }
    }
  }, [tournament?.id]);

  // Conflict Resolution Handlers
  const handleReloadCloudVersion = async () => {
    if (!tournament?.id) return;
    setIsSyncing('syncing');
    const loaded = await loadTournamentFromSupabase(tournament.id);
    if (loaded) {
      updateTournamentState(loaded, true);
      setIsSyncing('synced');
      setConflictData(null);
      showToast('Berhasil memuat versi data terbaru dari Cloud!', 'success');
    } else {
      setIsSyncing('error');
      showToast('Gagal memuat data dari Cloud.', 'error');
    }
  };

  const handleKeepLocalVersion = () => {
    setConflictData(null);
    showToast('Tetap di versi lokal. Perubahan belum disimpan ke Cloud.', 'info');
  };

  // Manual save to Cloud Database on button click
  const handleManualSaveToCloud = async () => {
    if (!isSupabaseConfigured) {
      showToast('Database Cloud belum terkonfigurasi.', 'error');
      return;
    }
    if (!user) {
      setIsAuthModalOpen(true);
      showToast('Silakan masuk ke Akun Cloud (Admin) untuk menyimpan data ke Database Cloud.', 'info');
      return;
    }

    if (isSyncing === 'syncing') {
      showToast('Proses penyimpanan sedang berjalan. Harap tunggu.', 'info');
      return;
    }

    setIsSyncing('syncing');
    const result = await saveTournamentToSupabase(tournament);

    // TAHAP C - Urutan pemeriksaan wajib:
    // 1. isConflict
    if (result.isConflict) {
      setAutoSyncEnabled(false);
      const details = result.conflictDetails;
      setConflictData({
        localRevision: details?.localRevision ?? tournament.cloudRevision ?? 1,
        cloudRevision: details?.cloudRevision ?? ((tournament.cloudRevision ?? 1) + 1),
        localUpdatedAt: details?.localLoadedAt || tournament.updatedAt || tournament.cloudUpdatedAt,
        cloudUpdatedAt: details?.cloudUpdatedAt
      });
      setIsSyncing('error');
      setHasUnsavedChanges(true);
      console.info('[Hotfix PAINDO-007E1] Handler branch executed: CONFLICT TRIGGERED (Manual Save)', {
        localRevision: details?.localRevision ?? tournament.cloudRevision,
        cloudRevision: details?.cloudRevision,
        modalState: 'visible',
        childServiceInvoked: false
      });
      showToast('Konflik penyimpanan terdeteksi! Data turnamen di Cloud telah diperbarui dari tab/perangkat lain.', 'error');
      return;
    }

    // 2. partialSave
    if (result.partialSave) {
      const partialDetails = result.partialDetails;
      updateTournamentState({
        ...tournament,
        cloudRevision: partialDetails?.reservedRevision ?? tournament.cloudRevision,
        cloudSaveStatus: 'failed'
      }, false);
      setIsSyncing('error');
      const lastErr = (result as any).error?.message || 'Penyimpanan sebagian gagal.';
      showToast(lastErr, 'error');
      return;
    }

    // 3. !success
    if (!result.success) {
      setIsSyncing('error');
      const lastErr = (result as any).error?.message || 'Gagal menyimpan ke database cloud.';
      showToast(`Gagal menyimpan: ${lastErr}`, 'error');
      return;
    }

    // 4. success
    setIsSyncing('synced');
    setHasUnsavedChanges(false);
    const resData = result.data;
    updateTournamentState({
      ...tournament,
      cloudRevision: resData.cloudRevision,
      cloudUpdatedAt: resData.cloudUpdatedAt,
      cloudSaveStatus: resData.cloudSaveStatus,
      cloudSyncedAt: resData.savedAt
    }, true);
    refreshOnlineTournamentsList();
    showToast('Berhasil! Jadwal pertandingan, skor, & klasemen DISIMPAN ke Database Cloud.', 'success');
  };

  // Manual refresh from Cloud for users / spectators
  const handleRefreshFromCloud = async () => {
    if (!isSupabaseConfigured) return;

    const performFetch = async () => {
      setIsSyncing('syncing');
      
      let refreshed: Tournament | null = null;
      if (tournament && tournament.id && tournament.id !== '') {
        refreshed = await loadTournamentFromSupabase(tournament.id);
      }
      if (!refreshed) {
        refreshed = await getLatestTournamentFromSupabase();
      }

      if (refreshed) {
        updateTournamentState(refreshed, true);
        setIsSyncing('synced');
        showToast('Data turnamen berhasil diperbarui dari Cloud!', 'success');
      } else {
        setIsSyncing('idle');
        showToast('Tidak ada data terbaru dari Cloud.', 'info');
      }
    };

    if (hasUnsavedChanges) {
      setShowConfirm({
        title: 'Perubahan Lokal Belum Disimpan',
        message: 'Anda memiliki perubahan data di browser yang belum disimpan ke Cloud. Apakah Anda yakin ingin memperbarui dari Cloud dan membuang perubahan lokal tersebut?',
        onConfirm: () => {
          setShowConfirm(null);
          performFetch();
        }
      });
      return;
    }

    performFetch();
  };

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

  // Auto-Sync tournament changes to Supabase Cloud ONLY if autoSyncEnabled is active and not currently syncing
  useEffect(() => {
    if (autoSyncEnabled && user && isSupabaseConfigured && tournament && tournament.id && tournament.id !== '' && tournament.name !== 'Belum Ada Turnamen' && hasUnsavedChanges && isSyncing !== 'syncing') {
      const performSync = async () => {
        setIsSyncing('syncing');
        const result = await saveTournamentToSupabase(tournament);

        if (result.isConflict) {
          setAutoSyncEnabled(false);
          const details = result.conflictDetails;
          setConflictData({
            localRevision: details?.localRevision ?? tournament.cloudRevision ?? 1,
            cloudRevision: details?.cloudRevision ?? ((tournament.cloudRevision ?? 1) + 1),
            localUpdatedAt: details?.localLoadedAt || tournament.updatedAt || tournament.cloudUpdatedAt,
            cloudUpdatedAt: details?.cloudUpdatedAt
          });
          setIsSyncing('error');
          setHasUnsavedChanges(true);
          console.info('[Hotfix PAINDO-007E1] Handler branch executed: CONFLICT TRIGGERED (Auto-Sync)', {
            localRevision: details?.localRevision ?? tournament.cloudRevision,
            cloudRevision: details?.cloudRevision,
            modalState: 'visible',
            childServiceInvoked: false
          });
          showToast('Auto-Sync dihentikan: Data turnamen di Cloud telah diperbarui dari tab/perangkat lain.', 'error');
          return;
        }

        if (result.partialSave) {
          setAutoSyncEnabled(false);
          const partialDetails = result.partialDetails;
          updateTournamentState({
            ...tournament,
            cloudRevision: partialDetails?.reservedRevision ?? tournament.cloudRevision,
            cloudSaveStatus: 'failed'
          }, false);
          setIsSyncing('error');
          showToast('Auto-Sync dihentikan: Penyimpanan sebagian gagal.', 'error');
          return;
        }

        if (!result.success) {
          setIsSyncing('error');
          const lastErr = (result as any).error?.message || 'Gagal menyimpan ke database cloud.';
          showToast(`Auto-Sync gagal: ${lastErr}`, 'error');
          return;
        }

        setIsSyncing('synced');
        setHasUnsavedChanges(false);
        const resData = result.data;
        updateTournamentState({
          ...tournament,
          cloudRevision: resData.cloudRevision,
          cloudUpdatedAt: resData.cloudUpdatedAt,
          cloudSaveStatus: resData.cloudSaveStatus,
          cloudSyncedAt: resData.savedAt
        }, true);
        setShowSyncSuccessMsg(true);
        showToast('Data skor & susunan grup otomatis DIPUBLIKASI ke Cloud Web!', 'success');
        const timer = setTimeout(() => setShowSyncSuccessMsg(false), 2000);
        refreshOnlineTournamentsList();
      };
      
      const timeoutId = setTimeout(performSync, 2000);
      return () => clearTimeout(timeoutId);
    }
  }, [tournament, user, autoSyncEnabled, hasUnsavedChanges, isSyncing]);

  // Handler to update the entire tournament object
  const handleTournamentUpdate = (updatedTournament: Tournament) => {
    updateTournamentState(updatedTournament, false);
  };

  // Handler to update a specific active division's data
  const handleUpdateDivision = (updatedDivision: Division) => {
    const updatedDivisions = tournament.activeDivisions.map(div => {
      if (div.id === updatedDivision.id) {
        return updatedDivision;
      }
      return div;
    });

    updateTournamentState({
      ...tournament,
      activeDivisions: updatedDivisions
    }, false);
  };

  // Trigger Create Tournament Modal with Admin check and Confirmation Popup
  const handleStartFresh = () => {
    if (!user) {
      setIsAuthModalOpen(true);
      showToast('Akses Ditolak: Anda harus masuk sebagai Admin terlebih dahulu untuk membuat turnamen baru.', 'error');
      return;
    }

    const proceed = () => {
      setShowConfirm({
        title: 'Konfirmasi Buat Turnamen Baru',
        message: 'Apakah Anda yakin ingin membuat turnamen baru? Kredensial Admin Anda akan digunakan sebagai pemilik turnamen.',
        onConfirm: () => {
          setShowConfirm(null);
          setIsCreateModalOpen(true);
        }
      });
    };

    if (hasUnsavedChanges) {
      setShowConfirm({
        title: 'Perubahan Belum Disimpan',
        message: 'Turnamen aktif memiliki perubahan yang belum disimpan ke Cloud. Yakin ingin membuat turnamen baru?',
        onConfirm: () => {
          setShowConfirm(null);
          proceed();
        }
      });
      return;
    }

    proceed();
  };

  // Handler for creating a new validated tournament from modal
  const handleCreateTournament = (data: {
    name: string;
    date: string;
    location: string;
    sportType: 'badminton' | 'pickleball' | 'tennis' | 'table_tennis' | 'other';
  }) => {
    if (!user) {
      setIsAuthModalOpen(true);
      showToast('Akses Ditolak: Hanya Admin yang terautentikasi yang dapat membuat turnamen.', 'error');
      return;
    }

    const rand = Math.random().toString(36).substring(2, 7);
    const tId = `t-${Date.now()}`;
    
    let events = DEFAULT_EVENTS;
    if (data.sportType === 'badminton') {
      events = [
        { id: `ev-gb-${rand}`, name: 'Ganda Putra (Men\'s Doubles)', isDouble: true },
        { id: `ev-gw-${rand}`, name: 'Ganda Putri (Women\'s Doubles)', isDouble: true },
        { id: `ev-mix-${rand}`, name: 'Ganda Campuran (Mixed Doubles)', isDouble: true },
        { id: `ev-sb-${rand}`, name: 'Tunggal Putra (Men\'s Singles)', isDouble: false }
      ];
    } else if (data.sportType === 'pickleball') {
      events = [
        { id: `ev-pb-md-${rand}`, name: 'Men\'s Doubles (Ganda Putra)', isDouble: true },
        { id: `ev-pb-wd-${rand}`, name: 'Women\'s Doubles (Ganda Putri)', isDouble: true },
        { id: `ev-pb-mix-${rand}`, name: 'Mixed Doubles (Ganda Campuran)', isDouble: true },
        { id: `ev-pb-ms-${rand}`, name: 'Men\'s Singles (Tunggal Putra)', isDouble: false }
      ];
    }

    const newTournament: Tournament = {
      id: tId,
      name: data.name,
      date: data.date,
      location: data.location || '',
      events: events.map(ev => ({ ...ev, id: `${ev.id}-${rand}` })),
      ageGroups: DEFAULT_AGE_GROUPS.map(ag => ({ ...ag, id: `${ag.id}-${rand}` })),
      activeDivisions: [],
      ownerId: user.id
    };

    updateTournamentState(newTournament, false);
    setSelectedMenu('config');
    setSelectedDivisionId('');
    showToast(`Turnamen baru "${data.name}" berhasil dibuat! Klik "Simpan ke Cloud" untuk menyimpannya ke database online.`, 'success');
  };

  // Load an online tournament from Supabase
  const handleLoadOnlineTournament = async (tId: string) => {
    if (!tId) return;

    const doLoad = async () => {
      setIsSyncing('syncing');
      const loaded = await loadTournamentFromSupabase(tId);
      if (loaded) {
        const localScore = getTournamentDataScore(tournament);
        const cloudScore = getTournamentDataScore(loaded);

        if (tournament.id === tId && localScore > cloudScore && hasUnsavedChanges) {
          showToast('Turnamen lokal memiliki data lebih baru dibanding Cloud. Gunakan tombol "Simpan ke Cloud" untuk memperbarui data Cloud.', 'info');
          setIsSyncing('synced');
          return;
        }

        updateTournamentState(loaded, true);
        setIsSyncing('synced');
        setSelectedMenu('dashboard');
        if (loaded.activeDivisions && loaded.activeDivisions.length > 0) {
          setSelectedDivisionId(loaded.activeDivisions[0].id);
        } else {
          setSelectedDivisionId('');
        }
        showToast(`Berhasil memuat turnamen "${loaded.name}" dari Cloud!`, 'success');
      } else {
        setIsSyncing('error');
        showToast('Gagal memuat data turnamen dari cloud. Periksa hak akses Anda.', 'error');
      }
    };

    if (hasUnsavedChanges && tournament.id !== tId) {
      setShowConfirm({
        title: 'Perubahan Belum Disimpan',
        message: 'Turnamen aktif memiliki perubahan lokal yang belum disimpan ke Cloud. Apakah Anda yakin ingin berpindah turnamen?',
        onConfirm: () => {
          setShowConfirm(null);
          doLoad();
        }
      });
      return;
    }

    doLoad();
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
    const result = await saveTournamentToSupabase(tournament);
    if (result.success) {
      setIsSyncing('synced');
      setHasUnsavedChanges(false);
      updateTournamentState(tournament, true);
      showToast('Migrasi Berhasil! Data lokal telah disimpan di database online Supabase.', 'success');
      refreshOnlineTournamentsList();
    } else {
      setIsSyncing('error');
      const errDetail = ('error' in result && result.error.message) ? result.error.message : 'Gagal melakukan migrasi.';
      showToast(`Migrasi gagal: ${errDetail}`, 'error');
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

  // Delete current tournament from Supabase and local state safely
  const handleDeleteCurrentTournament = async () => {
    if (!user) {
      setIsAuthModalOpen(true);
      showToast('Akses Ditolak: Anda harus login ke Akun Cloud untuk menghapus turnamen.', 'error');
      return;
    }

    if (isSyncing === 'syncing') {
      showToast('Proses penghapusan sedang berjalan. Harap tunggu.', 'info');
      return;
    }
    
    setShowConfirm({
      title: 'Hapus Turnamen Permanen',
      message: `Apakah Anda yakin ingin menghapus turnamen "${tournament.name}" ini dari cloud secara permanen? Semua data pendaftaran, grup, skor, dan pertandingan di dalamnya akan dihapus selamanya. Tindakan ini tidak dapat dibatalkan.`,
      onConfirm: async () => {
        setIsSyncing('syncing');
        setShowConfirm(null);
        const deletedId = tournament.id;
        const result = await deleteTournamentFromSupabase(deletedId);
        
        if ('error' in result) {
          // Cloud deletion failed! Maintain local active tournament & LocalStorage untouched
          setIsSyncing('error');
          const err = result.error;
          const errorMsg = `Gagal Menghapus Turnamen [Modul: ${err.module || 'tournament'} | Ops: ${err.operation || 'delete'}]: ${err.message}${err.details ? ` (${err.details})` : ''}`;
          showToast(errorMsg, 'error');
          return;
        }

        // Cloud deletion confirmed! Clear local storage cache for deleted tournament
        try {
          const activeRaw = localStorage.getItem('paindo_active_tournament_v2');
          if (activeRaw) {
            const activeObj = JSON.parse(activeRaw);
            if (activeObj.id === deletedId) {
              localStorage.removeItem('paindo_active_tournament_v2');
              localStorage.removeItem('paindo_active_tournament_backup');
            }
          }
        } catch (e) {
          console.warn('Gagal membersihkan cache LocalStorage setelah delete:', e);
        }

        // Refresh list of remaining user tournaments
        const remainingList = await listUserTournaments();
        setOnlineTournaments(remainingList);

        if (remainingList && remainingList.length > 0) {
          // Automatically switch to the most recent remaining tournament
          const latestRemainingId = remainingList[0].id;
          const loaded = await loadTournamentFromSupabase(latestRemainingId);
          if (loaded) {
            updateTournamentState(loaded, true);
            setIsSyncing('synced');
            setSelectedMenu('dashboard');
            if (loaded.activeDivisions && loaded.activeDivisions.length > 0) {
              setSelectedDivisionId(loaded.activeDivisions[0].id);
            } else {
              setSelectedDivisionId('');
            }
            showToast(`Turnamen berhasil dihapus dari cloud. Menampilkan turnamen tersisa: "${loaded.name}"`, 'success');
          } else {
            setIsSyncing('idle');
          }
        } else {
          // No remaining tournaments left in cloud! Reset active tournament state & LocalStorage
          localStorage.removeItem('paindo_active_tournament_v2');
          localStorage.removeItem('paindo_active_tournament_backup');

          try {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.delete('t');
            currentUrl.searchParams.delete('id');
            window.history.replaceState({}, '', currentUrl.toString());
          } catch (e) {}

          const emptyTemplate: Tournament = {
            id: '',
            name: 'Belum Ada Turnamen',
            date: new Date().toISOString().split('T')[0],
            location: '',
            events: [],
            ageGroups: [],
            activeDivisions: []
          };
          setTournament(emptyTemplate);
          setHasUnsavedChanges(false);
          setIsSyncing('idle');
          setSelectedMenu('config');
          setSelectedDivisionId('');
          showToast('Turnamen berhasil dihapus dari cloud. Tidak ada turnamen tersisa.', 'info');
        }
      }
    });
  };

  // Quick navigation helpers
  const navigateToDivision = (divisionId: string) => {
    setSelectedDivisionId(divisionId);
    setSelectedMenu('div-detail');
    const targetDiv = tournament.activeDivisions.find(d => d.id === divisionId);
    if (targetDiv && targetDiv.groups && targetDiv.groups.length > 0) {
      setDivisionTab('round-robin');
    } else {
      setDivisionTab('groups');
    }
  };

  const currentDiv = tournament.activeDivisions.find(div => div.id === selectedDivisionId);
  const matchedEvent = currentDiv ? tournament.events.find(e => e.id === currentDiv.eventId) : null;
  const isDouble = matchedEvent ? matchedEvent.isDouble : true;

  // Differentiate between Admin and Public/Viewer mode
  const isAdmin = user !== null && (!tournament.ownerId || user.id === tournament.ownerId);

  // Safeguard: Reset selectedMenu to dashboard if non-admin tries to view config page
  useEffect(() => {
    if (!isAdmin && selectedMenu === 'config') {
      setSelectedMenu('dashboard');
    }
  }, [isAdmin, selectedMenu]);

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
              <h1 className="font-black text-sm tracking-tight leading-none uppercase text-neon">Paindo</h1>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-0.5">Turnamen Apps</span>
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
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-1">
                {isSyncing === 'syncing' && (
                  <span className="flex items-center gap-1 text-neon/95 font-semibold">
                    <RefreshCw className="h-3 w-3 animate-spin text-neon" /> Menyimpan data...
                  </span>
                )}
                {isSyncing === 'synced' && !hasUnsavedChanges && !conflictData && tournament.cloudSaveStatus !== 'failed' && (
                  <span className="flex items-center gap-1 text-emerald-400 font-bold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Database Sinkron
                  </span>
                )}
                {conflictData && (
                  <span className="flex items-center gap-1 text-amber-400 font-bold">
                    <AlertCircle className="h-3.5 w-3.5" /> Konflik — Belum Tersimpan
                  </span>
                )}
                {tournament.cloudSaveStatus === 'failed' && !conflictData && (
                  <span className="flex items-center gap-1 text-rose-400 font-bold">
                    <AlertCircle className="h-3.5 w-3.5" /> Gagal — Perlu Pemulihan
                  </span>
                )}
                {hasUnsavedChanges && !conflictData && (
                  <span className="flex items-center gap-1 text-amber-400 font-bold animate-pulse">
                    <AlertCircle className="h-3.5 w-3.5" /> Ada Perubahan Belum Disimpan
                  </span>
                )}
                {isSyncing === 'error' && !conflictData && tournament.cloudSaveStatus !== 'failed' && !hasUnsavedChanges && (
                  <span className="flex items-center gap-1 text-rose-400 font-bold">
                    <AlertCircle className="h-3.5 w-3.5" /> Gagal Sinkronisasi
                  </span>
                )}
              </div>

              {isAdmin && (
                <button
                  onClick={handleManualSaveToCloud}
                  disabled={isSyncing === 'syncing'}
                  className={`w-full py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${
                    hasUnsavedChanges
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-900 border border-amber-300 animate-pulse'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                  id="sidebar-manual-save-btn"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  <span>{hasUnsavedChanges ? 'Simpan Perubahan ke Cloud (!)' : 'Simpan ke Cloud Database'}</span>
                </button>
              )}

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

              {user && (onlineTournaments.some(t => t.id === tournament.id) || tournament.id.startsWith('t-')) && (
                <button
                  onClick={handleDeleteCurrentTournament}
                  disabled={isSyncing === 'syncing'}
                  className="w-full py-1.5 bg-rose-600/15 hover:bg-rose-600/25 text-rose-400 hover:text-rose-300 border border-rose-500/20 rounded-lg text-[10px] font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  id="sidebar-delete-btn"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>{isSyncing === 'syncing' ? 'Menghapus Turnamen...' : 'Hapus Turnamen dari Cloud'}</span>
                </button>
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

            {isAdmin && (
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
            )}
          </div>

          {/* Section: Daftar Divisi Aktif */}
          <div className="space-y-1.5 pt-2">
            <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Divisi Pertandingan Aktif</span>
            
            {tournament.activeDivisions.length === 0 ? (
              <p className="px-3 text-xs text-slate-500 italic leading-relaxed">
                Belum ada divisi aktif.
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

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium" id="top-navbar-stats">
            {/* Local Storage Indicator Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100/80 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200/80" title="Data tersimpan otomatis di browser lokal">
              <HardDrive className="h-3.5 w-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Lokal:</span>
              <span className="font-bold text-slate-800">Tersimpan</span>
              {hasUnsavedChanges && (
                <span className="flex h-2 w-2 relative" title="Ada perubahan belum tersimpan di Cloud Database">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
              )}
            </div>

            {/* Manual Save to Cloud Button */}
            {isAdmin && isSupabaseConfigured && (
              <button
                onClick={handleManualSaveToCloud}
                disabled={isSyncing === 'syncing'}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-black transition duration-200 shadow-sm cursor-pointer disabled:opacity-50 ${
                  hasUnsavedChanges
                    ? 'bg-amber-500 hover:bg-amber-600 text-slate-900 border border-amber-300 animate-pulse'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
                title="Simpan Hasil Pertandingan, Skor, Jadwal & Klasemen ke Database Cloud"
                id="manual-save-cloud-top-btn"
              >
                <CloudUpload className="h-4 w-4" />
                <span>
                  {isSyncing === 'syncing' 
                    ? 'Menyimpan...' 
                    : hasUnsavedChanges 
                      ? 'Simpan ke Cloud (!)' 
                      : 'Simpan ke Cloud'}
                </span>
              </button>
            )}

            {/* Auto-Sync Toggle Switch */}
            {isAdmin && isSupabaseConfigured && (
              <label 
                className="hidden lg:flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer select-none px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition"
                title="Aktifkan untuk menyimpan setiap perubahan ke database secara otomatis"
              >
                <input
                  type="checkbox"
                  checked={autoSyncEnabled}
                  onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                />
                <span className="text-[11px]">Auto-Sync Cloud</span>
              </label>
            )}

            {isAdmin && (
              <button
                onClick={() => exportTournamentToPDF(tournament)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-navy hover:bg-navy-light text-neon font-extrabold rounded-lg text-xs transition duration-200 shadow-xs cursor-pointer"
                title="Ekspor Seluruh Hasil & Hasil Pertandingan ke PDF"
                id="export-pdf-top-btn"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Unduh PDF</span>
              </button>
            )}

            {isSupabaseConfigured && (
              <>
                <button
                  onClick={handleRefreshFromCloud}
                  disabled={isSyncing === 'syncing'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition duration-200 shadow-xs disabled:opacity-50"
                  title="Segarkan Data Terbaru dari Cloud Database"
                  id="refresh-cloud-top-btn"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing === 'syncing' ? 'animate-spin text-neon' : 'text-slate-500'}`} />
                  <span className="hidden sm:inline">{isSyncing === 'syncing' ? 'Memuat...' : 'Segarkan'}</span>
                </button>

                <button
                  onClick={handleShareTournament}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition duration-200 shadow-xs"
                  title="Salin Tautan Pendek Turnamen"
                  id="share-tournament-top-btn"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>Bagikan Link</span>
                </button>
              </>
            )}
            {isTournamentReadOnly(tournament) && (
              <span className="px-2.5 py-1 bg-amber-600 text-white rounded-full font-black text-[10px] uppercase tracking-wider flex items-center gap-1 shadow-xs">
                🔒 Ditutup (Read-Only)
              </span>
            )}
            {!isAdmin && !isTournamentReadOnly(tournament) && (
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
            <div className="space-y-8">
              <OverallSummary tournament={tournament} onNavigateToDivision={navigateToDivision} isAdmin={isAdmin} />
              <TournamentClosureSection
                tournament={tournament}
                onUpdateTournament={updateTournamentState}
                isAdmin={isAdmin}
                currentUserEmail={user?.email || user?.user_metadata?.full_name || 'Admin'}
              />
            </div>
          )}

          {selectedMenu === 'config' && (
            <TournamentConfig tournament={tournament} onChange={handleTournamentUpdate} isAdmin={isAdmin} />
          )}

          {selectedMenu === 'div-detail' && currentDiv && (
            <div className="space-y-6" id="division-details-flow">
              
              {/* Active Division Banner & Quick Switcher */}
              <div className="bg-gradient-to-r from-navy via-navy-light to-navy p-4 rounded-2xl text-white flex flex-wrap items-center justify-between gap-4 card-shadow border border-navy-light" id="active-division-header-banner">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-neon/15 border border-neon/30 flex items-center justify-center shrink-0">
                    <Award className="h-5 w-5 text-neon" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-black tracking-wider text-neon flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-neon animate-pulse" />
                      Divisi Yang Sedang Dibuka
                    </div>
                    <h2 className="text-lg font-black text-white flex items-center gap-2">
                      {currentDiv.eventName} ({currentDiv.ageGroupName})
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <div className="text-xs text-slate-300 hidden sm:flex items-center gap-3 bg-navy-dark/60 px-3 py-1.5 rounded-xl border border-white/10">
                    <span>👥 <strong>{currentDiv.entries.length}</strong> Pasangan</span>
                    <span>🧩 <strong>{currentDiv.groups.length}</strong> Pool</span>
                    <span>⚔️ <strong>{currentDiv.roundRobinMatches.length}</strong> Match</span>
                  </div>

                  {tournament.activeDivisions.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-bold hidden md:inline">Ganti Divisi:</span>
                      <select
                        value={currentDiv.id}
                        onChange={(e) => navigateToDivision(e.target.value)}
                        className="bg-navy-dark text-neon font-black text-xs px-3.5 py-2 rounded-xl border border-neon/40 focus:outline-none focus:ring-2 focus:ring-neon cursor-pointer card-shadow"
                        id="division-quick-switcher"
                      >
                        {tournament.activeDivisions.map(d => (
                          <option key={d.id} value={d.id} className="bg-navy text-white font-medium">
                            {d.eventName} ({d.ageGroupName}) — {d.entries.length} Pasangan
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

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
                  <Users className="h-3.5 w-3.5" /> 1. Peserta ({currentDiv?.entries.length || 0} Pasangan)
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
                  <Grid3X3 className="h-3.5 w-3.5" /> 2. Pembagian Pool ({currentDiv?.groups.length || 0} Pool)
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
                  <ClipboardList className="h-3.5 w-3.5" /> 3. Jadwal Match ({currentDiv?.roundRobinMatches.length || 0})
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
                    isReadOnly={isTournamentReadOnly(tournament)}
                  />
                )}

                {divisionTab === 'groups' && (
                  <DivisionGroups
                    division={currentDiv}
                    onUpdateDivision={handleUpdateDivision}
                    isAdmin={isAdmin}
                    isReadOnly={isTournamentReadOnly(tournament)}
                  />
                )}

                {divisionTab === 'round-robin' && (
                  <DivisionRoundRobin
                    division={currentDiv}
                    onUpdateDivision={handleUpdateDivision}
                    isAdmin={isAdmin}
                    isReadOnly={isTournamentReadOnly(tournament)}
                  />
                )}

                {divisionTab === 'knockout' && (
                  <DivisionKnockout
                    division={currentDiv}
                    onUpdateDivision={handleUpdateDivision}
                    isAdmin={isAdmin}
                    isReadOnly={isTournamentReadOnly(tournament)}
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

      {/* Create Tournament Modal Overlay */}
      <CreateTournamentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateTournament}
      />

      {/* Conflict Resolution Modal Overlay */}
      {conflictData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="concurrency-conflict-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-amber-200 p-6 shadow-2xl transform transition-all animate-scale-up" id="concurrency-conflict-card">
            <div className="flex items-center gap-3 text-amber-600 mb-4">
              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">Data Turnamen Telah Berubah</h3>
                <p className="text-xs text-amber-700 font-semibold">Konflik Penyimpanan Terdeteksi</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Turnamen ini telah diperbarui dari tab atau perangkat lain setelah Anda membukanya. Penyimpanan dibatalkan agar data terbaru di Cloud tidak tertimpa.
            </p>

            <div className="bg-slate-50 rounded-xl p-3 mb-5 border border-slate-200 text-xs text-slate-700 space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Versi Di-edit (Lokal):</span>
                <span className="font-mono font-semibold text-slate-800">
                  Revisi {conflictData.localRevision ?? tournament?.cloudRevision ?? 1}
                  {conflictData.localUpdatedAt ? ` (${new Date(conflictData.localUpdatedAt).toLocaleTimeString('id-ID')})` : ''}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Versi Terbaru Cloud:</span>
                <span className="font-mono font-semibold text-emerald-700">
                  Revisi {conflictData.cloudRevision ?? (tournament?.cloudRevision ? tournament.cloudRevision + 1 : 2)}
                  {conflictData.cloudUpdatedAt ? ` (${new Date(conflictData.cloudUpdatedAt).toLocaleTimeString('id-ID')})` : ''}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                <span className="font-bold text-slate-600">Status Penyimpanan:</span>
                <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[11px] border border-amber-200">Konflik / Belum Tersimpan</span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleReloadCloudVersion}
                className="w-full px-4 py-2.5 bg-navy hover:bg-navy-light text-white font-extrabold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                id="btn-reload-cloud-version"
              >
                <RefreshCw className="w-4 h-4 text-neon" />
                Muat Versi Cloud Terbaru
              </button>
              <button
                type="button"
                onClick={handleKeepLocalVersion}
                className="w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                id="btn-keep-local-version"
              >
                Tetap di Versi Lokal
              </button>
            </div>
          </div>
        </div>
      )}

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
