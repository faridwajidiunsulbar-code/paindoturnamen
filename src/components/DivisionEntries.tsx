/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Division, Entry, DivisionSettings } from '../types';
import { Settings, Users, Plus, Trash2, Edit2, Check, ShieldAlert, Shuffle, Sparkles, UserCheck } from 'lucide-react';

export const PAINDO_PLAYERS = [
  'Farid', 'Iswan', 'Nadja', 'Noor Irwandi', 'Akram', 'Haedar', 'Amri', 'Pandi', 
  'Harfan', 'Arif', 'Dede', 'H. Alimin', "A'ba Uni'", 'Coach Arif', 'Coach Nadir', 
  "A'ba Zidan", 'Faiq', 'Bakri', 'Pak Ahmad', 'Aco', 'Alif', 'Ustadz Mul', 
  'Tamsil', 'Pangeran', 'Irul'
];

interface DivisionEntriesProps {
  division: Division;
  isDouble: boolean;
  onUpdateDivision: (updated: Division) => void;
  isAdmin?: boolean;
}

export default function DivisionEntries({ division, isDouble, onUpdateDivision, isAdmin = true }: DivisionEntriesProps) {
  const [name1, setName1] = useState('');
  const [name2, setName2] = useState('');
  const [affiliation, setAffiliation] = useState('');
  
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editName1, setEditName1] = useState('');
  const [editName2, setEditName2] = useState('');
  const [editAffiliation, setEditAffiliation] = useState('');

  const [showAlert, setShowAlert] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // Dynamic pool of players loaded from localStorage or falling back to defaults
  const [poolPlayers, setPoolPlayers] = useState<string[]>(() => {
    const saved = localStorage.getItem('paindo_pool_players');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // ignore error
      }
    }
    return PAINDO_PLAYERS;
  });

  const [newPlayerName, setNewPlayerName] = useState('');

  // Pool of players currently present/checked for random pairing
  const [checkedPlayers, setCheckedPlayers] = useState<string[]>(() => {
    const saved = localStorage.getItem('paindo_pool_players');
    let players = PAINDO_PLAYERS;
    if (saved) {
      try {
        players = JSON.parse(saved);
      } catch (e) {}
    }
    // Default to first 24 players (or all if less than 24)
    return players.slice(0, Math.min(24, players.length));
  });

  // Helper to save pool players and update state
  const updatePoolPlayersList = (newPool: string[]) => {
    setPoolPlayers(newPool);
    localStorage.setItem('paindo_pool_players', JSON.stringify(newPool));
  };

  const handleAddPoolPlayer = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPlayerName.trim();
    if (!name) return;
    if (poolPlayers.includes(name)) {
      setShowAlert({
        title: 'Nama Sudah Ada',
        message: `Pemain dengan nama "${name}" sudah ada di pool.`
      });
      return;
    }
    const updated = [...poolPlayers, name];
    updatePoolPlayersList(updated);
    setCheckedPlayers([...checkedPlayers, name]);
    setNewPlayerName('');
  };

  const handleRemovePoolPlayer = (player: string) => {
    const updated = poolPlayers.filter(p => p !== player);
    updatePoolPlayersList(updated);
    setCheckedPlayers(checkedPlayers.filter(p => p !== player));
  };

  const handleTogglePlayer = (player: string) => {
    if (checkedPlayers.includes(player)) {
      setCheckedPlayers(checkedPlayers.filter(p => p !== player));
    } else {
      setCheckedPlayers([...checkedPlayers, player]);
    }
  };

  const handleSelectAllPlayers = () => {
    setCheckedPlayers(poolPlayers);
  };

  const handleClearAllPlayers = () => {
    setCheckedPlayers([]);
  };

  // Fisher-Yates Random Pairing Generator
  const handleRandomizePairs = () => {
    if (checkedPlayers.length < 2) {
      setShowAlert({
        title: 'Jumlah Pemain Kurang',
        message: 'Silakan pilih minimal 2 pemain dari Pool untuk diacak menjadi pasangan.'
      });
      return;
    }

    const players = [...checkedPlayers];
    // Shuffle
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }

    const timestamp = Date.now();
    const randomizedPairs: Entry[] = [];
    
    for (let i = 0; i < players.length; i += 2) {
      if (i + 1 < players.length) {
        randomizedPairs.push({
          id: `ent-rnd-${i}-${timestamp}`,
          name1: players[i],
          name2: players[i + 1],
          affiliation: 'Internal Paindo'
        });
      } else {
        // Handle odd player
        randomizedPairs.push({
          id: `ent-rnd-${i}-${timestamp}`,
          name1: players[i],
          name2: 'BYE / Pemain Cadangan',
          affiliation: 'Internal Paindo'
        });
      }
    }

    onUpdateDivision({
      ...division,
      entries: randomizedPairs,
      groups: [],
      roundRobinMatches: [],
      knockoutStage: null,
      champions: null
    });

    setShowAlert({
      title: 'Pasangan Berhasil Diacak! 🔀',
      message: `Berhasil mengacak ${randomizedPairs.length} pasang ganda dari total ${checkedPlayers.length} pemain aktif. Semua grup & pertandingan sebelumnya diset ulang.`
    });
  };

  // Update setting field
  const updateSetting = <K extends keyof DivisionSettings>(key: K, value: DivisionSettings[K]) => {
    onUpdateDivision({
      ...division,
      settings: {
        ...division.settings,
        [key]: value
      }
    });
  };

  // Add new entry
  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name1.trim()) return;
    if (isDouble && !name2.trim()) return;

    const newEntry: Entry = {
      id: `ent-${Date.now()}`,
      name1: name1.trim(),
      name2: isDouble ? name2.trim() : undefined,
      affiliation: affiliation.trim() || undefined
    };

    onUpdateDivision({
      ...division,
      entries: [...division.entries, newEntry]
    });

    // Reset inputs
    setName1('');
    setName2('');
    setAffiliation('');
  };

  // Generate 12 custom double pairs
  const handleGenerateUser12Pairs = () => {
    const timestamp = Date.now();
    const customPairs: Entry[] = [
      { id: `ent-usr-1-${timestamp}`, name1: 'Farid', name2: 'Iswan', affiliation: 'Bebas' },
      { id: `ent-usr-2-${timestamp}`, name1: 'Nadja', name2: 'Noor Irwandi', affiliation: 'Bebas' },
      { id: `ent-usr-3-${timestamp}`, name1: 'Akram', name2: 'Haedar', affiliation: 'Bebas' },
      { id: `ent-usr-4-${timestamp}`, name1: 'Amri', name2: 'Pandi', affiliation: 'Bebas' },
      { id: `ent-usr-5-${timestamp}`, name1: 'Harfan', name2: 'Arif', affiliation: 'Bebas' },
      { id: `ent-usr-6-${timestamp}`, name1: 'Dede', name2: 'H. Alimin', affiliation: 'Bebas' },
      { id: `ent-usr-7-${timestamp}`, name1: "A'ba Uni'", name2: 'Coach Arif', affiliation: 'Bebas' },
      { id: `ent-usr-8-${timestamp}`, name1: 'Coach Nadir', name2: "A'ba Zidan", affiliation: 'Bebas' },
      { id: `ent-usr-9-${timestamp}`, name1: 'Faiq', name2: 'Bakri', affiliation: 'Bebas' },
      { id: `ent-usr-10-${timestamp}`, name1: 'Pak Ahmad', name2: 'Aco', affiliation: 'Bebas' },
      { id: `ent-usr-11-${timestamp}`, name1: 'Alif', name2: 'Ustadz Mul', affiliation: 'Bebas' },
      { id: `ent-usr-12-${timestamp}`, name1: 'Tamsil', name2: 'Pangeran', affiliation: 'Bebas' }
    ];

    onUpdateDivision({
      ...division,
      entries: customPairs,
      groups: [],
      roundRobinMatches: [],
      knockoutStage: null,
      champions: null
    });
  };

  // Start inline editing
  const startEdit = (entry: Entry) => {
    setEditingEntryId(entry.id);
    setEditName1(entry.name1);
    setEditName2(entry.name2 || '');
    setEditAffiliation(entry.affiliation || '');
  };

  // Save inline edit
  const saveEdit = (id: string) => {
    if (!editName1.trim()) return;
    if (isDouble && !editName2.trim()) return;

    const updatedEntries = division.entries.map(ent => {
      if (ent.id === id) {
        return {
          ...ent,
          name1: editName1.trim(),
          name2: isDouble ? editName2.trim() : undefined,
          affiliation: editAffiliation.trim() || undefined
        };
      }
      return ent;
    });

    onUpdateDivision({
      ...division,
      entries: updatedEntries
    });

    setEditingEntryId(null);
  };

  // Remove entry
  const removeEntry = (id: string) => {
    // Check if entry is in a group or match before deleting
    const isInGroup = division.groups.some(g => g.entryIds.includes(id));
    if (isInGroup) {
      setShowAlert({
        title: 'Peserta Sudah Masuk Grup',
        message: 'Peserta tidak bisa dihapus karena sudah dimasukkan ke dalam Grup. Silakan keluarkan peserta dari grup terlebih dahulu.'
      });
      return;
    }

    onUpdateDivision({
      ...division,
      entries: division.entries.filter(ent => ent.id !== id)
    });
  };

  return (
    <div className="space-y-8" id="division-entries-panel">
      
      {/* SECTION 1: SETTINGS / ATURAN DIVISI */}
      <section className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow" id="div-rules-section">
        <h3 className="text-base font-extrabold text-navy mb-4 flex items-center gap-2">
          <Settings className="h-5 w-5 text-neon stroke-navy fill-neon" />
          Pengaturan Aturan Divisi: {division.eventName} {division.ageGroupName}
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" id="settings-grid">
          {/* Format Pertandingan */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Format Pertandingan</label>
            <span className="inline-block px-3 py-2 bg-neon/15 border border-neon/30 rounded-lg text-sm font-extrabold text-navy w-full">
              Round Robin + Knockout (Fase Grup & Gugur)
            </span>
          </div>

          {/* Target Skor */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Target Skor Game</label>
            <select
              value={division.settings.targetScore}
              onChange={(e) => updateSetting('targetScore', parseInt(e.target.value) as 11 | 15 | 21)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-sm text-slate-700 bg-white disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed"
            >
              <option value="11">11 Poin</option>
              <option value="15">15 Poin</option>
              <option value="21">21 Poin</option>
            </select>
          </div>

          {/* Win by 2 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Win by 2 (Selisih 2)</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => updateSetting('winByTwo', true)}
                disabled={!isAdmin}
                className={`flex-1 py-2 text-sm font-extrabold rounded-lg border transition ${
                  division.settings.winByTwo
                    ? 'bg-navy text-neon border-navy card-shadow'
                    : 'bg-white text-slate-600 border-slate-250 hover:bg-slate-50'
                } disabled:opacity-75 disabled:cursor-not-allowed`}
              >
                Ya
              </button>
              <button
                type="button"
                onClick={() => updateSetting('winByTwo', false)}
                disabled={!isAdmin}
                className={`flex-1 py-2 text-sm font-extrabold rounded-lg border transition ${
                  !division.settings.winByTwo
                    ? 'bg-navy text-neon border-navy card-shadow'
                    : 'bg-white text-slate-600 border-slate-250 hover:bg-slate-50'
                } disabled:opacity-75 disabled:cursor-not-allowed`}
              >
                Tidak
              </button>
            </div>
          </div>

          {/* Jumlah Peserta Per Grup */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Kapasitas Grup (Peserta)</label>
            <select
              value={division.settings.playersPerGroup}
              onChange={(e) => updateSetting('playersPerGroup', parseInt(e.target.value) as 3 | 4 | 5)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-sm text-slate-700 bg-white disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed"
            >
              <option value="3">3 Peserta per Grup</option>
              <option value="4">4 Peserta per Grup</option>
              <option value="5">5 Peserta per Grup</option>
            </select>
          </div>

          {/* Jumlah Peserta Lolos Per Grup */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Lolos Langsung Per Grup</label>
            <select
              value={division.settings.playersQualifyingPerGroup}
              onChange={(e) => updateSetting('playersQualifyingPerGroup', parseInt(e.target.value))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-sm text-slate-700 bg-white disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed"
            >
              <option value="1">Peringkat 1 Terbaik</option>
              <option value="2">Peringkat 1 & 2 Terbaik</option>
              <option value="3">Peringkat 1, 2, & 3 Terbaik</option>
            </select>
          </div>

          {/* Bracket Knockout */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Ukuran Bracket Gugur</label>
            <select
              value={division.settings.bracketSize}
              onChange={(e) => updateSetting('bracketSize', parseInt(e.target.value) as 4 | 8 | 16 | 32)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-sm text-slate-700 bg-white disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed"
            >
              <option value="4">Semifinal (4 Besar)</option>
              <option value="8">Perempat Final (8 Besar)</option>
              <option value="16">16 Besar</option>
              <option value="32">32 Besar</option>
            </select>
          </div>

          {/* Wildcard Active */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Wildcard Kelolosan</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => updateSetting('wildcardActive', true)}
                disabled={!isAdmin}
                className={`flex-1 py-2 text-sm font-extrabold rounded-lg border transition ${
                  division.settings.wildcardActive
                    ? 'bg-navy text-neon border-navy card-shadow'
                    : 'bg-white text-slate-600 border-slate-250 hover:bg-slate-50'
                } disabled:opacity-75 disabled:cursor-not-allowed`}
                title="Mengambil runner-up/peringkat 3 terbaik dari lintas grup jika kuota bracket belum terpenuhi"
              >
                Aktif
              </button>
              <button
                type="button"
                onClick={() => updateSetting('wildcardActive', false)}
                disabled={!isAdmin}
                className={`flex-1 py-2 text-sm font-extrabold rounded-lg border transition ${
                  !division.settings.wildcardActive
                    ? 'bg-navy text-neon border-navy card-shadow'
                    : 'bg-white text-slate-600 border-slate-250 hover:bg-slate-50'
                } disabled:opacity-75 disabled:cursor-not-allowed`}
              >
                Nonaktif
              </button>
            </div>
          </div>

          {/* Bye Active */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Fitur BYE di Bracket</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => updateSetting('byeActive', true)}
                disabled={!isAdmin}
                className={`flex-1 py-2 text-sm font-extrabold rounded-lg border transition ${
                  division.settings.byeActive
                    ? 'bg-navy text-neon border-navy card-shadow'
                    : 'bg-white text-slate-600 border-slate-250 hover:bg-slate-50'
                } disabled:opacity-75 disabled:cursor-not-allowed`}
              >
                Aktif
              </button>
              <button
                type="button"
                onClick={() => updateSetting('byeActive', false)}
                disabled={!isAdmin}
                className={`flex-1 py-2 text-sm font-extrabold rounded-lg border transition ${
                  !division.settings.byeActive
                    ? 'bg-navy text-neon border-navy card-shadow'
                    : 'bg-white text-slate-600 border-slate-250 hover:bg-slate-50'
                } disabled:opacity-75 disabled:cursor-not-allowed`}
              >
                Nonaktif
              </button>
            </div>
          </div>
        </div>
        
        {division.groups.length > 0 && (
          <div className="mt-4 flex items-center gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg border border-amber-100 text-xs">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>
              <strong>Perhatian:</strong> Grup telah dibentuk di divisi ini. Mengubah kapasitas grup atau aturan kelolosan dapat mempengaruhi struktur grup dan jadwal pertandingan yang ada.
            </span>
          </div>
        )}
      </section>

      {/* SECTION: POOL PEMAIN INTERNAL PAINDO */}
      {isAdmin && isDouble && (
        <section className="bg-slate-50 rounded-2xl border border-slate-200 p-6 card-shadow animate-fade-in" id="paindo-pool-section">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-500 fill-emerald-100" />
                Pool Pemain Klub Internal Paindo ({checkedPlayers.length}/{poolPlayers.length} Hadir)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Centang anggota yang hadir/aktif hari ini, lalu acak pasangannya secara otomatis. Anda juga bisa menambah/menghapus pemain dari pool ini.
              </p>
            </div>
            <div className="flex gap-2 text-right">
              <button
                type="button"
                onClick={handleSelectAllPlayers}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold transition"
              >
                Centang Semua
              </button>
              <button
                type="button"
                onClick={handleClearAllPlayers}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold transition"
              >
                Hapus Semua Centang
              </button>
            </div>
          </div>

          {/* Form to add a new player to pool */}
          <form onSubmit={handleAddPoolPlayer} className="flex gap-2 mb-4 bg-white p-3 rounded-xl border border-slate-150">
            <input
              type="text"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              placeholder="Ketik nama anggota klub baru untuk ditambahkan ke Pool..."
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/15 text-xs text-slate-800 transition"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black transition flex items-center gap-1 shrink-0 shadow-xs"
            >
              <Plus className="h-3 w-3 stroke-[3]" /> Tambah ke Pool
            </button>
          </form>

          {/* Player Pool List */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 p-4 bg-white rounded-xl border border-slate-150 max-h-56 overflow-y-auto mb-5">
            {poolPlayers.map(player => {
              const isChecked = checkedPlayers.includes(player);
              return (
                <div
                  key={player}
                  className={`group relative flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold transition ${
                    isChecked
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 shadow-xs'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  <label className="flex items-center gap-2 flex-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleTogglePlayer(player)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>{player}</span>
                  </label>
                  
                  {/* Delete button from pool */}
                  <button
                    type="button"
                    onClick={() => handleRemovePoolPlayer(player)}
                    title={`Hapus ${player} dari Pool`}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 hover:text-red-600 rounded text-slate-400 transition ml-1"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-emerald-50/50 rounded-xl border border-emerald-100/70">
            <div className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
              <UserCheck className="h-4 w-4 text-emerald-600" />
              <span>
                Dengan <strong>{checkedPlayers.length} pemain</strong> terpilih, Anda dapat menghasilkan{' '}
                <strong>{Math.floor(checkedPlayers.length / 2)} pasang ganda</strong>.
                {checkedPlayers.length % 2 !== 0 && (
                  <span className="text-amber-600 ml-1">
                    (Jumlah ganjil, 1 orang akan dipasangkan dengan BYE)
                  </span>
                )}
              </span>
            </div>
            
            <button
              type="button"
              onClick={handleRandomizePairs}
              className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-black text-xs flex items-center justify-center gap-2 transition card-shadow hover:-translate-y-0.5 active:translate-y-0"
              id="btn-random-pairings"
            >
              <Shuffle className="h-4 w-4" /> 🔀 Acak Pasangan Sekarang!
            </button>
          </div>
        </section>
      )}

      {/* SECTION 2: ENTRY / PENDAFTARAN PESERTA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="entries-grid-panel">
        
        {/* ADD ENTRY FORM */}
        {isAdmin && (
          <div className="lg:col-span-1" id="add-entry-panel">
            <div className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow sticky top-4">
              <h3 className="text-base font-extrabold text-navy mb-4 flex items-center gap-2">
                <Plus className="h-5 w-5 text-neon stroke-navy fill-neon" />
                Daftarkan Peserta Baru
              </h3>

              <form onSubmit={handleAddEntry} className="space-y-4" id="entry-form">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    {isDouble ? 'Nama Pemain 1' : 'Nama Pemain'}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      id="entry-player-1-input"
                      required
                      value={name1}
                      onChange={(e) => setName1(e.target.value)}
                      placeholder="Nama Lengkap"
                      className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-sm text-slate-800 transition"
                    />
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          setName1(e.target.value);
                          e.target.value = ''; // reset
                        }
                      }}
                      className="px-2 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 focus:outline-none focus:ring-2 focus:ring-navy/15 cursor-pointer hover:bg-slate-100 transition"
                    >
                      <option value="">Pilih...</option>
                      {poolPlayers.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {isDouble && (
                  <div className="space-y-1 animate-slide-down">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                      Nama Pemain 2 (Partner)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        id="entry-player-2-input"
                        required
                        value={name2}
                        onChange={(e) => setName2(e.target.value)}
                        placeholder="Nama Pasangan"
                        className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-sm text-slate-800 transition"
                      />
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            setName2(e.target.value);
                            e.target.value = ''; // reset
                          }
                        }}
                        className="px-2 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 focus:outline-none focus:ring-2 focus:ring-navy/15 cursor-pointer hover:bg-slate-100 transition"
                      >
                        <option value="">Pilih...</option>
                        {poolPlayers.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    Asal Klub / Kota (Opsional)
                  </label>
                  <input
                    type="text"
                    id="entry-affiliation-input"
                    value={affiliation}
                    onChange={(e) => setAffiliation(e.target.value)}
                    placeholder="Klub / Daerah Asal"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-sm text-slate-800 transition"
                  />
                </div>

                <button
                  type="submit"
                  id="submit-entry-button"
                  className="w-full py-3 bg-navy hover:bg-navy-light text-neon rounded-lg font-extrabold transition text-sm flex items-center justify-center gap-2 card-shadow"
                >
                  <Plus className="h-4 w-4 text-neon" /> Daftar Peserta
                </button>

                {isDouble && (
                  <div className="pt-4 border-t border-slate-100 mt-4">
                    <div className="text-xs font-semibold text-slate-400 mb-2 text-center uppercase tracking-wider">
                      Pilihan Auto-Generate
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateUser12Pairs}
                      className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-lg font-extrabold transition text-xs flex items-center justify-center gap-2"
                      id="generate-12-pairs-button"
                    >
                      ⚡ Auto-Generate 12 Pasang Ganda Putra Open
                    </button>
                    <p className="text-[10px] text-slate-400 text-center mt-1">
                      Mengisi otomatis 12 pasang pemain (Farid, Iswan, dkk)
                    </p>
                  </div>
                )}
              </form>
            </div>
          </div>
        )}

        {/* LIST OF ENTRIES */}
        <div className={isAdmin ? "lg:col-span-2" : "lg:col-span-3"} id="entries-list-panel">
          <div className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
                <Users className="h-5 w-5 text-neon stroke-navy fill-neon" />
                Daftar Peserta Terdaftar ({division.entries.length})
              </h3>
            </div>

            {division.entries.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl" id="empty-entries">
                <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-500">Belum ada peserta yang didaftarkan.</p>
                <p className="text-xs text-slate-400 mt-1">Gunakan form di samping untuk menginput peserta.</p>
              </div>
            ) : (
              <div className="overflow-x-auto" id="entries-table-container">
                <table className="w-full text-left border-collapse" id="entries-table">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-150 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="p-3 w-12 text-center">No</th>
                      <th className="p-3">Pemain</th>
                      <th className="p-3">Afiliasi/Klub</th>
                      {isAdmin && <th className="p-3 w-28 text-center">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 text-sm">
                    {division.entries.map((entry, index) => {
                      const isEditing = editingEntryId === entry.id;
                      
                      return (
                        <tr key={entry.id} className="hover:bg-slate-50/50 transition" id={`entry-row-${entry.id}`}>
                          <td className="p-3 text-center text-slate-400 font-mono">{index + 1}</td>
                                              <td className="p-3">
                            {isEditing ? (
                              <div className="space-y-1.5" id={`edit-inputs-container-${entry.id}`}>
                                <div className="flex gap-1.5">
                                  <input
                                    type="text"
                                    id={`edit-player-1-${entry.id}`}
                                    value={editName1}
                                    onChange={(e) => setEditName1(e.target.value)}
                                    className="px-2 py-1 rounded border border-slate-200 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-navy"
                                    placeholder="Nama Pemain 1"
                                  />
                                  <select
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        setEditName1(e.target.value);
                                        e.target.value = '';
                                      }
                                    }}
                                    className="px-1 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 focus:outline-none"
                                  >
                                    <option value="">Pilih...</option>
                                    {poolPlayers.map(p => (
                                      <option key={p} value={p}>{p}</option>
                                    ))}
                                  </select>
                                </div>
                                {isDouble && (
                                  <div className="flex gap-1.5">
                                    <input
                                      type="text"
                                      id={`edit-player-2-${entry.id}`}
                                      value={editName2}
                                      onChange={(e) => setEditName2(e.target.value)}
                                      className="px-2 py-1 rounded border border-slate-200 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-navy"
                                      placeholder="Nama Pemain 2"
                                    />
                                    <select
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          setEditName2(e.target.value);
                                          e.target.value = '';
                                        }
                                      }}
                                      className="px-1 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 focus:outline-none"
                                    >
                                      <option value="">Pilih...</option>
                                      {poolPlayers.map(p => (
                                        <option key={p} value={p}>{p}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="font-semibold text-slate-700">
                                {entry.name1}
                                {entry.name2 ? <span className="text-slate-400 font-normal"> / {entry.name2}</span> : ''}
                              </div>
                            )}
                          </td>
                          
                          <td className="p-3">
                            {isEditing ? (
                              <input
                                type="text"
                                id={`edit-affiliation-${entry.id}`}
                                value={editAffiliation}
                                onChange={(e) => setEditAffiliation(e.target.value)}
                                className="px-2 py-1 rounded border border-slate-200 text-sm w-full focus:outline-none focus:ring-1 focus:ring-navy"
                                placeholder="Klub"
                              />
                            ) : (
                              <span className="text-slate-500 font-medium">
                                {entry.affiliation || '-'}
                              </span>
                            )}
                          </td>
                          
                          {isAdmin && (
                            <td className="p-3 text-center">
                              {isEditing ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => saveEdit(entry.id)}
                                    className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-200 hover:bg-emerald-100 transition"
                                    title="Simpan perubahan"
                                    id={`save-edit-button-${entry.id}`}
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => setEditingEntryId(null)}
                                    className="p-1.5 bg-slate-50 text-slate-500 rounded-lg border border-slate-200 hover:bg-slate-100 transition text-xs"
                                    id={`cancel-edit-button-${entry.id}`}
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => startEdit(entry)}
                                    className="p-1.5 text-slate-400 hover:text-navy hover:bg-slate-50 rounded-lg transition"
                                    title="Edit peserta"
                                    id={`edit-entry-button-${entry.id}`}
                                  >
                                    <Edit2 className="h-4 w-4 text-navy" />
                                  </button>
                                  <button
                                    onClick={() => removeEntry(entry.id)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-50 rounded-lg transition"
                                    title="Hapus peserta"
                                    id={`delete-entry-button-${entry.id}`}
                                  >
                                    <Trash2 className="h-4 w-4 text-rose-500" />
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>

      {showAlert && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="custom-alert-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl transform transition-all animate-scale-up" id="custom-alert-card">
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-amber-50 border border-amber-200 text-amber-600 font-bold text-lg shrink-0">⚠️</span>
              {showAlert.title}
            </h3>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              {showAlert.message}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowAlert(null)}
                className="px-5 py-2.5 text-sm font-extrabold text-navy hover:text-navy-light bg-neon/15 hover:bg-neon/30 border border-neon/40 rounded-lg transition"
                id="alert-close-button"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
