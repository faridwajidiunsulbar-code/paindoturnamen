/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Division, Group, Entry, Match } from '../types';
import { generateRoundRobinMatches } from '../utils/tournamentHelpers';
import { Plus, Trash2, ArrowRight, X, Play, RefreshCw, AlertCircle, HelpCircle } from 'lucide-react';

interface DivisionGroupsProps {
  division: Division;
  onUpdateDivision: (updated: Division) => void;
  isAdmin?: boolean;
}

export default function DivisionGroups({ division, onUpdateDivision, isAdmin = true }: DivisionGroupsProps) {
  const { entries, groups, settings, roundRobinMatches } = division;

  // Local state for editing groups before locking/saving
  const [localGroups, setLocalGroups] = useState<Group[]>(() => {
    return groups.length > 0 ? groups : [
      { id: 'grp-a', name: 'Grup A', entryIds: [] },
      { id: 'grp-b', name: 'Grup B', entryIds: [] }
    ];
  });

  // Custom modal states to bypass standard browser alert/confirm iframe limits
  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [showAlert, setShowAlert] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // Calculate unassigned entries
  const assignedEntryIds = new Set(localGroups.flatMap(g => g.entryIds));
  const unassignedEntries = entries.filter(e => !assignedEntryIds.has(e.id));

  // Add a new empty group
  const addGroup = () => {
    const nextCode = String.fromCharCode(65 + localGroups.length); // A, B, C, D...
    const newGroup: Group = {
      id: `grp-${nextCode.toLowerCase()}-${Date.now()}`,
      name: `Grup ${nextCode}`,
      entryIds: []
    };
    setLocalGroups([...localGroups, newGroup]);
  };

  // Delete a group and release its entries back to unassigned
  const removeGroup = (groupId: string) => {
    if (localGroups.length <= 1) {
      setShowAlert({
        title: 'Batas Grup',
        message: 'Minimal harus ada 1 grup.'
      });
      return;
    }
    const updated = localGroups.filter(g => g.id !== groupId);
    // Re-adjust names (A, B, C...)
    const renamed = updated.map((g, index) => ({
      ...g,
      name: `Grup ${String.fromCharCode(65 + index)}`
    }));
    setLocalGroups(renamed);
  };

  // Move entry to specific group
  const moveEntryToGroup = (entryId: string, groupId: string) => {
    // Remove from any other group first
    const updated = localGroups.map(g => {
      let ids = g.entryIds.filter(id => id !== entryId);
      if (g.id === groupId) {
        // Check if group is already full
        if (ids.length >= settings.playersPerGroup) {
          setShowAlert({
            title: 'Kapasitas Grup',
            message: `Peringatan: ${g.name} sudah mencapai batas kapasitas maksimal (${settings.playersPerGroup} peserta). Namun Anda tetap bisa menambahkannya jika diperlukan.`
          });
        }
        ids = [...ids, entryId];
      }
      return { ...g, entryIds: ids };
    });
    setLocalGroups(updated);
  };

  // Remove entry from group (make unassigned)
  const removeEntryFromGroup = (entryId: string, groupId: string) => {
    const updated = localGroups.map(g => {
      if (g.id === groupId) {
        return { ...g, entryIds: g.entryIds.filter(id => id !== entryId) };
      }
      return g;
    });
    setLocalGroups(updated);
  };

  // Distribute unassigned entries randomly to groups (auto-assign/smart helper)
  const autoDistribute = () => {
    if (unassignedEntries.length === 0) return;
    const shuffled = [...unassignedEntries].sort(() => Math.random() - 0.5);
    const updated = localGroups.map(g => ({ ...g, entryIds: [...g.entryIds] }));
    
    shuffled.forEach((entry, idx) => {
      // Find group with fewest entries
      let targetGroup = updated[0];
      for (let i = 1; i < updated.length; i++) {
        if (updated[i].entryIds.length < targetGroup.entryIds.length) {
          targetGroup = updated[i];
        }
      }
      targetGroup.entryIds.push(entry.id);
    });

    setLocalGroups(updated);
  };

  // Lock groups and generate round robin matches
  const handleLockAndGenerate = () => {
    // 1. Validation
    const emptyGroups = localGroups.filter(g => g.entryIds.length === 0);
    if (emptyGroups.length > 0) {
      setShowAlert({
        title: 'Grup Kosong',
        message: 'Semua grup harus memiliki peserta. Harap isi atau hapus grup yang kosong.'
      });
      return;
    }

    const underpopulatedGroups = localGroups.filter(g => g.entryIds.length < 2);
    if (underpopulatedGroups.length > 0) {
      setShowAlert({
        title: 'Peserta Kurang',
        message: 'Minimal di dalam satu grup harus ada 2 peserta agar bisa saling bertanding.'
      });
      return;
    }

    const proceedGenerate = () => {
      // Generate all matches
      let allMatches: Match[] = [];
      localGroups.forEach(g => {
        const groupMatches = generateRoundRobinMatches(division.id, g, entries);
        allMatches = [...allMatches, ...groupMatches];
      });

      // Save to main state
      onUpdateDivision({
        ...division,
        groups: localGroups,
        roundRobinMatches: allMatches,
        // Reset knockout and champions since we reseeded the groups
        knockoutStage: null,
        champions: null
      });
      setShowConfirm(null);
    };

    const checkScoresAndMatches = () => {
      const hasScoresEntered = roundRobinMatches.some(m => m.status !== 'belum_dimainkan');
      if (hasScoresEntered) {
        setShowConfirm({
          title: 'Skor Pertandingan Akan Terhapus',
          message: 'Peringatan: Turnamen sudah berjalan dan beberapa skor pertandingan telah diinput. Jika Anda membuat jadwal baru, semua hasil pertandingan saat ini akan terhapus secara permanen. Apakah Anda yakin ingin mengulang?',
          onConfirm: proceedGenerate
        });
      } else if (roundRobinMatches.length > 0) {
        setShowConfirm({
          title: 'Buat Ulang Jadwal',
          message: 'Jadwal pertandingan sudah ada. Apakah Anda ingin membuat ulang jadwal baru berdasarkan pembagian grup yang baru?',
          onConfirm: proceedGenerate
        });
      } else {
        proceedGenerate();
      }
    };

    if (unassignedEntries.length > 0) {
      setShowConfirm({
        title: 'Peserta Belum Masuk Grup',
        message: `Ada ${unassignedEntries.length} peserta yang belum masuk grup. Apakah Anda ingin melanjutkan dan mengabaikan peserta tersebut?`,
        onConfirm: checkScoresAndMatches
      });
    } else {
      checkScoresAndMatches();
    }
  };

  return (
    <div className="space-y-8" id="division-groups-panel">
      
      {/* EXPLANATORY HEADER & AUTO GENERATION ACTION */}
      <div className="bg-slate-50 border border-slate-150 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 card-shadow" id="groups-info-bar">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-navy flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-neon stroke-navy fill-neon" />
            Panduan Pembagian Grup Manual
          </h3>
          <p className="text-xs text-slate-500 max-w-2xl">
            Sistem Pickleball Tournament Manager mendukung pembagian grup manual untuk fleksibilitas penuh panitia. Geser peserta ke dalam grup masing-masing, lalu klik tombol <strong>Generate Jadwal</strong> untuk mematangkan fase grup round robin.
          </p>
        </div>
        
        {isAdmin && unassignedEntries.length > 0 && (
          <button
            type="button"
            onClick={autoDistribute}
            className="px-4 py-2 bg-neon/15 hover:bg-neon/30 text-navy text-xs font-extrabold rounded-lg border border-neon/30 transition flex items-center gap-1 md:self-center card-shadow"
            id="auto-distribute-button"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Bagi Grup Otomatis (Acak)
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="groups-layout-grid">
        
        {/* PANEL KIRI: DAFTAR PESERTA BELUM MASUK GRUP */}
        {isAdmin && (
          <div className="lg:col-span-1" id="unassigned-pool-panel">
            <div className="bg-white rounded-2xl border border-slate-150 p-5 card-shadow sticky top-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-150">
                <h3 className="text-sm font-extrabold text-navy">
                  Belum Masuk Grup ({unassignedEntries.length})
                </h3>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-semibold rounded-full font-mono">
                  Pool
                </span>
              </div>

              {unassignedEntries.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs" id="no-unassigned">
                  Semua peserta telah masuk grup. 👍
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1" id="unassigned-list">
                  {unassignedEntries.map(entry => {
                    const label = `${entry.name1}${entry.name2 ? ` / ${entry.name2}` : ''}`;
                    return (
                      <div
                        key={entry.id}
                        className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-150 rounded-xl flex items-center justify-between text-xs transition"
                        id={`unassigned-entry-${entry.id}`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-semibold text-slate-700 truncate" title={label}>{label}</div>
                          {entry.affiliation && (
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">{entry.affiliation}</div>
                          )}
                        </div>
                        
                        {/* Move Dropdown/Buttons */}
                        <div className="flex gap-1 shrink-0">
                          {localGroups.map(g => (
                            <button
                              key={g.id}
                              onClick={() => moveEntryToGroup(entry.id, g.id)}
                              className="px-2 py-1 bg-white hover:bg-navy hover:text-neon text-slate-700 rounded border border-slate-200 hover:border-navy font-bold transition"
                              title={`Masukkan ke ${g.name}`}
                              id={`assign-${entry.id}-to-${g.id}`}
                            >
                              {g.name.replace('Grup ', '')}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PANEL KANAN: GRUP YANG TERBENTUK */}
        <div className={isAdmin ? "lg:col-span-2 space-y-6" : "lg:col-span-3 space-y-6"} id="groups-list-panel">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-navy">
              Pengaturan Grup ({localGroups.length})
            </h3>
            {isAdmin && (
              <button
                onClick={addGroup}
                className="px-3 py-1.5 bg-navy hover:bg-navy-light text-neon rounded-lg text-xs font-extrabold transition flex items-center gap-1 card-shadow"
                id="add-group-button"
              >
                <Plus className="h-3.5 w-3.5 text-neon" /> Tambah Grup
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="groups-cards-grid">
            {localGroups.map((g, gIndex) => (
              <div
                key={g.id}
                className="bg-white rounded-2xl border border-slate-150 p-5 card-shadow flex flex-col min-h-[220px] hover:border-neon/30 transition-colors duration-200"
                id={`group-card-${g.id}`}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-150">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-navy">{g.name}</span>
                    <span className="px-2 py-0.5 bg-neon/15 text-navy text-[10px] font-extrabold rounded-full border border-neon/30">
                      {g.entryIds.length} / {settings.playersPerGroup} Tim
                    </span>
                  </div>
                  
                  {isAdmin && (
                    <button
                      onClick={() => removeGroup(g.id)}
                      className="p-1 text-slate-400 hover:text-rose-500 rounded transition"
                      title="Hapus Grup"
                      id={`delete-group-button-${g.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    </button>
                  )}
                </div>

                {/* Card Content: Entries inside group */}
                <div className="space-y-1.5 flex-1" id={`group-entries-list-${g.id}`}>
                  {g.entryIds.length === 0 ? (
                    <div className="text-center py-10 text-slate-300 text-xs border border-dashed border-slate-150 rounded-xl h-full flex flex-col justify-center items-center">
                      Grup Kosong
                      {isAdmin && <span className="text-[10px] text-slate-400 mt-1">Gunakan tombol grup di sisi kiri</span>}
                    </div>
                  ) : (
                    g.entryIds.map((id, idx) => {
                      const entry = entries.find(e => e.id === id);
                      if (!entry) return null;
                      const label = `${entry.name1}${entry.name2 ? ` / ${entry.name2}` : ''}`;
                      
                      return (
                        <div
                          key={id}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-150 text-xs"
                          id={`group-entry-${g.id}-${id}`}
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-mono text-slate-450 mr-1.5">{idx + 1}.</span>
                            <span className="font-semibold text-slate-700 truncate" title={label}>{label}</span>
                          </div>
                          {isAdmin && (
                            <button
                              onClick={() => removeEntryFromGroup(id, g.id)}
                              className="p-1 text-slate-400 hover:text-rose-500 rounded transition shrink-0"
                              title="Keluarkan dari grup"
                              id={`remove-entry-button-${g.id}-${id}`}
                            >
                              <X className="h-3.5 w-3.5 text-rose-400" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* GENERATE BUTTON */}
          {isAdmin && (
            <div className="pt-4 border-t border-slate-150 flex justify-end" id="generate-schedule-action">
              <button
                onClick={handleLockAndGenerate}
                className="px-6 py-3 bg-navy hover:bg-navy-light text-neon rounded-xl font-extrabold text-sm transition flex items-center gap-2 card-shadow"
                id="lock-groups-submit-button"
              >
                <Play className="h-4 w-4 text-neon" /> Kunci Grup & Generate Jadwal Round Robin
              </button>
            </div>
          )}
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

      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="custom-confirm-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl transform transition-all animate-scale-up" id="custom-confirm-card">
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-rose-50 border border-rose-200 text-rose-600 font-bold text-lg shrink-0">⚠️</span>
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
                id="confirm-cancel-button"
              >
                Batalkan
              </button>
              <button
                type="button"
                onClick={showConfirm.onConfirm}
                className="px-4 py-2 text-sm font-extrabold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition"
                id="confirm-submit-button"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
