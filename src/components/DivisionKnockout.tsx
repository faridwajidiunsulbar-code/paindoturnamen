/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect } from 'react';
import { Division, Match, Entry, GroupStandingRow, KnockoutStage, Champions, KnockoutSlot, BracketArrangementMode, GroupCrossPairing, ManualSlotAssignment } from '../types';
import { calculateGroupStandings, getDirectQualifiers, getWildcardCandidateRankings, buildSeedingAndSlots, generateKnockoutBracket, propagateKnockoutResult } from '../utils/tournamentHelpers';
import {
  getBracketHalf,
  getEarliestPossibleRound,
  validateBracketGroupSeparation,
  buildGroupCrossTemplateSlots,
  resolveBracketTemplateSlots,
  GroupSeparationConflict
} from '../utils/bracketArrangementHelpers';
import { Trophy, Check, Edit3, Lock, Unlock, AlertTriangle, ChevronRight, RefreshCw, X, Shuffle, Settings, Layers, UserCheck } from 'lucide-react';

interface DivisionKnockoutProps {
  division: Division;
  onUpdateDivision: (updated: Division) => void;
  isAdmin?: boolean;
}

export default function DivisionKnockout({ division, onUpdateDivision, isAdmin = true }: DivisionKnockoutProps) {
  const { entries, groups, roundRobinMatches, settings, knockoutStage, champions } = division;

  // PAINDO-008E Arrangement States
  const [bracketMode, setBracketMode] = useState<BracketArrangementMode>(
    knockoutStage?.bracketArrangementMode || 'automatic'
  );

  const [groupCrossPairings, setGroupCrossPairings] = useState<GroupCrossPairing[]>(
    knockoutStage?.groupCrossPairings || []
  );

  const [manualArrangementReason, setManualArrangementReason] = useState<string>(
    knockoutStage?.manualArrangementReason || ''
  );

  const [selectedSwapSeed, setSelectedSwapSeed] = useState<number | null>(null);

  // Manual Slot Assignment state & slot source editor modal
  const [manualSlotAssignmentsState, setManualSlotAssignmentsState] = useState<Record<string, ManualSlotAssignment>>(
    knockoutStage?.manualSlotAssignments || {}
  );
  const [editingSlotSeed, setEditingSlotSeed] = useState<number | null>(null);
  const [slotEditType, setSlotEditType] = useState<'group_rank' | 'wildcard_rank' | 'bye' | 'manual'>('group_rank');
  const [slotEditGroupId, setSlotEditGroupId] = useState<string>('');
  const [slotEditGroupRank, setSlotEditGroupRank] = useState<number>(1);
  const [slotEditWildcardRank, setSlotEditWildcardRank] = useState<number>(1);
  const [slotEditEntryId, setSlotEditEntryId] = useState<string>('');

  // Wildcard tie admin decision modal state
  const [showWildcardTieModal, setShowWildcardTieModal] = useState(false);
  const [wildcardManualRankings, setWildcardManualRankings] = useState<Record<string, number>>(
    knockoutStage?.wildcardManualRankings || {}
  );
  const [wildcardManualReason, setWildcardManualReason] = useState<string>(
    knockoutStage?.wildcardManualReason || ''
  );

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

  // 1. COMPUTE PAINDO-008 STANDINGS, QUALIFIERS, WILDCARDS, & SEEDING
  const standingsByGroup: Record<string, GroupStandingRow[]> = {};
  groups.forEach(g => {
    standingsByGroup[g.id] = calculateGroupStandings(g, roundRobinMatches, entries, settings.playersQualifyingPerGroup || 2);
  });

  const directQualifiers = getDirectQualifiers(
    standingsByGroup,
    groups,
    settings.playersQualifyingPerGroup || 2
  );

  const wildcardAnalysis = getWildcardCandidateRankings(
    standingsByGroup,
    groups,
    settings.playersQualifyingPerGroup || 2,
    settings.bracketSize,
    knockoutStage?.wildcardManualRankings || wildcardManualRankings
  );

  const seedingAnalysis = buildSeedingAndSlots(
    standingsByGroup,
    groups,
    settings.playersQualifyingPerGroup || 2,
    wildcardAnalysis.selectedWildcardEntryIds,
    wildcardAnalysis.candidates,
    settings.bracketSize
  );

  const isGroupPhaseComplete = roundRobinMatches.length > 0 && roundRobinMatches.every(m => m.status === 'selesai' || m.status === 'walkover');
  const hasCompletedMatches = !!knockoutStage?.matches.some(m => m.status === 'selesai' || m.status === 'walkover');

  // Auto-invalidation check for stale wildcard or group structure changes
  useEffect(() => {
    if (knockoutStage && !hasCompletedMatches) {
      if (knockoutStage.wildcardManualCluster) {
        const currentTiedEntryIds = wildcardAnalysis.candidates
          .filter(c => c.tieStatus)
          .map(c => c.entryId)
          .sort();
        const storedTiedEntryIds = [...knockoutStage.wildcardManualCluster.entryIds].sort();
        const currentMode = wildcardAnalysis.isNormalizedStats ? 'normalized' : 'total';

        const sameMode = knockoutStage.wildcardManualCluster.rankingMode === currentMode;
        const sameCluster =
          currentTiedEntryIds.length === storedTiedEntryIds.length &&
          currentTiedEntryIds.every((id, idx) => id === storedTiedEntryIds[idx]);

        if (!sameMode || !sameCluster) {
          console.warn('[Invalidation] Group standings or tie cluster changed before KO start. Clearing stale wildcard decision.');
          onUpdateDivision({
            ...division,
            knockoutStage: {
              ...knockoutStage,
              wildcardManualRankings: undefined,
              wildcardManualReason: undefined,
              wildcardManualCluster: undefined,
              arrangementInvalidatedReason: 'Hasil grup berubah. Keputusan wildcard lama diinvalidasi.'
            }
          });
          setWildcardManualRankings({});
          setWildcardManualReason('');
        }
      }
    }
  }, [roundRobinMatches, groups, settings]);

  const buildManualSlotsFromAssignments = (): KnockoutSlot[] => {
    const baseSlots = [...seedingAnalysis.slots];
    return baseSlots.map((baseSlot) => {
      const assign = manualSlotAssignmentsState[baseSlot.seedNo];
      if (!assign) return baseSlot;

      if (assign.sourceType === 'group_rank' && assign.sourceGroupId && assign.sourceGroupRank) {
        const grp = groups.find(g => g.id === assign.sourceGroupId || g.id.startsWith(assign.sourceGroupId + '-') || assign.sourceGroupId.startsWith(g.id + '-'));
        const grpName = grp ? grp.name : assign.sourceGroupId;
        const rankLabel = assign.sourceGroupRank === 1 ? 'Juara' : (assign.sourceGroupRank === 2 ? 'Runner-up' : `P${assign.sourceGroupRank}`);
        return {
          ...baseSlot,
          qualificationType: 'group',
          sourceGroupId: assign.sourceGroupId,
          sourceGroupName: grpName,
          sourceGroupRank: assign.sourceGroupRank,
          sourceLabel: `${rankLabel} ${grpName}`,
          isWildcard: false,
          isBye: false,
          entryId: null
        };
      } else if (assign.sourceType === 'wildcard_rank' && assign.wildcardRank) {
        return {
          ...baseSlot,
          qualificationType: 'wildcard',
          wildcardRank: assign.wildcardRank,
          sourceLabel: `Wildcard ${assign.wildcardRank}`,
          isWildcard: true,
          isBye: false,
          entryId: null
        };
      } else if (assign.sourceType === 'bye') {
        return {
          ...baseSlot,
          qualificationType: 'bye',
          sourceLabel: `BYE Slot ${baseSlot.seedNo}`,
          isWildcard: false,
          isBye: true,
          entryId: null
        };
      } else if (assign.sourceType === 'manual' && assign.manualEntryId) {
        const ent = entries.find(e => e.id === assign.manualEntryId);
        const name = ent ? `${ent.name1}${ent.name2 ? ` / ${ent.name2}` : ''}` : 'Peserta Manual';
        return {
          ...baseSlot,
          qualificationType: 'group',
          entryId: assign.manualEntryId,
          sourceLabel: name,
          isWildcard: false,
          isBye: false
        };
      }

      return baseSlot;
    });
  };

  // Determine active slots based on arrangement mode
  const getActiveTemplateSlots = (): KnockoutSlot[] => {
    if (bracketMode === 'group_cross') {
      return buildGroupCrossTemplateSlots(
        groups,
        groupCrossPairings,
        settings.playersQualifyingPerGroup || 2,
        wildcardAnalysis.selectedWildcardEntryIds.length,
        settings.bracketSize
      );
    } else if (bracketMode === 'manual') {
      if (Object.keys(manualSlotAssignmentsState).length > 0) {
        return buildManualSlotsFromAssignments();
      } else if (knockoutStage?.slots && knockoutStage.slots.length === settings.bracketSize) {
        return knockoutStage.slots;
      } else {
        return seedingAnalysis.slots;
      }
    } else {
      return seedingAnalysis.slots;
    }
  };

  const activeSlots = getActiveTemplateSlots();

  // Validate group separation
  const separationValidation = validateBracketGroupSeparation(activeSlots, settings.bracketSize);

  // Handle Mode Selection
  const handleModeChange = (mode: BracketArrangementMode) => {
    if (hasCompletedMatches) {
      setShowAlert({
        title: 'Pertandingan Berlangsung',
        message: 'Pengaturan mode bracket tidak dapat diubah karena pertandingan fase gugur telah dimainkan.'
      });
      return;
    }
    setBracketMode(mode);
    if (mode === 'group_cross' && groupCrossPairings.length === 0) {
      // Auto generate initial pairs if empty
      const initialPairs: GroupCrossPairing[] = [];
      for (let i = 0; i < groups.length - 1; i += 2) {
        initialPairs.push({
          id: `pairing-${i}`,
          groupOneId: groups[i].id,
          groupTwoId: groups[i + 1].id,
          order: initialPairs.length + 1
        });
      }
      setGroupCrossPairings(initialPairs);
    }
  };

  // Group Cross Pair Handlers
  const handleAddPairing = () => {
    const available = groups.filter(g => !groupCrossPairings.some(p => p.groupOneId === g.id || p.groupTwoId === g.id));
    if (available.length < 2) {
      setShowAlert({
        title: 'Grup Tidak Cukup',
        message: 'Tidak cukup grup bebas yang tersisa untuk membuat pasangan silang baru.'
      });
      return;
    }
    setGroupCrossPairings([
      ...groupCrossPairings,
      {
        id: `pairing-${Date.now()}`,
        groupOneId: available[0].id,
        groupTwoId: available[1].id,
        order: groupCrossPairings.length + 1
      }
    ]);
  };

  const handleUpdatePairing = (index: number, g1Id: string, g2Id: string) => {
    const updated = [...groupCrossPairings];
    updated[index] = { ...updated[index], groupOneId: g1Id, groupTwoId: g2Id };
    setGroupCrossPairings(updated);
  };

  const handleRemovePairing = (index: number) => {
    const updated = groupCrossPairings.filter((_, idx) => idx !== index);
    setGroupCrossPairings(updated);
  };

  // Manual Swap Handler
  const handleSlotClick = (seedNo: number) => {
    if (hasCompletedMatches || knockoutStage?.arrangementLocked) return;

    if (selectedSwapSeed === null) {
      setSelectedSwapSeed(seedNo);
    } else if (selectedSwapSeed === seedNo) {
      setSelectedSwapSeed(null);
    } else {
      // Swap seeds
      const currentSlots = [...activeSlots];
      const idxA = currentSlots.findIndex(s => s.seedNo === selectedSwapSeed);
      const idxB = currentSlots.findIndex(s => s.seedNo === seedNo);

      if (idxA !== -1 && idxB !== -1) {
        const temp = { ...currentSlots[idxA], seedNo: currentSlots[idxB].seedNo };
        currentSlots[idxA] = { ...currentSlots[idxB], seedNo: currentSlots[idxA].seedNo };
        currentSlots[idxB] = temp;

        const updatedConfirmed = currentSlots.map(s => s.entryId || 'BYE');
        const freshMatches = generateKnockoutBracket(division.id, updatedConfirmed, settings.bracketSize);

        onUpdateDivision({
          ...division,
          knockoutStage: {
            matches: freshMatches,
            isLocked: false,
            confirmedEntryIds: updatedConfirmed,
            slots: currentSlots,
            bracketArrangementMode: 'manual',
            groupCrossPairings,
            manualArrangementReason,
            arrangementLocked: false
          }
        });
      }
      setSelectedSwapSeed(null);
    }
  };

  // Save Template Projection / Manual Setup
  const handleSaveTemplate = () => {
    if (bracketMode === 'manual' && !manualArrangementReason.trim()) {
      setShowAlert({
        title: 'Alasan Wajib Diisi ⚠️',
        message: 'Pengaturan mode manual memerlukan catatan alasan pengaturan oleh admin.'
      });
      return;
    }

    const resolved = resolveBracketTemplateSlots(
      activeSlots,
      standingsByGroup,
      wildcardAnalysis.candidates,
      wildcardAnalysis.selectedWildcardEntryIds,
      entries
    );

    const confirmedEntryIds = resolved.resolvedSlots.map(s => s.entryId || 'BYE');
    const freshMatches = generateKnockoutBracket(division.id, confirmedEntryIds, settings.bracketSize);

    onUpdateDivision({
      ...division,
      knockoutStage: {
        matches: freshMatches,
        isLocked: false,
        confirmedEntryIds,
        slots: resolved.resolvedSlots,
        wildcardCandidates: wildcardAnalysis.candidates,
        wildcardManualRankings,
        wildcardManualReason,
        bracketArrangementMode: bracketMode,
        groupCrossPairings,
        manualSlotAssignments: manualSlotAssignmentsState,
        manualArrangementReason,
        arrangementConfirmedAt: new Date().toISOString(),
        arrangementLocked: false,
        arrangementInvalidatedReason: undefined
      }
    });

    setShowAlert({
      title: 'Template Tersimpan ✅',
      message: 'Template susunan bracket telah berhasil disimpan. Anda dapat mengonfirmasi dan mengunci bracket jika siap.'
    });
  };

  // Confirm and Lock Bracket
  const handleConfirmAndLock = () => {
    if (bracketMode === 'manual' && (!manualArrangementReason || manualArrangementReason.trim().length < 5)) {
      setShowAlert({
        title: 'Catatan Alasan Diperlukan ⚠️',
        message: 'Harap isi catatan alasan pengaturan manual admin minimal 5 karakter sebelum mengonfirmasi bracket.'
      });
      return;
    }

    const resolved = resolveBracketTemplateSlots(
      activeSlots,
      standingsByGroup,
      wildcardAnalysis.candidates,
      wildcardAnalysis.selectedWildcardEntryIds,
      entries
    );

    const confirmedEntryIds = resolved.resolvedSlots.map(s => s.entryId || 'BYE');

    // Run propagation loop for BYEs
    let updatedMatches = generateKnockoutBracket(division.id, confirmedEntryIds, settings.bracketSize);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < updatedMatches.length; i++) {
        const m = updatedMatches[i];
        if (m.status === 'belum_dimainkan') {
          if (m.entryId1 && (!m.entryId2 || m.entryId2 === 'BYE')) {
            m.status = 'selesai';
            m.score1 = 1;
            m.score2 = 0;
            m.winnerId = m.entryId1;
            m.loserId = 'BYE';
            updatedMatches = propagateKnockoutResult(updatedMatches, m.matchNum!, m.entryId1, 'BYE');
            changed = true;
          } else if (m.entryId2 && (!m.entryId1 || m.entryId1 === 'BYE')) {
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
        matches: updatedMatches,
        isLocked: true,
        confirmedEntryIds,
        slots: resolved.resolvedSlots,
        wildcardCandidates: wildcardAnalysis.candidates,
        wildcardManualRankings,
        wildcardManualReason,
        bracketArrangementMode: bracketMode,
        groupCrossPairings,
        manualSlotAssignments: manualSlotAssignmentsState,
        manualArrangementReason,
        arrangementConfirmedAt: new Date().toISOString(),
        arrangementLocked: true,
        arrangementInvalidatedReason: undefined
      }
    });

    setShowAlert({
      title: 'Bracket Terkunci & Siap Dimainkan 🔒',
      message: 'Susunan bracket telah dikonfirmasi dan dikunci. Pertandingan fase gugur siap dimainkan.'
    });
  };

  // Reopen Bracket Arrangement
  const handleReopenArrangement = () => {
    if (hasCompletedMatches) {
      setShowAlert({
        title: 'Tidak Dapat Dibuka 🛑',
        message: 'Bracket tidak dapat dibuka kembali karena terdapat pertandingan fase gugur yang sudah selesai dimainkan.'
      });
      return;
    }

    setShowConfirm({
      title: 'Buka Kembali Susunan Bracket',
      message: 'Apakah Anda yakin ingin membuka kembali susunan bracket? Anda akan dapat mengubah mode dan posisi slot peserta.',
      onConfirm: () => {
        onUpdateDivision({
          ...division,
          knockoutStage: {
            ...knockoutStage!,
            isLocked: false,
            arrangementLocked: false
          }
        });
        setShowConfirm(null);
      }
    });
  };

  // Match Scoring Handlers
  const openKoScoreModal = (match: Match) => {
    setScoringMatch(match);
    setScore1(match.score1 ?? '');
    setScore2(match.score2 ?? '');
    setKoStatus(match.status === 'belum_dimainkan' ? 'selesai' : match.status);
    setKoWinner(match.winnerId || match.entryId1 || '');
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

      executeCommitKoScore(finalScore1, finalScore2, koStatus, finalScore1 > finalScore2 ? scoringMatch.entryId1 || '' : scoringMatch.entryId2 || '', finalScore1 > finalScore2 ? scoringMatch.entryId2 || '' : scoringMatch.entryId1 || '');
    }
  };

  const getEntryLabel = (id: string | null) => {
    if (!id) return 'TBD';
    if (id === 'BYE') return 'BYE (Lolos Langsung)';
    const ent = entries.find(e => e.id === id);
    if (!ent) return 'BYE';
    return `${ent.name1}${ent.name2 ? ` / ${ent.name2}` : ''}`;
  };

  const getMatchesByRound = (): Record<string, Match[]> => {
    if (!knockoutStage) return {};
    const result: Record<string, Match[]> = {};
    
    knockoutStage.matches.forEach(m => {
      if (m.isBronzeMatch) return;
      const rName = m.roundName || 'Lainnya';
      if (!result[rName]) {
        result[rName] = [];
      }
      result[rName].push(m);
    });

    return result;
  };

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
      
      {/* PAINDO-008E: BRACKET ARRANGEMENT & CONTROL SYSTEM */}
      {isAdmin && (
        <div className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow space-y-6" id="bracket-arrangement-manager">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-150 gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
                <Settings className="h-5 w-5 text-neon stroke-navy fill-neon" />
                Pengaturan Susunan Bracket (PAINDO-008E)
              </h3>
              <p className="text-xs text-slate-400">
                Pilih mode susunan bracket, silangkan grup, atau atur slot secara manual sebelum mengunci bracket.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {knockoutStage?.arrangementLocked ? (
                <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-black flex items-center gap-1.5 border border-emerald-300">
                  <Lock className="h-4 w-4 text-emerald-700" /> Bracket Terkunci
                </span>
              ) : (
                <span className="px-3 py-1.5 bg-amber-100 text-amber-800 rounded-xl text-xs font-black flex items-center gap-1.5 border border-amber-300">
                  <Unlock className="h-4 w-4 text-amber-700" /> Mode DRAFT / Editable
                </span>
              )}
            </div>
          </div>

          {/* Mode Selector Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="bracket-mode-selector">
            
            {/* Automatic Mode */}
            <button
              type="button"
              disabled={hasCompletedMatches || knockoutStage?.arrangementLocked}
              onClick={() => handleModeChange('automatic')}
              className={`p-4 rounded-xl border text-left transition relative flex flex-col justify-between ${
                bracketMode === 'automatic'
                  ? 'border-navy bg-navy/5 ring-2 ring-navy/20'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${(hasCompletedMatches || knockoutStage?.arrangementLocked) ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-navy uppercase tracking-wider flex items-center gap-1.5">
                    <Shuffle className="h-4 w-4 text-navy" /> Otomatis
                  </span>
                  {bracketMode === 'automatic' && (
                    <span className="text-[10px] font-bold bg-navy text-neon px-2 py-0.5 rounded-full">Aktif</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Seeding otomatis standar berdasar tier peringkat grup & rasio wildcard.
                </p>
              </div>
            </button>

            {/* Group Cross Mode */}
            <button
              type="button"
              disabled={hasCompletedMatches || knockoutStage?.arrangementLocked}
              onClick={() => handleModeChange('group_cross')}
              className={`p-4 rounded-xl border text-left transition relative flex flex-col justify-between ${
                bracketMode === 'group_cross'
                  ? 'border-navy bg-navy/5 ring-2 ring-navy/20'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${(hasCompletedMatches || knockoutStage?.arrangementLocked) ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-navy uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-navy" /> Silang Grup
                  </span>
                  {bracketMode === 'group_cross' && (
                    <span className="text-[10px] font-bold bg-navy text-neon px-2 py-0.5 rounded-full">Aktif</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Pasangkan grup simetris (Juara Grup 1 vs Runner-up Grup 2) pada paruh bracket berbeda.
                </p>
              </div>
            </button>

            {/* Manual Mode */}
            <button
              type="button"
              disabled={hasCompletedMatches || knockoutStage?.arrangementLocked}
              onClick={() => handleModeChange('manual')}
              className={`p-4 rounded-xl border text-left transition relative flex flex-col justify-between ${
                bracketMode === 'manual'
                  ? 'border-navy bg-navy/5 ring-2 ring-navy/20'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${(hasCompletedMatches || knockoutStage?.arrangementLocked) ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-navy uppercase tracking-wider flex items-center gap-1.5">
                    <Edit3 className="h-4 w-4 text-navy" /> Manual Admin
                  </span>
                  {bracketMode === 'manual' && (
                    <span className="text-[10px] font-bold bg-navy text-neon px-2 py-0.5 rounded-full">Aktif</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Penempatan posisi slot bebas oleh admin dengan mewajibkan alasan pengaturan.
                </p>
              </div>
            </button>

          </div>

          {/* Group Cross Configuration Panel */}
          {bracketMode === 'group_cross' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4" id="group-cross-configurator">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-xs font-extrabold text-navy uppercase tracking-wider">
                  Pasangan Silang Grup ({groupCrossPairings.length} Pasangan)
                </span>
                {!knockoutStage?.arrangementLocked && (
                  <button
                    type="button"
                    onClick={handleAddPairing}
                    className="px-3 py-1 bg-navy hover:bg-navy-light text-neon rounded-lg text-xs font-bold transition flex items-center gap-1"
                  >
                    + Tambah Pasangan Grup
                  </button>
                )}
              </div>

              {groups.length % 2 !== 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Jumlah grup ganjil ({groups.length} grup). Satu grup tidak dapat dipasangkan secara simetris dan akan ditempatkan di slot tersisa.</span>
                </div>
              )}

              <div className="space-y-2">
                {groupCrossPairings.map((pairing, idx) => (
                  <div key={pairing.id || idx} className="p-3 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-500 shrink-0 font-mono">Pasangan #{idx + 1}</span>
                    <div className="flex items-center gap-2 flex-1">
                      <select
                        disabled={knockoutStage?.arrangementLocked}
                        value={pairing.groupOneId}
                        onChange={e => handleUpdatePairing(idx, e.target.value, pairing.groupTwoId)}
                        className="p-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-slate-700 flex-1"
                      >
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <span className="text-xs font-black text-navy shrink-0">⚔️ SILANG</span>
                      <select
                        disabled={knockoutStage?.arrangementLocked}
                        value={pairing.groupTwoId}
                        onChange={e => handleUpdatePairing(idx, pairing.groupOneId, e.target.value)}
                        className="p-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-slate-700 flex-1"
                      >
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>

                    {!knockoutStage?.arrangementLocked && (
                      <button
                        type="button"
                        onClick={() => handleRemovePairing(idx)}
                        className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                        title="Hapus Pasangan"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual Mode Reason Input */}
          {bracketMode === 'manual' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2" id="manual-mode-reason">
              <label className="text-xs font-extrabold text-navy uppercase tracking-wider block">
                Alasan Pengaturan Manual Admin (Wajib)
              </label>
              <textarea
                disabled={knockoutStage?.arrangementLocked}
                value={manualArrangementReason}
                onChange={e => setManualArrangementReason(e.target.value)}
                placeholder="Tuliskan alasan pengaturan manual susunan bracket oleh admin (minimal 5 karakter)..."
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-navy h-20"
              />
            </div>
          )}

          {/* Group Separation Validation Warnings */}
          {!separationValidation.valid && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2" id="group-separation-warning">
              <div className="flex items-center gap-2 text-amber-800 font-extrabold text-xs uppercase tracking-wider">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                Potensi Pertemuan Dini Sesama Grup
              </div>
              <ul className="space-y-1 pl-6 list-disc text-xs text-amber-900">
                {separationValidation.conflicts.map((conf, idx) => (
                  <li key={idx}>
                    {conf.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between pt-4 border-t border-slate-150 gap-3">
            <div className="text-xs text-slate-400">
              {isGroupPhaseComplete ? (
                <span className="text-emerald-600 font-extrabold flex items-center gap-1">
                  <Check className="h-4 w-4" /> Hasil Fase Grup Final
                </span>
              ) : (
                <span className="text-amber-600 font-extrabold flex items-center gap-1">
                  📌 Template Proyeksi (Fase Grup Berlangsung)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {!knockoutStage?.arrangementLocked ? (
                <>
                  <button
                    type="button"
                    onClick={handleSaveTemplate}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold rounded-xl transition flex items-center gap-1.5 flex-1 sm:flex-initial justify-center"
                  >
                    Simpan Template
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAndLock}
                    className="px-4 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-extrabold rounded-xl transition flex items-center gap-1.5 flex-1 sm:flex-initial justify-center card-shadow"
                  >
                    <Lock className="h-4 w-4 text-neon" /> Konfirmasi & Kunci Bracket
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={hasCompletedMatches}
                  onClick={handleReopenArrangement}
                  className={`px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold rounded-xl transition flex items-center gap-1.5 flex-1 sm:flex-initial justify-center ${
                    hasCompletedMatches ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <Unlock className="h-4 w-4" /> Buka Kembali Susunan
                </button>
              )}
            </div>
          </div>

        </div>
      )}

      {/* RENDER ACTIVE BRACKET SLOTS & MATCHES */}
      {knockoutStage && (
        <div className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-150">
            <div>
              <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
                <Trophy className="h-5 w-5 text-neon stroke-navy fill-neon" />
                Bracket Fase Gugur ({settings.bracketSize} Besar)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Susunan resmi babak gugur divisi {division.eventName} {division.ageGroupName}.
              </p>
            </div>

            <span className={`text-xs font-black px-3 py-1 rounded-xl border ${
              knockoutStage.isLocked
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              {knockoutStage.isLocked ? 'BERLANGSUNG' : 'DRAFT'}
            </span>
          </div>

          {/* Slot Grid Visualizer */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3" id="active-slots-visualizer">
            {activeSlots.map((slot, idx) => {
              const isSelected = selectedSwapSeed === slot.seedNo;
              const half = getBracketHalf(slot.seedNo, settings.bracketSize);

              return (
                <div
                  key={idx}
                  onClick={() => handleSlotClick(slot.seedNo)}
                  className={`p-3 rounded-xl border transition cursor-pointer relative ${
                    isSelected
                      ? 'bg-navy/10 border-navy ring-2 ring-navy'
                      : half === 'upper'
                      ? 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
                      : 'bg-slate-100/80 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black text-navy font-mono">Seed #{slot.seedNo}</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded font-mono ${
                      half === 'upper' ? 'bg-sky-100 text-sky-800' : 'bg-indigo-100 text-indigo-800'
                    }`}>
                      {half === 'upper' ? 'Paruh Atas' : 'Paruh Bawah'}
                    </span>
                  </div>

                  <div className="text-xs font-bold text-slate-800 truncate">
                    {slot.entryId ? getEntryLabel(slot.entryId) : slot.sourceLabel}
                  </div>

                  <div className="flex items-center justify-between mt-1">
                    {slot.sourceGroupName ? (
                      <div className="text-[10px] text-slate-400 font-mono">
                        Grup {slot.sourceGroupName} (R{slot.sourceGroupRank})
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 font-mono">
                        {slot.isBye ? 'BYE' : slot.isWildcard ? `Wildcard #${slot.wildcardRank}` : 'Slot Manual'}
                      </div>
                    )}

                    {bracketMode === 'manual' && isAdmin && !knockoutStage?.arrangementLocked && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSlotSeed(slot.seedNo);
                          const cur = manualSlotAssignmentsState[slot.seedNo];
                          if (cur) {
                            setSlotEditType(cur.sourceType);
                            setSlotEditGroupId(cur.sourceGroupId || groups[0]?.id || '');
                            setSlotEditGroupRank(cur.sourceGroupRank || 1);
                            setSlotEditWildcardRank(cur.wildcardRank || 1);
                            setSlotEditEntryId(cur.manualEntryId || entries[0]?.id || '');
                          } else {
                            setSlotEditType(slot.qualificationType === 'wildcard' ? 'wildcard_rank' : (slot.qualificationType === 'bye' ? 'bye' : 'group_rank'));
                            setSlotEditGroupId(slot.sourceGroupId || groups[0]?.id || '');
                            setSlotEditGroupRank(slot.sourceGroupRank || 1);
                            setSlotEditWildcardRank(slot.wildcardRank || 1);
                            setSlotEditEntryId(entries[0]?.id || '');
                          }
                        }}
                        className="text-[10px] font-extrabold text-navy hover:text-navy-light underline px-1 py-0.5"
                      >
                        Atur Sumber
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bracket Tree Matches */}
          <div className="overflow-x-auto pt-4" id="bracket-matches-tree">
            <div className="flex items-start gap-8 min-w-max pb-4">
              {orderedRoundNames().map((roundName) => {
                const roundMatches = getMatchesByRound()[roundName] || [];
                return (
                  <div key={roundName} className="flex-1 space-y-4 min-w-[220px]">
                    <div className="text-center font-extrabold text-xs text-navy uppercase tracking-wider pb-2 border-b border-slate-150">
                      {roundName}
                    </div>

                    <div className="space-y-6">
                      {roundMatches.map(m => (
                        <div
                          key={m.id}
                          className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 card-shadow hover:border-slate-300 transition"
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400">
                            <span>Match #{m.matchNum}</span>
                            <span>{m.status === 'selesai' ? 'SELESAI' : 'BELUM'}</span>
                          </div>

                          <div className="space-y-1.5 text-xs font-bold">
                            <div className={`p-1.5 rounded flex items-center justify-between ${
                              m.winnerId === m.entryId1 && m.entryId1 ? 'bg-emerald-100 text-emerald-900 font-black' : 'bg-white text-slate-700'
                            }`}>
                              <span className="truncate">{getEntryLabel(m.entryId1)}</span>
                              <span className="font-mono text-xs">{m.score1 ?? '-'}</span>
                            </div>

                            <div className={`p-1.5 rounded flex items-center justify-between ${
                              m.winnerId === m.entryId2 && m.entryId2 ? 'bg-emerald-100 text-emerald-900 font-black' : 'bg-white text-slate-700'
                            }`}>
                              <span className="truncate">{getEntryLabel(m.entryId2)}</span>
                              <span className="font-mono text-xs">{m.score2 ?? '-'}</span>
                            </div>
                          </div>

                          {isAdmin && m.entryId1 && m.entryId2 && m.entryId1 !== 'BYE' && m.entryId2 !== 'BYE' && (
                            <button
                              type="button"
                              onClick={() => openKoScoreModal(m)}
                              className="w-full mt-2 py-1 bg-navy text-neon rounded-lg text-[10px] font-extrabold hover:bg-navy-light transition flex items-center justify-center gap-1"
                            >
                              <Edit3 className="h-3 w-3" /> Input Skor
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {/* Match Scoring Modal */}
      {scoringMatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm">Input Skor Match #{scoringMatch.matchNum}</h4>
              <button onClick={() => setScoringMatch(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveKoScore} className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-600 block">{getEntryLabel(scoringMatch.entryId1)}</label>
                  <input
                    type="number"
                    value={score1}
                    onChange={e => setScore1(e.target.value)}
                    placeholder="0"
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-600 block">{getEntryLabel(scoringMatch.entryId2)}</label>
                  <input
                    type="number"
                    value={score2}
                    onChange={e => setScore2(e.target.value)}
                    placeholder="0"
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setScoringMatch(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-bold rounded-xl card-shadow"
                >
                  Simpan Skor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slot Source Editor Modal */}
      {editingSlotSeed !== null && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-navy" />
                Pengaturan Sumber Slot Seed #{editingSlotSeed}
              </h4>
              <button
                type="button"
                onClick={() => setEditingSlotSeed(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-extrabold text-navy block">Tipe Sumber Slot</label>
                <select
                  value={slotEditType}
                  onChange={(e) => setSlotEditType(e.target.value as any)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-navy"
                >
                  <option value="group_rank">Lolos Grup (Grup & Peringkat)</option>
                  <option value="wildcard_rank">Lolos Wildcard</option>
                  <option value="bye">BYE (Slot Kosong)</option>
                  <option value="manual">Peserta Spesifik (Manual Direct)</option>
                </select>
              </div>

              {slotEditType === 'group_rank' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-600 block">Pilih Grup</label>
                    <select
                      value={slotEditGroupId}
                      onChange={(e) => setSlotEditGroupId(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-navy"
                    >
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>Grup {g.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-600 block">Peringkat Grup</label>
                    <select
                      value={slotEditGroupRank}
                      onChange={(e) => setSlotEditGroupRank(Number(e.target.value))}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-navy"
                    >
                      {Array.from({ length: settings.playersQualifyingPerGroup || 2 }, (_, i) => i + 1).map((r) => (
                        <option key={r} value={r}>
                          {r === 1 ? 'Juara (1)' : r === 2 ? 'Runner-up (2)' : `Peringkat ${r}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {slotEditType === 'wildcard_rank' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-600 block">Peringkat Wildcard</label>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={slotEditWildcardRank}
                    onChange={(e) => setSlotEditWildcardRank(Number(e.target.value))}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold font-mono text-navy"
                  />
                </div>
              )}

              {slotEditType === 'manual' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-600 block">Pilih Peserta</label>
                  <select
                    value={slotEditEntryId}
                    onChange={(e) => setSlotEditEntryId(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-navy"
                  >
                    {entries.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name1}{e.name2 ? ` / ${e.name2}` : ''} ({e.affiliation || 'Tanpa Klub'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSlotSeed(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editingSlotSeed === null) return;
                    const newAssign: ManualSlotAssignment = {
                      seedNo: editingSlotSeed,
                      sourceType: slotEditType,
                      sourceGroupId: slotEditType === 'group_rank' ? (slotEditGroupId || groups[0]?.id) : undefined,
                      sourceGroupRank: slotEditType === 'group_rank' ? slotEditGroupRank : undefined,
                      wildcardRank: slotEditType === 'wildcard_rank' ? slotEditWildcardRank : undefined,
                      manualEntryId: slotEditType === 'manual' ? (slotEditEntryId || entries[0]?.id) : undefined
                    };
                    setManualSlotAssignmentsState({
                      ...manualSlotAssignmentsState,
                      [editingSlotSeed]: newAssign
                    });
                    setEditingSlotSeed(null);
                  }}
                  className="px-4 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-bold rounded-xl card-shadow"
                >
                  Simpan Sumber Slot
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 card-shadow border border-slate-150">
            <h4 className="font-extrabold text-navy text-sm">{showConfirm.title}</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{showConfirm.message}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirm(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={showConfirm.onConfirm}
                className="px-4 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-bold rounded-xl card-shadow"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {showAlert && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 card-shadow border border-slate-150">
            <h4 className="font-extrabold text-navy text-sm">{showAlert.title}</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{showAlert.message}</p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAlert(null)}
                className="px-4 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-bold rounded-xl card-shadow"
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
