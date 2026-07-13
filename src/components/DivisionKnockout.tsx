/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState } from 'react';
import { Division, Match, Entry, GroupStandingRow, KnockoutStage, Champions } from '../types';
import { calculateGroupStandings, getWildcardRecommendations, generateKnockoutBracket, propagateKnockoutResult } from '../utils/tournamentHelpers';
import { Trophy, Check, Edit3, Lock, Unlock, Play, HelpCircle, ChevronRight, AlertTriangle, ArrowRight, RefreshCw, X } from 'lucide-react';

interface DivisionKnockoutProps {
  division: Division;
  onUpdateDivision: (updated: Division) => void;
  isAdmin?: boolean;
}

export default function DivisionKnockout({ division, onUpdateDivision, isAdmin = true }: DivisionKnockoutProps) {
  const { entries, groups, roundRobinMatches, settings, knockoutStage, champions } = division;

  // Seeding local selection before locking
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>([]);
  
  // Custom dialog states to bypass standard browser alert/confirm iframe limits
  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [showAlert, setShowAlert] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // Score inputs
  const [scoringMatch, setScoringMatch] = useState<Match | null>(null);
  const [score1, setScore1] = useState<number | string>('');
  const [score2, setScore2] = useState<number | string>('');
  const [koStatus, setKoStatus] = useState<'belum_dimainkan' | 'selesai' | 'walkover'>('selesai');
  const [koWinner, setKoWinner] = useState<string>('');

  // 1. COMPUTE AUTOMATIC RECOMMENDATIONS
  const standingsByGroup: Record<string, GroupStandingRow[]> = {};
  groups.forEach(g => {
    standingsByGroup[g.id] = calculateGroupStandings(g, roundRobinMatches, entries);
  });

  const { direct, wildcards, nextBestList } = getWildcardRecommendations(
    standingsByGroup,
    settings.playersQualifyingPerGroup,
    settings.bracketSize
  );

  const recommendedIds = [...direct, ...wildcards].slice(0, settings.bracketSize);

  // Initialize Seeding State if not done yet
  const handleStartSeedingSetup = () => {
    setSelectedSeeds(recommendedIds);
  };

  // Build bracket with current selected seeds
  const handleGenerateBracket = () => {
    if (selectedSeeds.length === 0) {
      setShowAlert({
        title: 'Harap Konfirmasi Peserta',
        message: 'Harap konfirmasi list peserta terlebih dahulu.'
      });
      return;
    }

    // Validation: prevent duplicate player assignment in bracket seeds
    const nonByeSeeds = selectedSeeds.filter(s => s && s !== 'BYE');
    const uniqueSeeds = new Set(nonByeSeeds);
    if (uniqueSeeds.size !== nonByeSeeds.length) {
      setShowAlert({
        title: 'Peserta Terpilih Ganda',
        message: 'Error: Ada peserta yang dipilih lebih dari satu kali pada slot seeding. Setiap peserta hanya boleh menempati satu slot di dalam bracket.'
      });
      return;
    }

    const bracketMatches = generateKnockoutBracket(division.id, selectedSeeds, settings.bracketSize);
    
    // Automatically advance BYE matches if applicable!
    // In knockout, if entryId2 is empty/BYE (meaning null or BYE), we can immediately resolve it.
    // However, to keep it fully transparent, we let the user review and click "Auto-resolve BYEs" or resolve manually.
    
    onUpdateDivision({
      ...division,
      knockoutStage: {
        matches: bracketMatches,
        isLocked: false,
        confirmedEntryIds: selectedSeeds,
      },
      champions: null
    });
  };

  // Update a specific slot seed selection
  const handleSeedChange = (index: number, entryId: string) => {
    const updated = [...selectedSeeds];
    updated[index] = entryId;
    setSelectedSeeds(updated);
  };

  // Lock the bracket to start playing
  const handleLockBracket = () => {
    if (!knockoutStage) return;
    
    // Validation: prevent duplicate player assignment on lock
    const nonByeSeeds = knockoutStage.confirmedEntryIds.filter(s => s && s !== 'BYE');
    const uniqueSeeds = new Set(nonByeSeeds);
    if (uniqueSeeds.size !== nonByeSeeds.length) {
      setShowAlert({
        title: 'Peserta Terpilih Ganda',
        message: 'Error: Ada peserta yang terpilih lebih dari satu kali di slot bracket. Harap perbaiki penempatan peserta sebelum mengunci bracket.'
      });
      return;
    }

    const executeLock = () => {
      // Process initial automatic BYEs!
      // If a match in Round 1 has Player 1 but Player 2 is empty/BYE, Player 1 auto-wins.
      let updatedMatches = [...knockoutStage.matches];
      let changed = true;
      
      // Run propagation loop for BYEs
      while (changed) {
        changed = false;
        for (let i = 0; i < updatedMatches.length; i++) {
          const m = updatedMatches[i];
          if (m.status === 'belum_dimainkan') {
            // If Player 1 is set and Player 2 is empty (meaning a BYE/null because not enough qualified entries)
            if (m.entryId1 && !m.entryId2) {
              m.status = 'selesai';
              m.score1 = 1;
              m.score2 = 0;
              m.winnerId = m.entryId1;
              m.loserId = 'BYE';
              updatedMatches = propagateKnockoutResult(updatedMatches, m.matchNum!, m.entryId1, 'BYE');
              changed = true;
            } else if (m.entryId2 && !m.entryId1) {
              m.status = 'selesai';
              m.score1 = 0;
              m.score2 = 1;
              m.winnerId = m.entryId2;
              m.loserId = 'BYE';
              updatedMatches = propagateKnockoutResult(updatedMatches, m.matchNum!, m.entryId2, 'BYE');
              changed = true;
            }
          }
        }
      }

      onUpdateDivision({
        ...division,
        knockoutStage: {
          ...knockoutStage,
          matches: updatedMatches,
          isLocked: true
        }
      });
      setShowConfirm(null);
    };

    // Warn if any slots are completely unassigned (null/empty) and byeActive is off
    const hasNulls = knockoutStage.matches.some(m => !m.entryId1 && !m.entryId2);
    if (hasNulls && !settings.byeActive) {
      setShowConfirm({
        title: 'Kunci Bracket',
        message: 'Peringatan: Ada slot kosong di bracket Anda sedangkan fitur BYE tidak diaktifkan. Anda bisa melanjutkan, namun slot kosong tersebut akan dianggap sebagai walkover. Tetap kunci bracket?',
        onConfirm: executeLock
      });
    } else {
      executeLock();
    }
  };

  // Unlock bracket to rearrange seeds (wipes current scores)
  const handleUnlockBracket = () => {
    if (!knockoutStage) return;

    setShowConfirm({
      title: 'Buka Kunci Bracket',
      message: 'Apakah Anda yakin ingin membuka kunci bracket? Semua skor fase gugur yang sudah dimasukkan akan terhapus.',
      onConfirm: () => {
        const freshMatches = generateKnockoutBracket(division.id, knockoutStage.confirmedEntryIds, settings.bracketSize);
        onUpdateDivision({
          ...division,
          knockoutStage: {
            ...knockoutStage,
            matches: freshMatches,
            isLocked: false
          },
          champions: null
        });
        setShowConfirm(null);
      }
    });
  };

  // Reset entire Knockout stage
  const handleResetKnockout = () => {
    setShowConfirm({
      title: 'Reset Fase Gugur',
      message: 'Apakah Anda yakin ingin mengulang pendaftaran fase gugur? Semua bracket dan skor saat ini akan dihapus.',
      onConfirm: () => {
        onUpdateDivision({
          ...division,
          knockoutStage: null,
          champions: null
        });
        setSelectedSeeds([]);
        setShowConfirm(null);
      }
    });
  };

  // Open KO Score Modal
  const openKoScoreModal = (match: Match) => {
    setScoringMatch(match);
    setScore1(match.score1 ?? '');
    setScore2(match.score2 ?? '');
    setKoStatus(match.status === 'belum_dimainkan' ? 'selesai' : match.status);
    setKoWinner(match.winnerId || match.entryId1 || '');
  };

  // Close KO Score Modal
  const closeKoScoreModal = () => {
    setScoringMatch(null);
  };

  const executeCommitKoScore = (fs1: number, fs2: number, status: typeof koStatus, wId: string, lId: string) => {
    let updatedMatches = knockoutStage!.matches.map(m => {
      if (m.id === scoringMatch!.id) {
        return {
          ...m,
          score1: fs1,
          score2: fs2,
          status,
          winnerId: wId,
          loserId: lId
        };
      }
      return m;
    });

    updatedMatches = propagateKnockoutResult(updatedMatches, scoringMatch!.matchNum!, wId, lId);

    const finalMatchNum = settings.bracketSize === 4 ? 3 : settings.bracketSize === 8 ? 7 : 15;
    const bronzeMatchNum = settings.bracketSize === 4 ? 4 : settings.bracketSize === 8 ? 8 : 16;

    const concludedFinalMatch = updatedMatches.find(m => m.matchNum === finalMatchNum);
    const concludedBronzeMatch = updatedMatches.find(m => m.matchNum === bronzeMatchNum);

    let finalChampions: Champions | null = champions;

    if (concludedFinalMatch && concludedFinalMatch.status !== 'belum_dimainkan') {
      finalChampions = {
        firstPlaceEntryId: concludedFinalMatch.winnerId || null,
        secondPlaceEntryId: concludedFinalMatch.loserId || null,
        thirdPlaceEntryId: concludedBronzeMatch && concludedBronzeMatch.status !== 'belum_dimainkan' ? concludedBronzeMatch.winnerId || null : null
      };
    }

    onUpdateDivision({
      ...division,
      knockoutStage: {
        ...knockoutStage!,
        matches: updatedMatches
      },
      champions: finalChampions
    });

    setScoringMatch(null);
  };

  // Save KO Match score and calculate progression
  const handleSaveKoScore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scoringMatch || !knockoutStage) return;

    let finalScore1 = 0;
    let finalScore2 = 0;
    let winnerId = '';
    let loserId = '';

    if (koStatus === 'walkover') {
      const targetScore = settings.targetScore;
      if (koWinner === scoringMatch.entryId1) {
        finalScore1 = targetScore;
        finalScore2 = 0;
        winnerId = scoringMatch.entryId1 || '';
        loserId = scoringMatch.entryId2 || 'BYE';
      } else {
        finalScore1 = 0;
        finalScore2 = targetScore;
        winnerId = scoringMatch.entryId2 || '';
        loserId = scoringMatch.entryId1 || 'BYE';
      }
      executeCommitKoScore(finalScore1, finalScore2, koStatus, winnerId, loserId);
    } else {
      finalScore1 = parseInt(String(score1)) || 0;
      finalScore2 = parseInt(String(score2)) || 0;

      if (finalScore1 === finalScore2) {
        setShowAlert({
          title: 'Skor Seri',
          message: 'Skor seri tidak diperbolehkan dalam fase gugur.'
        });
        return;
      }

      if (settings.winByTwo) {
        const diff = Math.abs(finalScore1 - finalScore2);
        const maxScore = Math.max(finalScore1, finalScore2);
        if (maxScore < settings.targetScore) {
          setShowConfirm({
            title: 'Simpan Skor di Bawah Target',
            message: `Skor tertinggi (${maxScore}) kurang dari target poin (${settings.targetScore}). Tetap simpan?`,
            onConfirm: () => {
              const wId = finalScore1 > finalScore2 ? (scoringMatch.entryId1 || '') : (scoringMatch.entryId2 || '');
              const lId = finalScore1 > finalScore2 ? (scoringMatch.entryId2 || '') : (scoringMatch.entryId1 || '');
              executeCommitKoScore(finalScore1, finalScore2, koStatus, wId, lId);
              setShowConfirm(null);
            }
          });
          return;
        } else if (maxScore > settings.targetScore && diff < 2) {
          setShowAlert({
            title: 'Aturan Win by 2',
            message: 'Game harus dimenangkan dengan selisih minimal 2 poin (Win by 2).'
          });
          return;
        }
      }

      if (finalScore1 > finalScore2) {
        winnerId = scoringMatch.entryId1 || '';
        loserId = scoringMatch.entryId2 || '';
      } else {
        winnerId = scoringMatch.entryId2 || '';
        loserId = scoringMatch.entryId1 || '';
      }

      executeCommitKoScore(finalScore1, finalScore2, koStatus, winnerId, loserId);
    }
  };

  const getEntryLabel = (id: string | null) => {
    if (!id) return 'TBD';
    if (id === 'BYE') return 'BYE (Lolos Langsung)';
    const ent = entries.find(e => e.id === id);
    if (!ent) return 'BYE';
    return `${ent.name1}${ent.name2 ? ` / ${ent.name2}` : ''}`;
  };

  // Organize matches into rounds for visual rendering
  const getMatchesByRound = (): Record<string, Match[]> => {
    if (!knockoutStage) return {};
    const result: Record<string, Match[]> = {};
    
    knockoutStage.matches.forEach(m => {
      if (m.isBronzeMatch) return; // Render Bronze match separately at bottom
      const rName = m.roundName || 'Lainnya';
      if (!result[rName]) {
        result[rName] = [];
      }
      result[rName].push(m);
    });

    return result;
  };

  // Order rounds from first to final
  const orderedRoundNames = (): string[] => {
    if (settings.bracketSize === 4) {
      return ['Semifinal', 'Final'];
    } else if (settings.bracketSize === 8) {
      return ['Perempat Final', 'Semifinal', 'Final'];
    } else {
      return ['Babak 16 Besar', 'Perempat Final', 'Semifinal', 'Final'];
    }
  };

  return (
    <div className="space-y-8 animate-fade-in" id="division-knockout-panel">
      
      {/* PHASE 1: QUALIFIERS CONFIRMATION PANEL (IF NO STAGE GENERATED) */}
      {!knockoutStage ? (
        <div className="space-y-6" id="qualifiers-recommendation-flow">
          <div className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-150 mb-6 gap-4">
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-neon stroke-navy fill-neon" />
                  Rekomendasi Peserta Lolos Fase Grup
                </h3>
                <p className="text-xs text-slate-400">
                  Berikut adalah rekomendasi otomatis dari grup stage. {isAdmin ? 'Anda dapat meninjau, mengonfirmasi, dan menyusun seeding bracket setelahnya.' : 'Fase Gugur belum dimulai oleh admin turnamen.'}
                </p>
              </div>
              {isAdmin ? (
                <button
                  onClick={handleStartSeedingSetup}
                  className="px-4 py-2 bg-navy hover:bg-navy-light text-neon rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 card-shadow self-start sm:self-center"
                  id="view-qualifiers-button"
                >
                  <ChevronRight className="h-4 w-4 text-neon" /> Mulai Penyusunan Bracket
                </button>
              ) : (
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 text-xs text-slate-500 flex items-center gap-2 max-w-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <span>Fase gugur belum dimulai. Di bawah ini adalah proyeksi klasemen sementara.</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="standings-rec-grid">
              {/* Direct Qualifiers */}
              <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-150 space-y-3" id="direct-rec-panel">
                <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">
                  Lolos Langsung ({direct.length} Peserta)
                </span>
                <p className="text-[11px] text-slate-450">
                  Peserta peringkat {settings.playersQualifyingPerGroup} teratas dari setiap grup stage.
                </p>

                <div className="space-y-1.5" id="direct-list">
                  {direct.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">Belum ada pertandingan grup selesai.</span>
                  ) : (
                    direct.map((id, idx) => (
                      <div key={id} className="p-2 bg-white border border-emerald-150 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-2">
                        <span className="text-emerald-600 font-bold font-mono">#{idx+1}</span>
                        {getEntryLabel(id)}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Wildcard Qualifiers */}
              <div className="p-4 rounded-xl bg-neon/10 border border-neon/30 space-y-3" id="wildcard-rec-panel">
                <span className="text-xs font-bold text-navy uppercase tracking-wider block">
                  Rekomendasi Wildcard ({wildcards.length} Peserta)
                </span>
                <p className="text-[11px] text-slate-450">
                  Runner-up atau peringkat berikutnya lintas grup yang berkinerja terbaik untuk mencukupi kuota {settings.bracketSize} besar.
                </p>

                <div className="space-y-1.5" id="wildcards-list">
                  {wildcards.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">Tidak ada slot wildcard yang dibutuhkan.</span>
                  ) : (
                    wildcards.map((id, idx) => (
                      <div key={id} className="p-2 bg-white border border-neon/30 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-2">
                        <span className="text-navy font-bold font-mono">WC-{idx+1}</span>
                        {getEntryLabel(id)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Seed configuration inputs before Generating */}
          {isAdmin && selectedSeeds.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow space-y-6" id="seeding-setup-panel">
              <div className="pb-3 border-b border-slate-150">
                <h4 className="font-extrabold text-navy text-sm">Sesuaikan Seed/Penempatan Slot Bracket</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Tentukan posisi awal seed 1 hingga {settings.bracketSize} sebelum bracket dibentuk secara paten.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" id="seeding-dropdowns-grid">
                {Array(settings.bracketSize).fill(null).map((_, index) => (
                  <div key={index} className="space-y-1" id={`seed-select-container-${index}`}>
                    <label className="text-xs font-bold text-slate-500 font-mono block">Slot Seed {index + 1}</label>
                    <select
                      value={selectedSeeds[index] || ''}
                      onChange={(e) => handleSeedChange(index, e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 text-xs text-slate-700 font-semibold bg-white"
                      id={`seed-select-${index}`}
                    >
                      <option value="">-- Pilih Peserta --</option>
                      <option value="BYE">BYE (Lolos Langsung)</option>
                      {entries.map(ent => {
                        const label = `${ent.name1}${ent.name2 ? ` / ${ent.name2}` : ''}`;
                        return (
                          <option key={ent.id} value={ent.id}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleGenerateBracket}
                  className="px-6 py-3 bg-navy hover:bg-navy-light text-neon rounded-xl text-sm font-extrabold card-shadow transition flex items-center gap-1.5"
                  id="submit-bracket-generation"
                >
                  <Play className="h-4 w-4 text-neon" /> Buat Bracket Fase Gugur
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* PHASE 2: BRACKET CONTROL AND VISUAL BOARD */
        <div className="space-y-6" id="knockout-bracket-flow">
          
          {/* HEADER STATUS BAR */}
          <div className="bg-white rounded-2xl border border-slate-150 p-5 card-shadow flex flex-col md:flex-row md:items-center justify-between gap-4" id="bracket-control-bar">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl border ${knockoutStage.isLocked ? 'bg-neon/15 text-navy border-neon/30' : 'bg-amber-50 text-amber-700 border-amber-250'}`}>
                {knockoutStage.isLocked ? (
                  <Lock className="h-5 w-5" />
                ) : (
                  <Unlock className="h-5 w-5" />
                )}
              </div>
              <div className="space-y-0.5">
                <h3 className="font-extrabold text-navy text-sm">
                  {knockoutStage.isLocked ? 'Bracket Terkunci & Pertandingan Dimulai' : 'Bracket Draft (Pengaturan Posisi)'}
                </h3>
                <p className="text-[11px] text-slate-450">
                  {knockoutStage.isLocked 
                    ? (isAdmin ? 'Hasil pertandingan sedang dimainkan. Klik kotak pertandingan untuk mencatat skor.' : 'Hasil pertandingan fase gugur sedang berlangsung.')
                    : (isAdmin ? 'Anda masih bisa menukar seed atau mengatur bye. Klik kunci bracket untuk memulai pertandingan.' : 'Bracket draf sedang dipersiapkan oleh admin.')}
                </p>
              </div>
            </div>

            {isAdmin && (
              <div className="flex gap-2 shrink-0">
                {!knockoutStage.isLocked ? (
                  <>
                    <button
                      onClick={handleLockBracket}
                      className="px-4 py-2 bg-navy hover:bg-navy-light text-neon rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 card-shadow"
                      id="lock-bracket-button"
                    >
                      <Lock className="h-3.5 w-3.5 text-neon" /> Kunci Bracket & Mainkan
                    </button>
                    <button
                      onClick={handleResetKnockout}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                      id="reset-bracket-button"
                    >
                      Reset Ulang
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleUnlockBracket}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                      id="unlock-bracket-button"
                    >
                      <Unlock className="h-3.5 w-3.5" /> Buka Kunci Bracket
                    </button>
                    <button
                      onClick={handleResetKnockout}
                      className="px-4 py-2 bg-slate-100 hover:bg-rose-50 text-rose-650 rounded-xl text-xs font-bold transition"
                      id="reset-bracket-button-locked"
                    >
                      Reset Ulang
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* DRAFT MODE SEEDING SWAP FORM (IF NOT LOCKED) */}
          {isAdmin && !knockoutStage.isLocked && (
            <div className="bg-slate-50 border border-slate-150 rounded-2xl p-5 space-y-4 card-shadow" id="draft-seeding-swap-panel">
              <span className="text-xs font-extrabold text-navy uppercase tracking-wider block">
                Sesuaikan Ulang Seeding Slot (Draft Mode)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {knockoutStage.confirmedEntryIds.map((id, idx) => (
                  <div key={idx} className="p-3 bg-white border border-slate-150 rounded-xl text-center space-y-1.5">
                    <span className="text-[10px] font-extrabold text-navy font-mono block">Seed #{idx + 1}</span>
                    <select
                      value={id}
                      onChange={(e) => {
                        const updated = [...knockoutStage.confirmedEntryIds];
                        updated[idx] = e.target.value;
                        onUpdateDivision({
                          ...division,
                          knockoutStage: {
                            ...knockoutStage,
                            confirmedEntryIds: updated,
                            matches: generateKnockoutBracket(division.id, updated, settings.bracketSize)
                          }
                        });
                      }}
                      className="w-full text-center px-1.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 border border-slate-250 rounded focus:outline-none"
                    >
                      <option value="BYE">BYE</option>
                      {entries.map(ent => (
                        <option key={ent.id} value={ent.id}>
                          {ent.name1}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VISUAL KO TREE BRACKET RENDERER */}
          <div className="bg-slate-50/50 rounded-3xl border border-slate-150 p-6 overflow-x-auto" id="visual-bracket-board">
            <div className="flex gap-12 min-w-[800px] justify-between py-6" id="rounds-columns-container">
              {orderedRoundNames().map((rName, rIndex) => {
                const roundMatches = getMatchesByRound()[rName] || [];
                return (
                  <div key={rName} className="flex-1 flex flex-col justify-around space-y-8 min-w-[200px]" id={`round-col-${rName}`}>
                    {/* Column Heading */}
                    <div className="text-center pb-2 border-b border-slate-200 mb-4">
                      <span className="text-xs font-extrabold text-navy uppercase tracking-wider font-mono">{rName}</span>
                    </div>

                    {/* Round matches list stacked vertically with auto centering */}
                    <div className="flex-1 flex flex-col justify-around py-4 space-y-8" id={`round-matches-container-${rName}`}>
                      {roundMatches.map(m => {
                        const isPlayable = knockoutStage.isLocked;
                        const hasScore = m.status !== 'belum_dimainkan';
                        const label1 = getEntryLabel(m.entryId1);
                        const label2 = getEntryLabel(m.entryId2);

                        return (
                          <div
                            key={m.id}
                            onClick={() => {
                              if (isPlayable && isAdmin) openKoScoreModal(m);
                            }}
                            className={`p-3 bg-white border border-slate-150 rounded-xl card-shadow text-xs transition-all relative ${
                              isPlayable && isAdmin
                                ? 'cursor-pointer hover:border-neon/40 hover:shadow-md' 
                                : 'opacity-80'
                            }`}
                            id={`bracket-match-box-${m.matchNum}`}
                          >
                            {/* Match Num Badge */}
                            <span className="absolute -top-2.5 -left-2 px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[9px] font-bold rounded border border-slate-200 font-mono">
                              M#{m.matchNum}
                            </span>

                            <div className="space-y-2">
                              {/* Player 1 Slot */}
                              <div className="flex items-center justify-between gap-2" id={`p1-slot-${m.matchNum}`}>
                                <span className={`font-bold truncate max-w-[140px] ${
                                  m.winnerId === m.entryId1 ? 'text-navy font-black' : 'text-slate-500'
                                }`}>
                                  {label1}
                                </span>
                                {hasScore && (
                                  <span className="font-bold font-mono text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150">
                                    {m.score1}
                                  </span>
                                )}
                              </div>

                              <div className="border-t border-slate-150 my-1"></div>

                              {/* Player 2 Slot */}
                              <div className="flex items-center justify-between gap-2" id={`p2-slot-${m.matchNum}`}>
                                <span className={`font-bold truncate max-w-[140px] ${
                                  m.winnerId === m.entryId2 ? 'text-navy font-black' : 'text-slate-500'
                                }`}>
                                  {label2}
                                </span>
                                {hasScore && (
                                  <span className="font-bold font-mono text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150">
                                    {m.score2}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* THIRD PLACE MATCH (Perebutan Juara 3) */}
            {knockoutStage.matches.some(m => m.isBronzeMatch) && (
              <div className="mt-8 pt-6 border-t border-slate-150 flex flex-col items-center justify-center" id="bronze-match-panel">
                <div className="bg-amber-50/50 border border-amber-150 rounded-2xl p-4 max-w-sm w-full text-center space-y-3 card-shadow">
                  <div className="flex items-center justify-center gap-1.5 text-amber-700 font-bold text-xs uppercase tracking-wider font-mono">
                    <Trophy className="h-4 w-4" /> Perebutan Juara 3
                  </div>

                  {knockoutStage.matches.filter(m => m.isBronzeMatch).map(m => {
                    const isPlayable = knockoutStage.isLocked;
                    const hasScore = m.status !== 'belum_dimainkan';
                    const label1 = getEntryLabel(m.entryId1);
                    const label2 = getEntryLabel(m.entryId2);

                    return (
                      <div
                        key={m.id}
                        onClick={() => {
                          if (isPlayable && isAdmin) openKoScoreModal(m);
                        }}
                        className={`p-3 bg-white border border-slate-200 rounded-xl text-xs transition-all card-shadow ${
                          isPlayable && isAdmin
                            ? 'cursor-pointer hover:border-amber-500' 
                            : 'opacity-85'
                        }`}
                        id={`bronze-match-box-${m.matchNum}`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`font-bold truncate max-w-[180px] ${m.winnerId === m.entryId1 ? 'text-amber-800 font-extrabold' : 'text-slate-500'}`}>
                              {label1}
                            </span>
                            {hasScore && (
                              <span className="font-bold font-mono text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150">{m.score1}</span>
                            )}
                          </div>
                          <div className="border-t border-slate-150"></div>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`font-bold truncate max-w-[180px] ${m.winnerId === m.entryId2 ? 'text-amber-800 font-extrabold' : 'text-slate-500'}`}>
                              {label2}
                            </span>
                            {hasScore && (
                              <span className="font-bold font-mono text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150">{m.score2}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ACTIVE DIVISION CHAMPIONS CARD (IF CONCLUDED) */}
          {champions && (
            <div className="bg-navy rounded-3xl border border-slate-150 p-6 text-white text-center space-y-4 card-shadow" id="division-champions-podium">
              <Trophy className="h-12 w-12 text-[#FFE600] mx-auto animate-bounce" />
              <div className="space-y-1">
                <h3 className="text-lg font-black text-neon">Selamat Kepada Juara Divisi!</h3>
                <p className="text-slate-300 text-xs font-semibold">Divisi {division.eventName} {division.ageGroupName} telah selesai dimainkan.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto pt-2" id="champions-ranks">
                {/* 2nd Place */}
                <div className="bg-slate-800 rounded-2xl p-4 flex flex-col justify-between border border-slate-700 order-2 md:order-1 card-shadow">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Runner Up (Juara 2)</span>
                  <span className="font-extrabold text-sm block truncate text-slate-100">{getEntryLabel(champions.secondPlaceEntryId)}</span>
                </div>

                {/* 1st Place */}
                <div className="bg-[#FFE600] rounded-2xl p-5 flex flex-col justify-between text-navy border border-amber-450 card-shadow order-1 md:order-2 scale-105">
                  <span className="text-xs font-black text-navy uppercase tracking-wider block mb-1">🥇 Champion (Juara 1)</span>
                  <span className="font-black text-base block truncate">{getEntryLabel(champions.firstPlaceEntryId)}</span>
                </div>

                {/* 3rd Place */}
                <div className="bg-slate-800 rounded-2xl p-4 flex flex-col justify-between border border-slate-700 order-3 md:order-3 card-shadow">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 font-mono">Juara 3</span>
                  <span className="font-extrabold text-sm block truncate text-slate-100">{getEntryLabel(champions.thirdPlaceEntryId)}</span>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* KO SCORING MODAL */}
      {scoringMatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="ko-scoring-modal">
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-md w-full p-6 space-y-6" id="ko-scoring-modal-content">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-base">Input Hasil Babak Gugur</h4>
              <button onClick={closeKoScoreModal} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveKoScore} className="space-y-6">
              
              {/* Match status */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Status</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKoStatus('selesai')}
                    className={`py-2 text-xs font-extrabold rounded-lg border transition ${
                      koStatus === 'selesai'
                        ? 'bg-navy text-neon border-navy card-shadow'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Selesai (Normal)
                  </button>
                  <button
                    type="button"
                    onClick={() => setKoStatus('walkover')}
                    className={`py-2 text-xs font-extrabold rounded-lg border transition ${
                      koStatus === 'walkover'
                        ? 'bg-[#D15500] text-white border-[#D15500] card-shadow'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Walkover (WO)
                  </button>
                </div>
              </div>

              {koStatus === 'selesai' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-150">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-navy font-extrabold mb-1">Pemain 1</div>
                      <div className="font-extrabold text-slate-850 text-sm truncate">{getEntryLabel(scoringMatch.entryId1)}</div>
                    </div>
                    <input
                      type="number"
                      required
                      min="0"
                      id="ko-score-1-input"
                      value={score1}
                      onChange={(e) => setScore1(e.target.value)}
                      placeholder="Skor"
                      className="w-16 px-2.5 py-2 text-center text-lg font-bold font-mono rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-150">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-navy font-extrabold mb-1">Pemain 2</div>
                      <div className="font-extrabold text-slate-850 text-sm truncate">{getEntryLabel(scoringMatch.entryId2)}</div>
                    </div>
                    <input
                      type="number"
                      required
                      min="0"
                      id="ko-score-2-input"
                      value={score2}
                      onChange={(e) => setScore2(e.target.value)}
                      placeholder="Skor"
                      className="w-16 px-2.5 py-2 text-center text-lg font-bold font-mono rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2 p-4 rounded-xl bg-amber-50 border border-amber-100 text-sm">
                  <div className="flex items-center gap-1.5 text-amber-800 font-semibold text-xs mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-650" />
                    Pilih Pemenang Walkover (WO)
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    Pihak yang menang otomatis mendapatkan skor <strong>{settings.targetScore}</strong> dan pihak kalah mendapatkan skor <strong>0</strong>.
                  </p>

                  <div className="space-y-2">
                    {scoringMatch.entryId1 && (
                      <button
                        type="button"
                        onClick={() => setKoWinner(scoringMatch.entryId1 || '')}
                        className={`w-full p-3 rounded-lg border text-left font-extrabold text-xs transition flex items-center justify-between ${
                          koWinner === scoringMatch.entryId1
                            ? 'bg-navy text-neon border-navy card-shadow'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>{getEntryLabel(scoringMatch.entryId1)} (Menang WO)</span>
                        {koWinner === scoringMatch.entryId1 && <Check className="h-4 w-4" />}
                      </button>
                    )}

                    {scoringMatch.entryId2 && (
                      <button
                        type="button"
                        onClick={() => setKoWinner(scoringMatch.entryId2 || '')}
                        className={`w-full p-3 rounded-lg border text-left font-extrabold text-xs transition flex items-center justify-between ${
                          koWinner === scoringMatch.entryId2
                            ? 'bg-navy text-neon border-navy card-shadow'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>{getEntryLabel(scoringMatch.entryId2)} (Menang WO)</span>
                        {koWinner === scoringMatch.entryId2 && <Check className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeKoScoreModal}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  id="save-ko-score-submit"
                  className="px-5 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-extrabold rounded-lg transition card-shadow"
                >
                  Simpan Hasil
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

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
