/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Division, Group, Entry, Match } from '../types';
import { generateRoundRobinMatches } from '../utils/tournamentHelpers';
import { checkDivisionGroupLockStatus, validateAndCleanGroups } from '../services/groupService';
import { Plus, Trash2, ArrowRight, X, Play, RefreshCw, AlertCircle, Sparkles, Lock, Info, CheckCircle2 } from 'lucide-react';

interface DivisionGroupsProps {
  division: Division;
  onUpdateDivision: (updated: Division) => void;
  isAdmin?: boolean;
}

export default function DivisionGroups({ division, onUpdateDivision, isAdmin = true }: DivisionGroupsProps) {
  const { entries, groups, settings, roundRobinMatches } = division;

  // Lock status check
  const lockStatus = useMemo(() => checkDivisionGroupLockStatus(division), [division]);

  // Initial group setup with stable group IDs
  const [localGroups, setLocalGroups] = useState<Group[]>(() => {
    if (groups && groups.length > 0) {
      return groups.map((g, idx) => {
        const code = String.fromCharCode(65 + idx);
        return {
          id: g.id || `grp-${code.toLowerCase()}-${division.id}`,
          name: `Grup ${code}`,
          entryIds: g.entryIds || []
        };
      });
    }
    return [
      { id: `grp-a-${division.id}`, name: 'Grup A', entryIds: [] },
      { id: `grp-b-${division.id}`, name: 'Grup B', entryIds: [] }
    ];
  });

  // Keep localGroups synced when division.groups changes from props
  useEffect(() => {
    if (groups && groups.length > 0) {
      setLocalGroups(groups.map((g, idx) => {
        const code = String.fromCharCode(65 + idx);
        return {
          id: g.id || `grp-${code.toLowerCase()}-${division.id}`,
          name: `Grup ${code}`,
          entryIds: g.entryIds || []
        };
      }));
    }
  }, [groups, division.id]);

  // Validate and inspect group data integrity
  const validationResult = useMemo(() => {
    return validateAndCleanGroups(localGroups, entries);
  }, [localGroups, entries]);

  const { cleanedGroups, unassignedEntries, isValid, invalidEntryIds, duplicateEntryIds, issues } = validationResult;
  const assignedCount = entries.length - unassignedEntries.length;

  // Helper to commit group changes to main state safely
  const updateGroupsAndSync = (updatedGroups: Group[], clearMatchesIfUnscored = false) => {
    const nextMatches = clearMatchesIfUnscored && !lockStatus.hasScores ? [] : roundRobinMatches;
    
    setLocalGroups(updatedGroups);
    onUpdateDivision({
      ...division,
      groups: updatedGroups,
      roundRobinMatches: nextMatches
    });
  };

  // Custom modal states
  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
  } | null>(null);

  const [showAlert, setShowAlert] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // Check if modification is blocked by lock status
  const checkModificationAllowed = (): boolean => {
    if (lockStatus.isLocked) {
      if (lockStatus.hasScores) {
        setShowAlert({
          title: 'Pembagian Grup Terkunci 🔒',
          message: 'Beberapa pertandingan sudah memiliki skor. Struktur grup tidak dapat diubah dari halaman pembagian grup. Reset hasil pertandingan terlebih dahulu melalui modul Jadwal Pertandingan.'
        });
      } else {
        setShowAlert({
          title: 'Pembagian Grup Terkunci 🔒',
          message: lockStatus.reason || 'Struktur grup tidak dapat diubah.'
        });
      }
      return false;
    }
    return true;
  };

  // Explicit helper to confirm schedule reset if roundRobinMatches exist without scores
  const confirmScheduleResetIfNeeded = (onProceed: () => void) => {
    if (lockStatus.hasMatches && !lockStatus.hasScores) {
      const matchCount = (roundRobinMatches || []).length;
      setShowConfirm({
        title: 'Reset Jadwal yang Ada?',
        message: `Terdapat ${matchCount} pertandingan round robin yang telah dijadwalkan (belum ada skor). Perubahan grup ini akan menghapus jadwal lama tersebut. Apakah Anda yakin ingin melanjutkan?`,
        confirmText: 'Ya, Hapus Jadwal & Ubah Grup',
        onConfirm: () => {
          onProceed();
          setShowConfirm(null);
        }
      });
    } else {
      onProceed();
    }
  };

  // Action: Manual repair of invalid / duplicate entry IDs in groups
  const handleRepairGroupData = () => {
    if (!checkModificationAllowed()) return;

    setShowConfirm({
      title: 'Konfirmasi Perbaikan Data Grup',
      message: `Perbaikan akan menghapus ${invalidEntryIds.length} ID peserta yang tidak terdaftar dan merapikan ${duplicateEntryIds.length} entri duplikat dari grup. Data peserta utama tidak akan terhapus. Lanjutkan?`,
      confirmText: 'Ya, Perbaiki Sekarang',
      onConfirm: () => {
        confirmScheduleResetIfNeeded(() => {
          updateGroupsAndSync(cleanedGroups, true);
          setShowAlert({
            title: 'Data Grup Berhasil Diperbaiki! ✅',
            message: 'Referensi ID tidak valid dan duplikat di dalam grup telah dibersihkan secara aman.'
          });
        });
        setShowConfirm(null);
      }
    });
  };

  // Add a new empty group
  const addGroup = () => {
    if (!checkModificationAllowed()) return;

    confirmScheduleResetIfNeeded(() => {
      const nextIndex = localGroups.length;
      const nextCode = String.fromCharCode(65 + nextIndex); // A, B, C, D...
      const newGroup: Group = {
        id: `grp-${nextCode.toLowerCase()}-${division.id}-${Date.now()}`,
        name: `Grup ${nextCode}`,
        entryIds: []
      };
      updateGroupsAndSync([...localGroups, newGroup], true);
    });
  };

  // Delete a group and release its entries back to unassigned pool
  const removeGroup = (groupId: string) => {
    if (!checkModificationAllowed()) return;

    if (localGroups.length <= 1) {
      setShowAlert({
        title: 'Batas Minimal Grup ⚠️',
        message: 'Jumlah minimal adalah 1 grup. Grup terakhir tidak dapat dihapus.'
      });
      return;
    }

    confirmScheduleResetIfNeeded(() => {
      const remaining = localGroups.filter(g => g.id !== groupId);
      // Re-adjust names (Grup A, Grup B, Grup C...)
      const renamed = remaining.map((g, index) => ({
        ...g,
        name: `Grup ${String.fromCharCode(65 + index)}`
      }));
      updateGroupsAndSync(renamed, true);
    });
  };

  // Move entry to specific group
  const moveEntryToGroup = (entryId: string, targetGroupId: string) => {
    if (!checkModificationAllowed()) return;

    confirmScheduleResetIfNeeded(() => {
      const updated = localGroups.map(g => {
        // Remove from current group first
        const filtered = g.entryIds.filter(id => id !== entryId);
        if (g.id === targetGroupId) {
          return { ...g, entryIds: [...filtered, entryId] };
        }
        return { ...g, entryIds: filtered };
      });
      updateGroupsAndSync(updated, true);
    });
  };

  // Remove entry from group (return to unassigned pool)
  const removeEntryFromGroup = (entryId: string, groupId: string) => {
    if (!checkModificationAllowed()) return;

    confirmScheduleResetIfNeeded(() => {
      const updated = localGroups.map(g => {
        if (g.id === groupId) {
          return { ...g, entryIds: g.entryIds.filter(id => id !== entryId) };
        }
        return g;
      });
      updateGroupsAndSync(updated, true);
    });
  };

  // Balanced Auto-Generate Groups from scratch
  const handleGenerateGroups = () => {
    if (!checkModificationAllowed()) return;

    if (entries.length === 0) {
      setShowAlert({
        title: 'Tidak Ada Peserta ⚠️',
        message: 'Belum ada peserta terdaftar dalam divisi ini. Silakan tambahkan peserta terlebih dahulu.'
      });
      return;
    }

    const runGeneration = () => {
      const targetPerGroup = settings.playersPerGroup || 4;
      const numGroups = Math.max(1, Math.ceil(entries.length / targetPerGroup));
      
      const newGroups: Group[] = Array.from({ length: numGroups }, (_, i) => {
        const code = String.fromCharCode(65 + i);
        return {
          id: `grp-${code.toLowerCase()}-${division.id}`,
          name: `Grup ${code}`,
          entryIds: []
        };
      });

      // Shuffle copy of entries and distribute evenly across groups (balanced distribution, max diff <= 1)
      const shuffled = [...entries].sort(() => Math.random() - 0.5);
      shuffled.forEach((entry, idx) => {
        const targetIdx = idx % numGroups;
        newGroups[targetIdx].entryIds.push(entry.id);
      });

      updateGroupsAndSync(newGroups, true);
      setShowAlert({
        title: 'Grup Berhasil Di-generate! 🎯',
        message: `Berhasil membagi total ${entries.length} peserta secara seimbang ke dalam ${numGroups} grup (selisih peserta antar grup maksimal 1).`
      });
    };

    if (localGroups.some(g => g.entryIds.length > 0)) {
      setShowConfirm({
        title: 'Generate Ulang Semua Grup?',
        message: 'Semua peserta akan diacak dan didistribusikan ulang secara seimbang ke dalam grup baru. Lanjutkan?',
        confirmText: 'Ya, Generate Ulang',
        onConfirm: () => {
          confirmScheduleResetIfNeeded(runGeneration);
          setShowConfirm(null);
        }
      });
    } else {
      confirmScheduleResetIfNeeded(runGeneration);
    }
  };

  // Distribute unassigned entries evenly to existing groups
  const autoDistributeUnassigned = () => {
    if (!checkModificationAllowed()) return;

    if (unassignedEntries.length === 0) {
      setShowAlert({
        title: 'Semua Peserta Sudah Masuk Grup 👍',
        message: 'Tidak ada peserta tersisa di pool belum masuk grup.'
      });
      return;
    }

    confirmScheduleResetIfNeeded(() => {
      const shuffled = [...unassignedEntries].sort(() => Math.random() - 0.5);
      const updated = localGroups.map(g => ({ ...g, entryIds: [...g.entryIds] }));

      shuffled.forEach(entry => {
        // Find group with fewest entries
        let targetGroup = updated[0];
        for (let i = 1; i < updated.length; i++) {
          if (updated[i].entryIds.length < targetGroup.entryIds.length) {
            targetGroup = updated[i];
          }
        }
        targetGroup.entryIds.push(entry.id);
      });

      updateGroupsAndSync(updated, true);
    });
  };

  // Clear all group assignments
  const resetAllGroups = () => {
    if (!checkModificationAllowed()) return;

    setShowConfirm({
      title: 'Kosongkan Semua Grup?',
      message: 'Apakah Anda yakin ingin mengeluarkan seluruh peserta dari semua grup ke dalam pool belum masuk grup?',
      confirmText: 'Ya, Kosongkan Grup',
      onConfirm: () => {
        confirmScheduleResetIfNeeded(() => {
          const resetGroups = localGroups.map(g => ({ ...g, entryIds: [] }));
          updateGroupsAndSync(resetGroups, true);
        });
        setShowConfirm(null);
      }
    });
  };

  // Lock groups and generate round robin matches schedule
  const handleLockAndGenerate = () => {
    // 1. Check strict lock status
    if (!checkModificationAllowed()) return;

    // 2. Check unassigned entries (STRICT BLOCK - Rule A)
    if (unassignedEntries.length > 0) {
      setShowAlert({
        title: 'Peserta Belum Masuk Grup ⚠️',
        message: `Masih ada ${unassignedEntries.length} peserta yang belum ditempatkan ke grup. Masukkan seluruh peserta ke grup atau keluarkan dari peserta aktif terlebih dahulu.`
      });
      return;
    }

    // 3. Validation: empty groups
    const emptyGroups = localGroups.filter(g => g.entryIds.length === 0);
    if (emptyGroups.length > 0) {
      setShowAlert({
        title: 'Grup Kosong ⚠️',
        message: 'Semua grup harus memiliki peserta. Harap isi atau hapus grup yang kosong sebelum membuat jadwal.'
      });
      return;
    }

    // 4. Validation: minimum 2 entries per group
    const underpopulatedGroups = localGroups.filter(g => g.entryIds.length < 2);
    if (underpopulatedGroups.length > 0) {
      setShowAlert({
        title: 'Jumlah Peserta Kurang ⚠️',
        message: 'Setiap grup harus memiliki minimal 2 peserta agar pertandingan round robin dapat dilaksanakan.'
      });
      return;
    }

    const proceedGenerate = () => {
      let allMatches: Match[] = [];
      localGroups.forEach(g => {
        const groupMatches = generateRoundRobinMatches(division.id, g, entries);
        allMatches = [...allMatches, ...groupMatches];
      });

      onUpdateDivision({
        ...division,
        groups: localGroups,
        roundRobinMatches: allMatches,
        knockoutStage: null,
        champions: null
      });

      setShowAlert({
        title: 'Jadwal Round Robin Berhasil Dibuat! 🗓️',
        message: `Berhasil membuat ${allMatches.length} pertandingan round robin untuk ${localGroups.length} grup.`
      });
      setShowConfirm(null);
    };

    // 5. Check if schedule exists without scores (Rule B & C)
    if (lockStatus.hasMatches && !lockStatus.hasScores) {
      setShowConfirm({
        title: 'Generate Ulang Jadwal Round Robin?',
        message: `Jadwal pertandingan round robin sudah ada (${roundRobinMatches.length} pertandingan, belum ada skor). Generate ulang jadwal akan menghapus jadwal lama dan membuat jadwal baru berdasarkan grup aktif saat ini. Apakah Anda yakin?`,
        confirmText: 'Ya, Generate Ulang Jadwal',
        onConfirm: proceedGenerate
      });
    } else {
      proceedGenerate();
    }
  };

  return (
    <div className="space-y-8" id="division-groups-panel">
      
      {/* STATUS BANNER IF LOCKED */}
      {lockStatus.isLocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 shadow-xs" id="groups-locked-banner">
          <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-extrabold text-amber-900">Pembagian Grup Terkunci</h4>
            <p className="text-amber-800 leading-relaxed">{lockStatus.reason}</p>
          </div>
        </div>
      )}

      {/* INTEGRITY WARNING BANNER IF INVALID DATA DETECTED */}
      {!isValid && isAdmin && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs" id="groups-integrity-warning">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-amber-900">
              <h4 className="font-extrabold text-sm">Peringatan Integritas Data Grup ⚠️</h4>
              <p className="leading-relaxed">
                Ditemukan {issues.length} masalah integritas data ({invalidEntryIds.length} ID tidak valid, {duplicateEntryIds.length} peserta duplikat di grup).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRepairGroupData}
            disabled={lockStatus.isLocked}
            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold shrink-0 border transition ${
              lockStatus.isLocked
                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-700 text-white border-amber-700 shadow-sm'
            }`}
            id="repair-group-data-button"
          >
            Perbaiki Data Grup
          </button>
        </div>
      )}

      {/* HEADER & ACTION BAR */}
      <div className="bg-slate-50 border border-slate-150 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 card-shadow" id="groups-info-bar">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-navy flex items-center gap-1.5">
            <Info className="h-4 w-4 text-emerald-600" />
            Pengaturan & Pembagian Grup Division
          </h3>
          <p className="text-xs text-slate-500 max-w-2xl">
            Total <strong>{entries.length} peserta</strong>: <strong>{assignedCount}</strong> sudah berada di grup, <strong>{unassignedEntries.length}</strong> belum masuk grup. Selisih peserta antar grup diatur seimbang (maksimal 1).
          </p>
        </div>
        
        {isAdmin && (
          <div className="flex gap-2 flex-wrap md:self-center">
            <button
              type="button"
              onClick={handleGenerateGroups}
              disabled={lockStatus.isLocked}
              className={`px-3.5 py-2 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 card-shadow ${
                lockStatus.isLocked
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
              id="btn-generate-groups"
              title={lockStatus.isLocked ? lockStatus.reason : 'Bagi seluruh peserta secara seimbang ke dalam grup'}
            >
              <Sparkles className="h-3.5 w-3.5 text-neon" /> 🎯 Bagi Grup Otomatis
            </button>

            {unassignedEntries.length > 0 && (
              <button
                type="button"
                onClick={autoDistributeUnassigned}
                disabled={lockStatus.isLocked}
                className={`px-3.5 py-2 rounded-lg text-xs font-extrabold border transition flex items-center gap-1 card-shadow ${
                  lockStatus.isLocked
                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-neon/15 hover:bg-neon/30 text-navy border-neon/30'
                }`}
                id="auto-distribute-button"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Bagi Sisa ke Grup (Acak)
              </button>
            )}

            {assignedCount > 0 && (
              <button
                type="button"
                onClick={resetAllGroups}
                disabled={lockStatus.isLocked}
                className={`px-3.5 py-2 rounded-lg text-xs font-extrabold border transition flex items-center gap-1 card-shadow ${
                  lockStatus.isLocked
                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200'
                }`}
                id="reset-all-groups-button"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-500" /> Kosongkan Semua Grup
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="groups-layout-grid">
        
        {/* PANEL KIRI: DAFTAR PESERTA BELUM MASUK GRUP (POOL) */}
        {isAdmin && (
          <div className="lg:col-span-1" id="unassigned-pool-panel">
            <div className="bg-white rounded-2xl border border-slate-150 p-5 card-shadow sticky top-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-150">
                <h3 className="text-sm font-extrabold text-navy flex items-center gap-1.5">
                  Belum Masuk Grup ({unassignedEntries.length})
                </h3>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-full font-mono border border-slate-200">
                  Pool Peserta
                </span>
              </div>

              {unassignedEntries.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs flex flex-col items-center gap-2" id="no-unassigned">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 stroke-1" />
                  <span>Semua peserta ({entries.length}) telah terdistribusi ke dalam grup.</span>
                </div>
              ) : (
                <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1" id="unassigned-list">
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
                        
                        {/* Assign Buttons */}
                        <div className="flex gap-1 shrink-0">
                          {localGroups.map(g => (
                            <button
                              key={g.id}
                              onClick={() => moveEntryToGroup(entry.id, g.id)}
                              disabled={lockStatus.isLocked}
                              className={`px-2 py-1 rounded border text-slate-700 font-bold text-[11px] transition ${
                                lockStatus.isLocked
                                  ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                  : 'bg-white hover:bg-navy hover:text-neon border-slate-200 hover:border-navy'
                              }`}
                              title={lockStatus.isLocked ? lockStatus.reason : `Masukkan ke ${g.name}`}
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
              Daftar Grup ({localGroups.length})
            </h3>
            {isAdmin && (
              <button
                onClick={addGroup}
                disabled={lockStatus.isLocked}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition flex items-center gap-1 card-shadow ${
                  lockStatus.isLocked
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                    : 'bg-navy hover:bg-navy-light text-neon'
                }`}
                id="add-group-button"
              >
                <Plus className="h-3.5 w-3.5 text-neon" /> Tambah Grup
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="groups-cards-grid">
            {localGroups.map((g) => (
              <div
                key={g.id}
                className="bg-white rounded-2xl border border-slate-150 p-5 card-shadow flex flex-col min-h-[220px] hover:border-emerald-300 transition-colors duration-200"
                id={`group-card-${g.id}`}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-150">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-navy text-sm">{g.name}</span>
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 text-[11px] font-extrabold rounded-full border border-emerald-200">
                      {g.entryIds.length} Peserta
                    </span>
                  </div>
                  
                  {isAdmin && (
                    <button
                      onClick={() => removeGroup(g.id)}
                      disabled={lockStatus.isLocked}
                      className={`p-1 rounded transition ${
                        lockStatus.isLocked ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-rose-500'
                      }`}
                      title={lockStatus.isLocked ? lockStatus.reason : "Hapus Grup"}
                      id={`delete-group-button-${g.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    </button>
                  )}
                </div>

                {/* Card Content: Entries inside group */}
                <div className="space-y-1.5 flex-1" id={`group-entries-list-${g.id}`}>
                  {g.entryIds.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl h-full flex flex-col justify-center items-center">
                      Grup Kosong
                      {isAdmin && !lockStatus.isLocked && (
                        <span className="text-[10px] text-slate-400 mt-1">Gunakan tombol di pool sisi kiri</span>
                      )}
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
                            <span className="font-mono text-slate-400 mr-1.5 font-bold">{idx + 1}.</span>
                            <span className="font-semibold text-slate-700 truncate" title={label}>{label}</span>
                            {entry.affiliation && (
                              <span className="text-[10px] text-slate-400 block truncate">{entry.affiliation}</span>
                            )}
                          </div>
                          {isAdmin && (
                            <button
                              onClick={() => removeEntryFromGroup(id, g.id)}
                              disabled={lockStatus.isLocked}
                              className={`p-1 rounded transition shrink-0 ${
                                lockStatus.isLocked ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-rose-500'
                              }`}
                              title={lockStatus.isLocked ? lockStatus.reason : "Keluarkan dari grup"}
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

          {/* GENERATE SCHEDULE ACTION */}
          {isAdmin && (
            <div className="pt-4 border-t border-slate-150 flex justify-end" id="generate-schedule-action">
              <button
                onClick={handleLockAndGenerate}
                disabled={lockStatus.isLocked}
                className={`px-6 py-3 rounded-xl font-extrabold text-sm transition flex items-center gap-2 card-shadow ${
                  lockStatus.isLocked
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                    : 'bg-navy hover:bg-navy-light text-neon'
                }`}
                id="lock-groups-submit-button"
                title={lockStatus.isLocked ? lockStatus.reason : "Kunci grup dan buat jadwal pertandingan round robin"}
              >
                <Play className="h-4 w-4 text-neon" /> Kunci Grup & Generate Jadwal Round Robin
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ALERT MODAL */}
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

      {/* CONFIRM MODAL */}
      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="custom-confirm-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl transform transition-all animate-scale-up" id="custom-confirm-card">
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
                {showConfirm.confirmText || 'Ya, Lanjutkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
