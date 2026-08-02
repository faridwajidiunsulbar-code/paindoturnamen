/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect } from 'react';
import { Division, Match, Entry, GroupStandingRow, KnockoutStage, Champions, KnockoutSlot, BracketArrangementMode, GroupCrossPairing, ManualSlotAssignment, ThirdPlaceMode, DivisionSettings } from '../types';
import { calculateGroupStandings, getDirectQualifiers, getWildcardCandidateRankings, buildSeedingAndSlots, generateKnockoutBracket, propagateKnockoutResult } from '../utils/tournamentHelpers';
import {
  getBracketHalf,
  getEarliestPossibleRound,
  validateBracketGroupSeparation,
  buildGroupCrossTemplateSlots,
  resolveBracketTemplateSlots,
  GroupSeparationConflict
} from '../utils/bracketArrangementHelpers';
import {
  validateKnockoutIntegrity,
  getDownstreamImpact,
  resolveAutoAdvanceByes,
  DownstreamImpact
} from '../utils/knockoutIntegrity';
import { Trophy, Check, Edit3, Lock, Unlock, AlertTriangle, ChevronRight, RefreshCw, X, Shuffle, Settings, Layers, UserCheck, ShieldCheck, RotateCcw, Medal, Award } from 'lucide-react';

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
  const [koNotes, setKoNotes] = useState<string>('');

  // Confirmation modal for score submission
  const [showScoreConfirm, setShowScoreConfirm] = useState<{
    match: Match;
    score1: number | null;
    score2: number | null;
    status: 'selesai' | 'walkover';
    winnerId: string;
    loserId: string | null;
    notes?: string;
    impact: DownstreamImpact;
  } | null>(null);

  // Integrity validation report modal
  const [showIntegrityReport, setShowIntegrityReport] = useState<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

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
  const thirdPlaceMode: ThirdPlaceMode = settings.thirdPlaceMode || (settings.thirdPlaceEnabled === false ? 'none' : 'playoff');

  const handleThirdPlaceModeChange = (newMode: ThirdPlaceMode) => {
    if (hasCompletedMatches || knockoutStage?.arrangementLocked) {
      setShowAlert({
        title: 'Perubahan Mode Diblokir 🛑',
        message: 'Kebijakan peringkat ketiga tidak dapat diubah setelah susunan dikunci atau pertandingan knockout telah dimainkan.'
      });
      return;
    }

    const updatedSettings: DivisionSettings = {
      ...settings,
      thirdPlaceMode: newMode,
      thirdPlaceEnabled: newMode !== 'none'
    };

    let updatedMatches = knockoutStage?.matches ? [...knockoutStage.matches] : undefined;

    if (updatedMatches && updatedMatches.length > 0) {
      if (newMode === 'playoff') {
        // Ensure bronze match exists if bracketSize >= 4
        const bronzeExists = updatedMatches.some(m => m.isBronzeMatch || m.roundName === 'Perebutan Juara 3');
        if (!bronzeExists && settings.bracketSize >= 4) {
          const bronzeMatchNum = settings.bracketSize === 4 ? 4 : settings.bracketSize === 8 ? 8 : (settings.bracketSize === 16 ? 16 : 32);
          updatedMatches.push({
            id: `ko-${division.id}-${bronzeMatchNum}`,
            divisionId: division.id,
            roundName: 'Perebutan Juara 3',
            type: 'KNOCKOUT',
            matchNum: bronzeMatchNum,
            isBronzeMatch: true,
            entryId1: null,
            entryId2: null,
            score1: null,
            score2: null,
            status: 'belum_dimainkan'
          });
        }
      } else {
        // Remove unplayed bronze match if shared_bronze or none
        updatedMatches = updatedMatches.filter(m => !m.isBronzeMatch && m.roundName !== 'Perebutan Juara 3');
      }
    }

    onUpdateDivision({
      ...division,
      settings: updatedSettings,
      knockoutStage: knockoutStage ? {
        ...knockoutStage,
        matches: updatedMatches || knockoutStage.matches
      } : undefined
    });
  };

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

    // Generate bracket tree and resolve BYEs without fake scores
    let freshMatches = generateKnockoutBracket(division.id, confirmedEntryIds, settings.bracketSize);
    if (thirdPlaceMode !== 'playoff') {
      freshMatches = freshMatches.filter(m => !m.isBronzeMatch && m.roundName !== 'Perebutan Juara 3');
    }
    const { updatedMatches } = resolveAutoAdvanceByes(freshMatches, thirdPlaceMode === 'playoff');

    // Run integrity check
    const integrity = validateKnockoutIntegrity(
      updatedMatches,
      resolved.resolvedSlots,
      settings.bracketSize,
      thirdPlaceMode
    );

    if (!integrity.isValid) {
      setShowAlert({
        title: 'Integritas Bracket Tidak Valid ⚠️',
        message: `Tidak dapat mengunci bracket karena ada masalah integritas:\n- ${integrity.errors.join('\n- ')}`
      });
      return;
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
    if (!knockoutStage?.arrangementLocked) {
      setShowAlert({
        title: 'Bracket Belum Dikunci ⚠️',
        message: 'Pengisian skor hanya dapat dilakukan setelah susunan bracket dikonfirmasi dan dikunci.'
      });
      return;
    }

    // Downstream check before opening modal for editing
    if (match.status === 'selesai' || match.status === 'walkover') {
      const impact = getDownstreamImpact(match.id, knockoutStage.matches);
      if (impact.hasScoredDownstream) {
        setShowAlert({
          title: 'Hasil Telah Digunakan 🛑',
          message: `Skor pertandingan ini tidak dapat diubah karena pertandingan lanjutan sudah memiliki hasil:\n- ${impact.reasons.join('\n- ')}`
        });
        return;
      }
    }

    setScoringMatch(match);
    setScore1(match.score1 ?? '');
    setScore2(match.score2 ?? '');
    setKoStatus(match.status === 'belum_dimainkan' ? 'selesai' : match.status);
    setKoWinner(match.winnerId || match.entryId1 || '');
    setKoNotes(match.notes || '');
  };

  const executeCommitKoScore = (
    fs1: number | null,
    fs2: number | null,
    status: 'selesai' | 'walkover',
    wId: string,
    lId: string | null,
    notes?: string
  ) => {
    let updatedMatches = knockoutStage!.matches.map(m => {
      if (m.id === scoringMatch!.id) {
        return {
          ...m,
          score1: fs1,
          score2: fs2,
          status,
          winnerId: wId,
          loserId: lId || undefined,
          notes: notes || undefined
        };
      }
      return m;
    });

    updatedMatches = propagateKnockoutResult(updatedMatches, scoringMatch!.matchNum!, wId, lId || '');

    const finalMatchNum = settings.bracketSize === 4 ? 3 : settings.bracketSize === 8 ? 7 : (settings.bracketSize === 16 ? 15 : 31);
    const bronzeMatchNum = settings.bracketSize === 4 ? 4 : settings.bracketSize === 8 ? 8 : (settings.bracketSize === 16 ? 16 : 32);

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
    setShowScoreConfirm(null);
  };

  const handleSaveKoScore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scoringMatch || !knockoutStage) return;

    const impact = getDownstreamImpact(scoringMatch.id, knockoutStage.matches);
    if (impact.hasScoredDownstream) {
      setShowAlert({
        title: 'Perubahan Diblokir 🛑',
        message: `Skor pertandingan ini tidak dapat diubah karena pertandingan lanjutan sudah memiliki hasil:\n- ${impact.reasons.join('\n- ')}`
      });
      return;
    }

    if (koStatus === 'walkover') {
      if (!koNotes.trim()) {
        setShowAlert({
          title: 'Alasan WO Wajib Diisi ⚠️',
          message: 'Harap isi catatan alasan Walkover (WO).'
        });
        return;
      }

      if (!koWinner) {
        setShowAlert({
          title: 'Pemenang WO Belum Dipilih ⚠️',
          message: 'Harap pilih peserta pemenang Walkover (WO).'
        });
        return;
      }

      const loser = koWinner === scoringMatch.entryId1 ? scoringMatch.entryId2 : scoringMatch.entryId1;

      setShowScoreConfirm({
        match: scoringMatch,
        score1: null,
        score2: null,
        status: 'walkover',
        winnerId: koWinner,
        loserId: loser || null,
        notes: koNotes.trim(),
        impact
      });
      return;
    }

    const fs1 = parseInt(String(score1));
    const fs2 = parseInt(String(score2));

    if (isNaN(fs1) || isNaN(fs2) || fs1 < 0 || fs2 < 0) {
      setShowAlert({
        title: 'Skor Tidak Valid ⚠️',
        message: 'Harap masukkan nilai skor berupa angka positif atau nol.'
      });
      return;
    }

    if (fs1 === fs2) {
      setShowAlert({
        title: 'Skor Seri Tidak Diperbolehkan ⚠️',
        message: 'Skor seri tidak diperbolehkan dalam fase gugur.'
      });
      return;
    }

    const targetScore = settings.targetScore;
    const winByTwo = settings.winByTwo;
    const maxScore = Math.max(fs1, fs2);
    const minScore = Math.min(fs1, fs2);

    if (maxScore < targetScore) {
      setShowAlert({
        title: 'Skor Belum Target ⚠️',
        message: `Pemenang harus mencapai skor minimal ${targetScore}.`
      });
      return;
    }

    if (winByTwo && maxScore === targetScore && (maxScore - minScore) < 2) {
      setShowAlert({
        title: 'Syarat Win by Two ⚠️',
        message: `Pemenang harus unggul minimal 2 angka.`
      });
      return;
    }

    const wId = fs1 > fs2 ? (scoringMatch.entryId1 || '') : (scoringMatch.entryId2 || '');
    const lId = fs1 > fs2 ? (scoringMatch.entryId2 || '') : (scoringMatch.entryId1 || '');

    setShowScoreConfirm({
      match: scoringMatch,
      score1: fs1,
      score2: fs2,
      status: 'selesai',
      winnerId: wId,
      loserId: lId || null,
      notes: koNotes.trim() || undefined,
      impact
    });
  };

  const handleResetKoScore = (match: Match) => {
    if (!knockoutStage) return;

    const impact = getDownstreamImpact(match.id, knockoutStage.matches);
    if (impact.hasScoredDownstream) {
      setShowAlert({
        title: 'Reset Hasil Diblokir 🛑',
        message: `Pertandingan ini tidak dapat direset karena pertandingan lanjutan sudah memiliki hasil berskor:\n- ${impact.reasons.join('\n- ')}`
      });
      return;
    }

    setShowConfirm({
      title: 'Reset Hasil Pertandingan',
      message: `Apakah Anda yakin ingin mereset hasil pertandingan ${match.roundName || ''} #${match.matchNum}? Skor dan pergerakan peserta ke ronde berikutnya akan dibatalkan.`,
      onConfirm: () => {
        let updatedMatches = knockoutStage.matches.map(m => {
          if (m.id === match.id) {
            return {
              ...m,
              score1: null,
              score2: null,
              status: 'belum_dimainkan' as const,
              winnerId: undefined,
              loserId: undefined,
              notes: undefined
            };
          }
          return m;
        });

        // Clear winner from next match
        if (match.nextMatchNum) {
          const nextMatch = updatedMatches.find(nm => nm.matchNum === match.nextMatchNum);
          if (nextMatch) {
            if (match.nextMatchSlot === 'player1') nextMatch.entryId1 = null;
            else if (match.nextMatchSlot === 'player2') nextMatch.entryId2 = null;
            nextMatch.status = 'belum_dimainkan';
            nextMatch.winnerId = undefined;
            nextMatch.loserId = undefined;
            nextMatch.score1 = null;
            nextMatch.score2 = null;
          }
        }

        // Clear loser from bronze match if SF
        if (match.roundName === 'Semifinal') {
          const bronzeMatch = updatedMatches.find(bm => bm.isBronzeMatch || bm.roundName === 'Perebutan Juara 3');
          if (bronzeMatch) {
            if (match.matchNum === 1 || match.matchNum === 5 || match.matchNum === 13 || match.matchNum === 29) {
              bronzeMatch.entryId1 = null;
            } else {
              bronzeMatch.entryId2 = null;
            }
            bronzeMatch.status = 'belum_dimainkan';
            bronzeMatch.winnerId = undefined;
            bronzeMatch.loserId = undefined;
            bronzeMatch.score1 = null;
            bronzeMatch.score2 = null;
          }
        }

        onUpdateDivision({
          ...division,
          knockoutStage: {
            ...knockoutStage,
            matches: updatedMatches
          }
        });
        setScoringMatch(null);
        setShowConfirm(null);
      }
    });
  };

  const handleCheckIntegrity = () => {
    if (!knockoutStage) return;
    const report = validateKnockoutIntegrity(
      knockoutStage.matches,
      knockoutStage.slots,
      settings.bracketSize,
      thirdPlaceMode
    );
    setShowIntegrityReport(report);
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

          {/* Third Place Policy Selector (PAINDO-009A) */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3" id="third-place-policy-selector">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold text-navy uppercase tracking-wider flex items-center gap-1.5">
                <Medal className="h-4 w-4 text-amber-600" /> Kebijakan Peringkat Ketiga
              </label>
              <span className="text-[10px] font-extrabold text-amber-900 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                Status: {thirdPlaceMode === 'shared_bronze' ? 'Juara 3 Bersama' : thirdPlaceMode === 'playoff' ? 'Perebutan Juara 3' : 'Tanpa Juara 3'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Shared Bronze option */}
              <button
                type="button"
                disabled={hasCompletedMatches || knockoutStage?.arrangementLocked}
                onClick={() => handleThirdPlaceModeChange('shared_bronze')}
                className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                  thirdPlaceMode === 'shared_bronze'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${(hasCompletedMatches || knockoutStage?.arrangementLocked) ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-navy uppercase tracking-wider flex items-center gap-1">
                      <Medal className="h-3.5 w-3.5 text-amber-600" /> Juara 3 Bersama
                    </span>
                    {thirdPlaceMode === 'shared_bronze' && (
                      <span className="text-[10px] font-extrabold bg-amber-600 text-white px-1.5 py-0.5 rounded-full">Aktif</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Kedua pihak yang kalah di semifinal mendapat peringkat ketiga.
                  </p>
                </div>
              </button>

              {/* Playoff option */}
              <button
                type="button"
                disabled={hasCompletedMatches || knockoutStage?.arrangementLocked}
                onClick={() => handleThirdPlaceModeChange('playoff')}
                className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                  thirdPlaceMode === 'playoff'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${(hasCompletedMatches || knockoutStage?.arrangementLocked) ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-navy uppercase tracking-wider flex items-center gap-1">
                      <Trophy className="h-3.5 w-3.5 text-amber-600" /> Perebutan Juara 3
                    </span>
                    {thirdPlaceMode === 'playoff' && (
                      <span className="text-[10px] font-extrabold bg-amber-600 text-white px-1.5 py-0.5 rounded-full">Aktif</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Kedua pihak yang kalah di semifinal bertanding menentukan peringkat 3 dan 4.
                  </p>
                </div>
              </button>

              {/* None option */}
              <button
                type="button"
                disabled={hasCompletedMatches || knockoutStage?.arrangementLocked}
                onClick={() => handleThirdPlaceModeChange('none')}
                className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                  thirdPlaceMode === 'none'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${(hasCompletedMatches || knockoutStage?.arrangementLocked) ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-navy uppercase tracking-wider flex items-center gap-1">
                      <X className="h-3.5 w-3.5 text-slate-500" /> Tanpa Juara 3
                    </span>
                    {thirdPlaceMode === 'none' && (
                      <span className="text-[10px] font-extrabold bg-amber-600 text-white px-1.5 py-0.5 rounded-full">Aktif</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Hanya Juara dan Runner-up yang ditetapkan.
                  </p>
                </div>
              </button>
            </div>
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
              {knockoutStage && (
                <button
                  type="button"
                  onClick={handleCheckIntegrity}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold rounded-xl transition flex items-center gap-1.5"
                  title="Cek integritas relasi bracket dan skor"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-600" /> Verifikasi Integritas
                </button>
              )}

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
                  <div key={roundName} className="flex-1 space-y-4 min-w-[240px]">
                    <div className="text-center font-extrabold text-xs text-navy uppercase tracking-wider pb-2 border-b border-slate-150 flex items-center justify-center gap-1.5">
                      <span>{roundName}</span>
                    </div>

                    <div className="space-y-6">
                      {roundMatches.map(m => {
                        const isFinished = m.status === 'selesai' || m.status === 'walkover';
                        const isWO = m.status === 'walkover';
                        const isFinal = m.roundName === 'Final';

                        if (isFinal) {
                          // FINAL CARD VARIANT (PAINDO-009A)
                          return (
                            <div
                              key={m.id}
                              className="bg-gradient-to-br from-amber-500/10 via-amber-400/5 to-amber-600/15 border-2 border-amber-400 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden space-y-3 min-w-[280px] sm:min-w-[320px] transition"
                            >
                              <div className="flex items-center justify-between pb-2 border-b border-amber-200/80">
                                <div className="flex items-center gap-1.5">
                                  <Trophy className="h-5 w-5 text-amber-600 animate-pulse" />
                                  <div>
                                    <span className="font-black text-xs sm:text-sm text-amber-950 uppercase tracking-wider block">FINAL</span>
                                    <span className="text-[10px] font-bold text-amber-800/80 uppercase tracking-widest block">Perebutan Gelar Juara</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-mono font-bold text-amber-800/70">#{m.matchNum}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                    isWO ? 'bg-amber-600 text-white' :
                                    isFinished ? 'bg-emerald-600 text-white' :
                                    'bg-amber-200/80 text-amber-900'
                                  }`}>
                                    {isWO ? 'WO' : isFinished ? 'SELESAI' : 'BELUM'}
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                {/* Player 1 */}
                                <div className={`p-2.5 rounded-xl border flex items-center justify-between transition ${
                                  m.winnerId === m.entryId1 && m.entryId1
                                    ? 'bg-amber-100/90 border-amber-300 text-amber-950 font-black shadow-xs'
                                    : 'bg-white/90 border-amber-200/60 text-slate-800 font-bold'
                                }`}>
                                  <div className="flex items-center gap-1.5 truncate pr-2">
                                    <span className="truncate text-xs sm:text-sm">{getEntryLabel(m.entryId1)}</span>
                                    {m.winnerId === m.entryId1 && m.entryId1 && (
                                      <span className="shrink-0 bg-amber-400 text-amber-950 font-black text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 shadow-2xs">
                                        <Trophy className="h-2.5 w-2.5" /> JUARA
                                      </span>
                                    )}
                                    {isFinished && m.winnerId && m.winnerId !== m.entryId1 && m.entryId1 && (
                                      <span className="shrink-0 bg-slate-200 text-slate-700 font-bold text-[9px] px-1.5 py-0.5 rounded">
                                        RUNNER-UP
                                      </span>
                                    )}
                                  </div>
                                  <span className="font-mono text-xs sm:text-sm font-black px-2 py-0.5 bg-amber-200/50 rounded-md text-amber-950">
                                    {m.score1 ?? '-'}
                                  </span>
                                </div>

                                {/* Player 2 */}
                                <div className={`p-2.5 rounded-xl border flex items-center justify-between transition ${
                                  m.winnerId === m.entryId2 && m.entryId2
                                    ? 'bg-amber-100/90 border-amber-300 text-amber-950 font-black shadow-xs'
                                    : 'bg-white/90 border-amber-200/60 text-slate-800 font-bold'
                                }`}>
                                  <div className="flex items-center gap-1.5 truncate pr-2">
                                    <span className="truncate text-xs sm:text-sm">{getEntryLabel(m.entryId2)}</span>
                                    {m.winnerId === m.entryId2 && m.entryId2 && (
                                      <span className="shrink-0 bg-amber-400 text-amber-950 font-black text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 shadow-2xs">
                                        <Trophy className="h-2.5 w-2.5" /> JUARA
                                      </span>
                                    )}
                                    {isFinished && m.winnerId && m.winnerId !== m.entryId2 && m.entryId2 && (
                                      <span className="shrink-0 bg-slate-200 text-slate-700 font-bold text-[9px] px-1.5 py-0.5 rounded">
                                        RUNNER-UP
                                      </span>
                                    )}
                                  </div>
                                  <span className="font-mono text-xs sm:text-sm font-black px-2 py-0.5 bg-amber-200/50 rounded-md text-amber-950">
                                    {m.score2 ?? '-'}
                                  </span>
                                </div>
                              </div>

                              {m.notes && (
                                <div className="text-[10px] italic text-amber-900/80 bg-amber-100/50 p-1.5 rounded-lg font-mono truncate">
                                  💬 {m.notes}
                                </div>
                              )}

                              {isAdmin && knockoutStage?.arrangementLocked && (
                                <div className="flex items-center gap-1.5 pt-1">
                                  {m.entryId1 && m.entryId2 && m.entryId1 !== 'BYE' && m.entryId2 !== 'BYE' && (
                                    <button
                                      type="button"
                                      onClick={() => openKoScoreModal(m)}
                                      className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-600 text-amber-950 font-black rounded-lg text-xs transition flex items-center justify-center gap-1 shadow-xs"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" /> {isFinished ? 'Edit Skor Final' : 'Input Skor Final'}
                                    </button>
                                  )}
                                  {isFinished && (
                                    <button
                                      type="button"
                                      onClick={() => handleResetKoScore(m)}
                                      title="Reset hasil final"
                                      className="px-2.5 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-bold transition flex items-center gap-1"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" /> Reset
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        }

                        // STANDARD MATCH CARD VARIANT
                        return (
                          <div
                            key={m.id}
                            className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 card-shadow hover:border-slate-300 transition"
                          >
                            <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400">
                              <span>Match #{m.matchNum}</span>
                              <span className={`px-1.5 py-0.5 rounded font-extrabold ${
                                isWO ? 'bg-amber-100 text-amber-800' :
                                m.status === 'selesai' ? 'bg-emerald-100 text-emerald-800' :
                                'bg-slate-200 text-slate-600'
                              }`}>
                                {isWO ? 'WO' : m.status === 'selesai' ? 'SELESAI' : 'BELUM'}
                              </span>
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

                            {m.notes && (
                              <div className="text-[10px] italic text-slate-500 bg-slate-100 p-1 rounded font-mono truncate">
                                💬 {m.notes}
                              </div>
                            )}

                            {isAdmin && knockoutStage?.arrangementLocked && (
                              <div className="flex items-center gap-1.5 pt-1">
                                {m.entryId1 && m.entryId2 && m.entryId1 !== 'BYE' && m.entryId2 !== 'BYE' && (
                                  <button
                                    type="button"
                                    onClick={() => openKoScoreModal(m)}
                                    className="flex-1 py-1 bg-navy text-neon rounded-lg text-[10px] font-extrabold hover:bg-navy-light transition flex items-center justify-center gap-1"
                                  >
                                    <Edit3 className="h-3 w-3" /> {isFinished ? 'Edit Skor' : 'Input Skor'}
                                  </button>
                                )}

                                {isFinished && (
                                  <button
                                    type="button"
                                    onClick={() => handleResetKoScore(m)}
                                    title="Reset hasil pertandingan ini"
                                    className="px-2 py-1 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1"
                                  >
                                    <RotateCcw className="h-3 w-3" /> Reset
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Third Place Section (Playoff / Shared Bronze) */}
            {settings.bracketSize >= 4 && thirdPlaceMode !== 'none' && (
              <div className="mt-6 pt-6 border-t border-slate-200 space-y-3" id="third-place-display-section">
                <div className="flex items-center gap-2">
                  <Medal className="h-4 w-4 text-amber-600" />
                  <h4 className="font-extrabold text-xs text-navy uppercase tracking-wider">
                    {thirdPlaceMode === 'shared_bronze' ? 'Penetapan Juara 3 Bersama' : 'Pertandingan Perebutan Juara 3'}
                  </h4>
                </div>

                {thirdPlaceMode === 'playoff' && (() => {
                  const bronzeMatch = knockoutStage?.matches.find(m => m.isBronzeMatch || m.roundName === 'Perebutan Juara 3');
                  if (!bronzeMatch) return null;
                  const isFinished = bronzeMatch.status === 'selesai' || bronzeMatch.status === 'walkover';
                  const isWO = bronzeMatch.status === 'walkover';

                  return (
                    <div className="bg-amber-50/40 border border-amber-300/80 rounded-2xl p-4 space-y-2.5 card-shadow max-w-sm">
                      <div className="flex items-center justify-between pb-2 border-b border-amber-200">
                        <div className="flex items-center gap-1.5">
                          <Medal className="h-4 w-4 text-amber-700" />
                          <div>
                            <span className="font-extrabold text-xs text-amber-950 uppercase tracking-wider block">Perebutan Juara 3</span>
                            <span className="text-[10px] text-amber-800/70 font-semibold block">Penentuan Peringkat Ketiga</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-amber-700 font-bold">#{bronzeMatch.matchNum}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                            isWO ? 'bg-amber-200 text-amber-900' :
                            isFinished ? 'bg-emerald-100 text-emerald-800' :
                            'bg-slate-200 text-slate-700'
                          }`}>
                            {isWO ? 'WO' : isFinished ? 'SELESAI' : 'BELUM'}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs font-bold">
                        <div className={`p-2 rounded-lg border flex items-center justify-between ${
                          bronzeMatch.winnerId === bronzeMatch.entryId1 && bronzeMatch.entryId1
                            ? 'bg-amber-100 border-amber-300 text-amber-950 font-black'
                            : 'bg-white border-amber-200/60 text-slate-700'
                        }`}>
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="truncate">{getEntryLabel(bronzeMatch.entryId1)}</span>
                            {bronzeMatch.winnerId === bronzeMatch.entryId1 && bronzeMatch.entryId1 && (
                              <span className="shrink-0 bg-amber-600 text-white font-extrabold text-[9px] px-1.5 py-0.5 rounded">
                                JUARA 3
                              </span>
                            )}
                            {isFinished && bronzeMatch.winnerId && bronzeMatch.winnerId !== bronzeMatch.entryId1 && bronzeMatch.entryId1 && (
                              <span className="shrink-0 bg-slate-200 text-slate-700 font-bold text-[9px] px-1.5 py-0.5 rounded">
                                PERINGKAT 4
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs font-bold">{bronzeMatch.score1 ?? '-'}</span>
                        </div>

                        <div className={`p-2 rounded-lg border flex items-center justify-between ${
                          bronzeMatch.winnerId === bronzeMatch.entryId2 && bronzeMatch.entryId2
                            ? 'bg-amber-100 border-amber-300 text-amber-950 font-black'
                            : 'bg-white border-amber-200/60 text-slate-700'
                        }`}>
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="truncate">{getEntryLabel(bronzeMatch.entryId2)}</span>
                            {bronzeMatch.winnerId === bronzeMatch.entryId2 && bronzeMatch.entryId2 && (
                              <span className="shrink-0 bg-amber-600 text-white font-extrabold text-[9px] px-1.5 py-0.5 rounded">
                                JUARA 3
                              </span>
                            )}
                            {isFinished && bronzeMatch.winnerId && bronzeMatch.winnerId !== bronzeMatch.entryId2 && bronzeMatch.entryId2 && (
                              <span className="shrink-0 bg-slate-200 text-slate-700 font-bold text-[9px] px-1.5 py-0.5 rounded">
                                PERINGKAT 4
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs font-bold">{bronzeMatch.score2 ?? '-'}</span>
                        </div>
                      </div>

                      {bronzeMatch.notes && (
                        <div className="text-[10px] italic text-slate-500 bg-slate-100 p-1 rounded font-mono truncate">
                          💬 {bronzeMatch.notes}
                        </div>
                      )}

                      {isAdmin && knockoutStage?.arrangementLocked && (
                        <div className="flex items-center gap-1.5 pt-1">
                          {bronzeMatch.entryId1 && bronzeMatch.entryId2 && bronzeMatch.entryId1 !== 'BYE' && bronzeMatch.entryId2 !== 'BYE' && (
                            <button
                              type="button"
                              onClick={() => openKoScoreModal(bronzeMatch)}
                              className="flex-1 py-1 bg-amber-700 text-white rounded-lg text-[10px] font-extrabold hover:bg-amber-800 transition flex items-center justify-center gap-1"
                            >
                              <Edit3 className="h-3 w-3" /> {isFinished ? 'Edit Skor' : 'Input Skor'}
                            </button>
                          )}
                          {isFinished && (
                            <button
                              type="button"
                              onClick={() => handleResetKoScore(bronzeMatch)}
                              title="Reset hasil perebutan juara 3"
                              className="px-2 py-1 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1"
                            >
                              <RotateCcw className="h-3 w-3" /> Reset
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {thirdPlaceMode === 'shared_bronze' && (() => {
                  const sfMatches = knockoutStage?.matches.filter(m => m.roundName === 'Semifinal') || [];
                  const sf1 = sfMatches[0];
                  const sf2 = sfMatches[1];

                  const sf1LoserId = sf1 && (sf1.status === 'selesai' || sf1.status === 'walkover') ? sf1.loserId : null;
                  const sf2LoserId = sf2 && (sf2.status === 'selesai' || sf2.status === 'walkover') ? sf2.loserId : null;

                  return (
                    <div className="bg-gradient-to-br from-amber-50 to-orange-50/40 border border-amber-250 rounded-2xl p-4 space-y-3 card-shadow max-w-sm">
                      <div className="flex items-center justify-between pb-2 border-b border-amber-200">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center -space-x-1">
                            <Medal className="h-4 w-4 text-amber-700" />
                            <Medal className="h-4 w-4 text-amber-600" />
                          </div>
                          <div>
                            <span className="font-black text-xs text-amber-950 uppercase tracking-wider block">JUARA 3 BERSAMA</span>
                            <span className="text-[10px] text-amber-800/80 font-bold block">Peringkat Ketiga Tanpa Pertandingan Tambahan</span>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-extrabold text-[10px] rounded-full border border-amber-200">
                          SHARED BRONZE
                        </span>
                      </div>

                      <div className="space-y-2">
                        {/* Participant 1 */}
                        <div className="p-2.5 bg-white border border-amber-200/80 rounded-xl flex items-center justify-between shadow-2xs">
                          <div className="flex items-center gap-2 truncate pr-2">
                            <Medal className="h-4 w-4 text-amber-700 shrink-0" />
                            <span className="text-xs font-bold text-slate-800 truncate">
                              {sf1LoserId ? getEntryLabel(sf1LoserId) : (sf1 ? 'Menunggu Kalah Semifinal 1' : 'TBD')}
                            </span>
                          </div>
                          <span className="shrink-0 bg-amber-100 text-amber-900 font-black text-[9px] px-2 py-0.5 rounded-md border border-amber-200">
                            JUARA 3
                          </span>
                        </div>

                        {/* Participant 2 */}
                        <div className="p-2.5 bg-white border border-amber-200/80 rounded-xl flex items-center justify-between shadow-2xs">
                          <div className="flex items-center gap-2 truncate pr-2">
                            <Medal className="h-4 w-4 text-amber-700 shrink-0" />
                            <span className="text-xs font-bold text-slate-800 truncate">
                              {sf2LoserId ? getEntryLabel(sf2LoserId) : (sf2 ? 'Menunggu Kalah Semifinal 2' : 'TBD')}
                            </span>
                          </div>
                          <span className="shrink-0 bg-amber-100 text-amber-900 font-black text-[9px] px-2 py-0.5 rounded-md border border-amber-200">
                            JUARA 3
                          </span>
                        </div>
                      </div>

                      <p className="text-[10px] text-amber-800/70 italic text-center font-medium">
                        Kedua peserta yang gugur di semifinal secara otomatis ditetapkan sebagai Juara 3 Bersama.
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Match Scoring Modal */}
      {scoringMatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm">Input Skor Match #{scoringMatch.matchNum} ({scoringMatch.roundName})</h4>
              <button onClick={() => setScoringMatch(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveKoScore} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-extrabold text-navy block">Status Pertandingan</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKoStatus('selesai')}
                    className={`py-1.5 text-xs font-extrabold rounded-xl border transition ${
                      koStatus === 'selesai' ? 'bg-navy text-neon border-navy' : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Selesai Dimainkan
                  </button>
                  <button
                    type="button"
                    onClick={() => setKoStatus('walkover')}
                    className={`py-1.5 text-xs font-extrabold rounded-xl border transition ${
                      koStatus === 'walkover' ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Walkover (WO)
                  </button>
                </div>
              </div>

              {koStatus === 'selesai' ? (
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
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-extrabold text-navy block">Pilih Pemenang WO</label>
                    <select
                      value={koWinner}
                      onChange={e => setKoWinner(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-navy"
                    >
                      {scoringMatch.entryId1 && (
                        <option value={scoringMatch.entryId1}>{getEntryLabel(scoringMatch.entryId1)}</option>
                      )}
                      {scoringMatch.entryId2 && (
                        <option value={scoringMatch.entryId2}>{getEntryLabel(scoringMatch.entryId2)}</option>
                      )}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-extrabold text-navy block">Alasan Walkover (WO) <span className="text-rose-500">*</span></label>
                    <textarea
                      value={koNotes}
                      onChange={e => setKoNotes(e.target.value)}
                      placeholder="Contoh: Peserta B cederan saat pemanasan / tidak hadir"
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-navy"
                      rows={2}
                    />
                  </div>
                </div>
              )}

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
                  Lanjut Konfirmasi
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

      {/* Score Confirmation Modal */}
      {showScoreConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                Konfirmasi Simpan Hasil Pertandingan
              </h4>
              <button onClick={() => setShowScoreConfirm(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                <div className="font-extrabold text-navy">
                  Match #{showScoreConfirm.match.matchNum} ({showScoreConfirm.match.roundName})
                </div>
                <div>
                  <span className="font-bold">{getEntryLabel(showScoreConfirm.match.entryId1)}</span> vs <span className="font-bold">{getEntryLabel(showScoreConfirm.match.entryId2)}</span>
                </div>
                {showScoreConfirm.status === 'walkover' ? (
                  <div className="text-amber-700 font-extrabold">
                    Hasil: Walkover (WO) — Pemenang: {getEntryLabel(showScoreConfirm.winnerId)}
                  </div>
                ) : (
                  <div className="font-mono font-black text-emerald-700 text-sm">
                    Skor: {showScoreConfirm.score1} - {showScoreConfirm.score2} (Pemenang: {getEntryLabel(showScoreConfirm.winnerId)})
                  </div>
                )}
                {showScoreConfirm.notes && (
                  <div className="text-slate-500 italic">
                    Catatan: {showScoreConfirm.notes}
                  </div>
                )}
              </div>

              {showScoreConfirm.impact.directNextMatch && (
                <div className="p-3 bg-sky-50 rounded-xl border border-sky-200 text-sky-900 space-y-1">
                  <div className="font-extrabold flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-sky-600" />
                    Dampak Pertandingan Selanjutnya:
                  </div>
                  <div>
                    Pemenang (<span className="font-bold">{getEntryLabel(showScoreConfirm.winnerId)}</span>) maju ke Match #{showScoreConfirm.impact.directNextMatch.matchNum} ({showScoreConfirm.impact.directNextMatch.roundName}).
                  </div>
                </div>
              )}

              {showScoreConfirm.impact.loserDestinationMatch && (
                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200 text-indigo-900 space-y-1">
                  <div className="font-extrabold flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-indigo-600" />
                    Dampak Perebutan Juara 3:
                  </div>
                  <div>
                    Peserta kalah (<span className="font-bold">{getEntryLabel(showScoreConfirm.loserId)}</span>) maju ke Match #{showScoreConfirm.impact.loserDestinationMatch.matchNum} ({showScoreConfirm.impact.loserDestinationMatch.roundName}).
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-150">
              <button
                type="button"
                onClick={() => setShowScoreConfirm(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  executeCommitKoScore(
                    showScoreConfirm.score1,
                    showScoreConfirm.score2,
                    showScoreConfirm.status,
                    showScoreConfirm.winnerId,
                    showScoreConfirm.loserId,
                    showScoreConfirm.notes
                  );
                }}
                className="px-4 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-extrabold rounded-xl card-shadow"
              >
                Konfirmasi & Simpan Skor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integrity Report Modal */}
      {showIntegrityReport && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm flex items-center gap-2">
                <ShieldCheck className={`h-5 w-5 ${showIntegrityReport.isValid ? 'text-emerald-600' : 'text-rose-600'}`} />
                Hasil Verifikasi Integritas Bracket
              </h4>
              <button onClick={() => setShowIntegrityReport(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {showIntegrityReport.isValid ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 font-extrabold flex items-center gap-2">
                  <Check className="h-5 w-5 text-emerald-600" />
                  Integritas Bracket Valid 100%! Semua relasi node, seeding, dan skor konsisten.
                </div>
              ) : (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 font-extrabold flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-600" />
                  Ditemukan Masalah Integritas Pada Bracket
                </div>
              )}

              {showIntegrityReport.errors.length > 0 && (
                <div className="space-y-1">
                  <div className="font-extrabold text-rose-700">Error Integritas ({showIntegrityReport.errors.length}):</div>
                  <ul className="list-disc list-inside bg-rose-50 p-2.5 rounded-xl border border-rose-150 text-rose-800 space-y-1 font-mono text-[11px]">
                    {showIntegrityReport.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {showIntegrityReport.warnings.length > 0 && (
                <div className="space-y-1">
                  <div className="font-extrabold text-amber-700">Peringatan ({showIntegrityReport.warnings.length}):</div>
                  <ul className="list-disc list-inside bg-amber-50 p-2.5 rounded-xl border border-amber-150 text-amber-800 space-y-1 font-mono text-[11px]">
                    {showIntegrityReport.warnings.map((warn, idx) => (
                      <li key={idx}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-150">
              <button
                type="button"
                onClick={() => setShowIntegrityReport(null)}
                className="px-4 py-2 bg-navy hover:bg-navy-light text-neon text-xs font-bold rounded-xl card-shadow"
              >
                Tutup
              </button>
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
