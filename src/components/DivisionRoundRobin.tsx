/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Division, Match, Entry, GroupStandingRow } from '../types';
import { calculateGroupStandings } from '../utils/tournamentHelpers';
import { Award, Check, Eye, Edit3, Circle, ClipboardCheck, Trophy, RefreshCw, X, AlertCircle } from 'lucide-react';

interface DivisionRoundRobinProps {
  division: Division;
  onUpdateDivision: (updated: Division) => void;
  isAdmin?: boolean;
}

export default function DivisionRoundRobin({ division, onUpdateDivision, isAdmin = true }: DivisionRoundRobinProps) {
  const { entries, groups, roundRobinMatches, settings } = division;

  // Selected Group Filter
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  // Selected Status Filter
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');

  // Match Scoring Modal State
  const [scoringMatch, setScoringMatch] = useState<Match | null>(null);
  const [score1, setScore1] = useState<number | string>('');
  const [score2, setScore2] = useState<number | string>('');
  const [matchStatus, setMatchStatus] = useState<'belum_dimainkan' | 'selesai' | 'walkover'>('selesai');
  const [walkoverWinner, setWalkoverWinner] = useState<string>('');

  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [showAlert, setShowAlert] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // Calculate standings for each group
  const standingsByGroup: Record<string, GroupStandingRow[]> = {};
  groups.forEach(g => {
    standingsByGroup[g.id] = calculateGroupStandings(g, roundRobinMatches, entries);
  });

  // Open scoring modal
  const openScoringModal = (match: Match) => {
    setScoringMatch(match);
    setScore1(match.score1 ?? '');
    setScore2(match.score2 ?? '');
    setMatchStatus(match.status === 'belum_dimainkan' ? 'selesai' : match.status);
    setWalkoverWinner(match.winnerId || match.entryId1 || '');
  };

  // Close scoring modal
  const closeScoringModal = () => {
    setScoringMatch(null);
  };

  const executeCommitScore = (fs1: number, fs2: number, status: typeof matchStatus, wId: string | null, lId: string | null) => {
    const updatedMatches = roundRobinMatches.map(m => {
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

    onUpdateDivision({
      ...division,
      roundRobinMatches: updatedMatches
    });

    setScoringMatch(null);
  };

  // Save scores
  const saveScore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scoringMatch) return;

    let finalScore1 = 0;
    let finalScore2 = 0;
    let winnerId: string | null = null;
    let loserId: string | null = null;

    if (matchStatus === 'walkover') {
      const targetScore = settings.targetScore;
      if (walkoverWinner === scoringMatch.entryId1) {
        finalScore1 = targetScore;
        finalScore2 = 0;
        winnerId = scoringMatch.entryId1;
        loserId = scoringMatch.entryId2;
      } else {
        finalScore1 = 0;
        finalScore2 = targetScore;
        winnerId = scoringMatch.entryId2;
        loserId = scoringMatch.entryId1;
      }
      executeCommitScore(finalScore1, finalScore2, matchStatus, winnerId, loserId);
    } else {
      finalScore1 = parseInt(String(score1)) || 0;
      finalScore2 = parseInt(String(score2)) || 0;

      if (finalScore1 === finalScore2) {
        setShowAlert({
          title: 'Skor Seri',
          message: 'Skor seri tidak diperbolehkan dalam Pickleball. Harus ada pemenang.'
        });
        return;
      }

      // Check win-by-2 condition
      if (settings.winByTwo) {
        const diff = Math.abs(finalScore1 - finalScore2);
        const maxScore = Math.max(finalScore1, finalScore2);
        
        // If maxScore is less than target
        if (maxScore < settings.targetScore) {
          setShowConfirm({
            title: 'Simpan Skor di Bawah Target',
            message: `Skor tertinggi (${maxScore}) kurang dari target poin (${settings.targetScore}). Apakah Anda ingin tetap menyimpannya?`,
            onConfirm: () => {
              const wId = finalScore1 > finalScore2 ? scoringMatch.entryId1 : scoringMatch.entryId2;
              const lId = finalScore1 > finalScore2 ? scoringMatch.entryId2 : scoringMatch.entryId1;
              executeCommitScore(finalScore1, finalScore2, matchStatus, wId, lId);
              setShowConfirm(null);
            }
          });
          return;
        } else if (maxScore > settings.targetScore && diff < 2) {
          setShowAlert({
            title: 'Aturan Win by 2',
            message: `Game harus dimenangkan dengan selisih minimal 2 poin (Win by 2) saat mencapai target poin.`
          });
          return;
        }
      }

      if (finalScore1 > finalScore2) {
        winnerId = scoringMatch.entryId1;
        loserId = scoringMatch.entryId2;
      } else {
        winnerId = scoringMatch.entryId2;
        loserId = scoringMatch.entryId1;
      }

      executeCommitScore(finalScore1, finalScore2, matchStatus, winnerId, loserId);
    }
  };

  // Reset scores for a match
  const resetMatchScore = (matchId: string) => {
    setShowConfirm({
      title: 'Hapus Hasil Pertandingan',
      message: 'Apakah Anda yakin ingin menghapus hasil pertandingan ini?',
      onConfirm: () => {
        const updatedMatches = roundRobinMatches.map(m => {
          if (m.id === matchId) {
            return {
              ...m,
              score1: null,
              score2: null,
              status: 'belum_dimainkan' as const,
              winnerId: null,
              loserId: null
            };
          }
          return m;
        });

        onUpdateDivision({
          ...division,
          roundRobinMatches: updatedMatches
        });
        setShowConfirm(null);
      }
    });
  };

  // Filtered matches
  const filteredMatches = roundRobinMatches.filter(m => {
    const groupMatch = selectedGroupFilter === 'all' || m.groupName === selectedGroupFilter;
    const statusMatch = selectedStatusFilter === 'all' || 
      (selectedStatusFilter === 'played' && m.status !== 'belum_dimainkan') ||
      (selectedStatusFilter === 'unplayed' && m.status === 'belum_dimainkan');
    return groupMatch && statusMatch;
  });

  const getEntryLabel = (id: string | null) => {
    if (!id) return 'TBD';
    const ent = entries.find(e => e.id === id);
    if (!ent) return 'BYE';
    return `${ent.name1}${ent.name2 ? ` / ${ent.name2}` : ''}`;
  };

  return (
    <div className="space-y-8 animate-fade-in" id="division-round-robin-panel">
      {roundRobinMatches.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-150 p-6 card-shadow" id="empty-rr-matches">
          <ClipboardCheck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-base font-extrabold text-slate-700">Jadwal Round Robin belum di-generate.</p>
          <p className="text-sm text-slate-400 mt-1">Harap bagi grup terlebih dahulu di tab "Pembagian Grup" lalu klik "Generate Jadwal".</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8" id="rr-layout-grid">
          
          {/* COLUMN KIRI: KLASEMEN GRUP (XL: 5/12) */}
          <div className="xl:col-span-5 space-y-6" id="standings-column">
            <h3 className="text-base font-extrabold text-navy flex items-center gap-1.5">
              <Trophy className="h-5 w-5 text-neon stroke-navy fill-neon" />
              Klasemen Grup Otomatis
            </h3>

            {groups.map(group => {
              const rows = standingsByGroup[group.id] || [];
              return (
                <div key={group.id} className="bg-white rounded-2xl border border-slate-150 p-5 card-shadow" id={`standing-card-${group.id}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-extrabold text-navy text-sm">{group.name}</span>
                    <span className="text-[10px] text-navy bg-neon/15 px-2.5 py-0.5 rounded-full font-extrabold border border-neon/30">
                      Qualify: Top {settings.playersQualifyingPerGroup}
                    </span>
                  </div>

                  <div className="overflow-x-auto" id={`standing-table-container-${group.id}`}>
                    <table className="w-full text-left border-collapse" id={`standing-table-${group.id}`}>
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="p-2 text-center w-8">Rank</th>
                          <th className="p-2">Peserta</th>
                          <th className="p-2 text-center w-8">M</th>
                          <th className="p-2 text-center w-8">W</th>
                          <th className="p-2 text-center w-8">L</th>
                          <th className="p-2 text-center w-10">PF</th>
                          <th className="p-2 text-center w-10">PA</th>
                          <th className="p-2 text-center w-10">Diff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 text-xs">
                        {rows.map((row) => {
                          const isQualifying = row.rank <= settings.playersQualifyingPerGroup;
                          return (
                            <tr
                              key={row.entryId}
                              className={`hover:bg-slate-50/50 transition ${
                                isQualifying ? 'border-l-4 border-l-emerald-550' : 'border-l-4 border-l-transparent'
                              }`}
                              id={`standing-row-${group.id}-${row.entryId}`}
                            >
                              <td className="p-2 text-center">
                                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-extrabold text-[10px] ${
                                  row.rank === 1 ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                  row.rank === 2 ? 'bg-slate-100 text-slate-800 border border-slate-200' : 'text-slate-500'
                                }`}>
                                  {row.rank}
                                </span>
                              </td>
                              <td className="p-2 font-semibold text-slate-700 truncate max-w-[120px]" title={row.entryName}>
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate">{row.entryName}</span>
                                  {row.needsAdminDecision && (
                                    <span 
                                      className="inline-flex items-center justify-center text-[9px] text-rose-600 font-extrabold bg-rose-50 border border-rose-200 px-1 py-0.5 rounded cursor-help shrink-0" 
                                      title="Seri Sempurna! Peringkat sama persis setelah seluruh kriteria tie-breaker. Perlu keputusan manual admin saat penyusunan bracket."
                                    >
                                      ⚠️ TIE
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-2 text-center text-slate-550 font-medium">{row.played}</td>
                              <td className="p-2 text-center text-emerald-600 font-extrabold">{row.won}</td>
                              <td className="p-2 text-center text-rose-500 font-extrabold">{row.lost}</td>
                              <td className="p-2 text-center text-slate-600 font-mono">{row.pointsFor}</td>
                              <td className="p-2 text-center text-slate-600 font-mono">{row.pointsAgainst}</td>
                              <td className={`p-2 text-center font-bold font-mono ${
                                row.pointDifference > 0 ? 'text-emerald-600' : row.pointDifference < 0 ? 'text-rose-500' : 'text-slate-400'
                              }`}>
                                {row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>

          {/* COLUMN KANAN: PERTANDINGAN ROUND ROBIN (XL: 7/12) */}
          <div className="xl:col-span-7 space-y-4" id="matches-column">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
              <h3 className="text-base font-extrabold text-navy flex items-center gap-1.5">
                <ClipboardCheck className="h-5 w-5 text-neon stroke-navy fill-neon" />
                Pertandingan Fase Grup
              </h3>

              {/* Filters */}
              <div className="flex gap-2" id="rr-filters">
                <select
                  value={selectedGroupFilter}
                  onChange={(e) => setSelectedGroupFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-navy/15"
                >
                  <option value="all">Semua Grup</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.name}>{g.name}</option>
                  ))}
                </select>

                <select
                  value={selectedStatusFilter}
                  onChange={(e) => setSelectedStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-navy/15"
                >
                  <option value="all">Semua Status</option>
                  <option value="unplayed">Belum Dimainkan</option>
                  <option value="played">Selesai / Walkover</option>
                </select>
              </div>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1" id="rr-matches-list">
              {filteredMatches.map(match => {
                const isPlayed = match.status !== 'belum_dimainkan';
                const label1 = getEntryLabel(match.entryId1);
                const label2 = getEntryLabel(match.entryId2);

                return (
                  <div
                    key={match.id}
                    className="bg-white rounded-xl border border-slate-150 p-4 card-shadow hover:border-neon/30 transition-colors duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    id={`match-card-${match.id}`}
                  >
                    {/* Left details */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded">
                          {match.groupName}
                        </span>
                        {isPlayed && (
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${
                            match.status === 'walkover' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700 border border-emerald-150'
                          }`}>
                            {match.status}
                          </span>
                        )}
                      </div>
                      
                      {/* Match matchup */}
                      <div className="flex items-center gap-3 text-sm pt-1" id={`matchup-text-${match.id}`}>
                        <span className={`font-bold ${match.winnerId === match.entryId1 ? 'text-navy font-black' : 'text-slate-600'}`}>
                          {label1}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">vs</span>
                        <span className={`font-bold ${match.winnerId === match.entryId2 ? 'text-navy font-black' : 'text-slate-600'}`}>
                          {label2}
                        </span>
                      </div>
                    </div>

                    {/* Scores or Action Button */}
                    <div className="flex items-center gap-3 justify-end shrink-0" id={`match-actions-${match.id}`}>
                      {isPlayed ? (
                        <div className="flex items-center gap-4">
                          <div className="bg-slate-50 border border-slate-150 rounded-lg px-3 py-1 text-sm font-bold font-mono tracking-wider flex items-center gap-1.5 text-slate-700">
                            <span>{match.score1}</span>
                            <span className="text-slate-400">-</span>
                            <span>{match.score2}</span>
                          </div>
                          {isAdmin && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => openScoringModal(match)}
                                className="p-1.5 text-slate-400 hover:text-navy rounded transition bg-slate-50 border border-slate-200"
                                title="Edit Skor"
                                id={`edit-score-button-${match.id}`}
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => resetMatchScore(match.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-500 rounded transition bg-slate-50 border border-slate-200"
                                title="Hapus Skor"
                                id={`reset-score-button-${match.id}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        isAdmin ? (
                          <button
                            onClick={() => openScoringModal(match)}
                            className="px-3.5 py-1.5 bg-neon/15 hover:bg-navy text-navy hover:text-neon rounded-lg border border-neon/30 hover:border-navy text-xs font-extrabold transition card-shadow"
                            id={`score-match-button-${match.id}`}
                          >
                            Input Skor
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200 font-bold">
                            Belum Dimainkan
                          </span>
                        )
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {/* SCORING MODAL */}
      {scoringMatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="scoring-modal">
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-md w-full p-6 space-y-6" id="scoring-modal-content">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-base">Input Hasil Pertandingan</h4>
              <button onClick={closeScoringModal} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveScore} className="space-y-6">
              
              {/* Match status selector */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Status Pertandingan</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMatchStatus('selesai')}
                    className={`py-2 text-xs font-extrabold rounded-lg border transition ${
                      matchStatus === 'selesai'
                        ? 'bg-navy text-neon border-navy card-shadow'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Selesai (Normal)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatchStatus('walkover')}
                    className={`py-2 text-xs font-extrabold rounded-lg border transition ${
                      matchStatus === 'walkover'
                        ? 'bg-[#D15500] text-white border-[#D15500] card-shadow'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Walkover (WO)
                  </button>
                </div>
              </div>

              {/* Matchup layout */}
              {matchStatus === 'selesai' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-150">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-navy font-extrabold mb-1">Pemain 1</div>
                      <div className="font-extrabold text-slate-800 text-sm truncate">{getEntryLabel(scoringMatch.entryId1)}</div>
                    </div>
                    <input
                      type="number"
                      required
                      min="0"
                      id="score-1-input"
                      value={score1}
                      onChange={(e) => setScore1(e.target.value)}
                      placeholder="Skor"
                      className="w-16 px-2.5 py-2 text-center text-lg font-bold font-mono rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-150">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-navy font-extrabold mb-1">Pemain 2</div>
                      <div className="font-extrabold text-slate-800 text-sm truncate">{getEntryLabel(scoringMatch.entryId2)}</div>
                    </div>
                    <input
                      type="number"
                      required
                      min="0"
                      id="score-2-input"
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
                    <AlertCircle className="h-4 w-4 text-amber-650" />
                    Pilih Pemenang Walkover (WO)
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    Pihak yang menang akan otomatis mendapatkan skor <strong>{settings.targetScore}</strong> dan pihak kalah mendapatkan skor <strong>0</strong>.
                  </p>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setWalkoverWinner(scoringMatch.entryId1 || '')}
                      className={`w-full p-3 rounded-lg border text-left font-extrabold text-xs transition flex items-center justify-between ${
                        walkoverWinner === scoringMatch.entryId1
                          ? 'bg-navy text-neon border-navy card-shadow'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span>{getEntryLabel(scoringMatch.entryId1)} (Menang WO)</span>
                      {walkoverWinner === scoringMatch.entryId1 && <Check className="h-4 w-4" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setWalkoverWinner(scoringMatch.entryId2 || '')}
                      className={`w-full p-3 rounded-lg border text-left font-extrabold text-xs transition flex items-center justify-between ${
                        walkoverWinner === scoringMatch.entryId2
                          ? 'bg-navy text-neon border-navy card-shadow'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span>{getEntryLabel(scoringMatch.entryId2)} (Menang WO)</span>
                      {walkoverWinner === scoringMatch.entryId2 && <Check className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeScoringModal}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  id="save-score-submit-button"
                  className="px-5 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-extrabold rounded-lg transition card-shadow"
                >
                  Simpan Hasil
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
