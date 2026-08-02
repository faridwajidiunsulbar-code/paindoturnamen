/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect } from 'react';
import { Division, Match, Entry, GroupStandingRow, KnockoutStage, Champions, KnockoutSlot, BracketArrangementMode, GroupCrossPairing, ManualSlotAssignment, ThirdPlaceMode, DivisionSettings, OfficialPodium, PodiumEntry, PodiumPlacement } from '../types';
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
import { deriveDivisionPodium, validateDivisionCompletion } from '../utils/podiumHelpers';
import { Trophy, Check, Edit3, Lock, Unlock, AlertTriangle, ChevronRight, RefreshCw, X, Shuffle, Settings, Layers, UserCheck, ShieldCheck, RotateCcw, Medal, Award } from 'lucide-react';

interface DivisionKnockoutProps {
  division: Division;
  onUpdateDivision: (updated: Division) => void;
  isAdmin?: boolean;
  isReadOnly?: boolean;
}

export default function DivisionKnockout({ division, onUpdateDivision, isAdmin = true, isReadOnly = false }: DivisionKnockoutProps) {
  const { entries, groups, roundRobinMatches, settings, knockoutStage, champions } = division;

  // PAINDO-010 Endorsement & Revocation states
  const [showEndorseModal, setShowEndorseModal] = useState(false);
  const [endorseConfirmChecked, setEndorseConfirmChecked] = useState(false);
  const [endorseBy, setEndorseBy] = useState('');
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

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

  // Fix final match loser modal
  const [showFixFinalModal, setShowFixFinalModal] = useState<boolean>(false);
  const [fixFinalReason, setFixFinalReason] = useState<string>('');

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

  // PAINDO-010 Podium Derivation & Completion Validation
  const podiumPreview = deriveDivisionPodium(
    knockoutStage?.matches || [],
    thirdPlaceMode,
    entries
  );

  const completionValidation = validateDivisionCompletion(
    division,
    knockoutStage?.matches || [],
    podiumPreview,
    division.officialPodium
  );

  const handleEndorsePodium = () => {
    if (division.podiumOfficial) {
      setShowAlert({
        title: 'Hasil Telah Disahkan',
        message: 'Hasil divisi ini sudah disahkan sebelumnya.'
      });
      return;
    }
    if (!completionValidation.canFinalize) {
      setShowAlert({
        title: 'Syarat Belum Terpenuhi 🛑',
        message: `Tidak dapat mengesahkan hasil divisi:\n- ${completionValidation.blockers.join('\n- ')}`
      });
      return;
    }
    setEndorseConfirmChecked(false);
    setShowEndorseModal(true);
  };

  const executeEndorsePodium = () => {
    if (!endorseConfirmChecked) {
      setShowAlert({
        title: 'Konfirmasi Diperlukan',
        message: 'Harap centang kotak konfirmasi pengesahan.'
      });
      return;
    }

    const sanitizedName = endorseBy.trim().slice(0, 120) || null;
    const now = new Date().toISOString();
    const officialPodium: OfficialPodium = {
      officialAt: now,
      officialName: sanitizedName,
      officialBy: sanitizedName,
      entries: podiumPreview.entries
    };

    const updatedDiv: Division = {
      ...division,
      podiumOfficial: true,
      officialAt: now,
      officialName: sanitizedName,
      officialBy: sanitizedName,
      officialPodium,
      revokedAt: null,
      podiumRevokedReason: null,
      status: 'completed'
    };

    onUpdateDivision(updatedDiv);
    setShowEndorseModal(false);
    setShowAlert({
      title: 'Pengesahan Berhasil 🎉',
      message: 'Hasil divisi resmi telah berhasil disahkan dan terkunci.'
    });
  };

  const handleRevokePodium = () => {
    if (!division.podiumOfficial) {
      setShowAlert({
        title: 'Belum Disahkan',
        message: 'Hasil divisi belum disahkan.'
      });
      return;
    }
    setRevokeReason('');
    setShowRevokeModal(true);
  };

  const executeRevokePodium = () => {
    if (!revokeReason.trim()) {
      setShowAlert({
        title: 'Alasan Wajib Diisi',
        message: 'Harap isi alasan pencabutan pengesahan.'
      });
      return;
    }

    const now = new Date().toISOString();
    const updatedDiv: Division = {
      ...division,
      podiumOfficial: false,
      revokedAt: now,
      podiumRevokedReason: revokeReason.trim(),
      status: 'knockout_stage',
      officialPodium: division.officialPodium
        ? {
            ...division.officialPodium,
            revokedAt: now,
            revokedReason: revokeReason.trim()
          }
        : null
    };

    onUpdateDivision(updatedDiv);
    setShowRevokeModal(false);
    setShowAlert({
      title: 'Pengesahan Dibatalkan 🔄',
      message: 'Status pengesahan telah dicabut (soft-revoke). Bagan dapat diubah kembali.'
    });
  };

  const handleThirdPlaceModeChange = (newMode: ThirdPlaceMode) => {
    if (division.podiumOfficial) {
      setShowAlert({
        title: 'Hasil Divisi Resmi 🛑',
        message: 'Kebijakan peringkat tidak dapat diubah karena hasil divisi telah disahkan. Batalkan pengesahan terlebih dahulu.'
      });
      return;
    }

    if (hasCompletedMatches) {
      setShowAlert({
        title: 'Perubahan Mode Diblokir 🛑',
        message: 'Kebijakan peringkat ketiga tidak dapat diubah setelah pertandingan knockout telah dimainkan.'
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
    if (division.podiumOfficial) {
      setShowAlert({
        title: 'Akses Ditolak 🛑',
        message: 'Hasil divisi telah disahkan. Batalkan pengesahan terlebih dahulu untuk mengoreksi skor.'
      });
      return;
    }

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
    if (division.podiumOfficial) {
      setShowAlert({
        title: 'Akses Ditolak 🛑',
        message: 'Hasil divisi telah disahkan. Batalkan pengesahan terlebih dahulu untuk mereset skor.'
      });
      return;
    }

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

  const executeFixFinalMatchData = () => {
    if (!fixFinalReason || fixFinalReason.trim().length < 5) {
      setShowAlert({
        title: 'Alasan Koreksi Wajib ⚠️',
        message: 'Alasan koreksi data hasil Final wajib diisi minimal 5 karakter.'
      });
      return;
    }

    if (!knockoutStage) return;

    const finalMatch = knockoutStage.matches.find(
      m => m.roundName === 'Final' || (!m.nextMatchNum && !m.isBronzeMatch && m.roundName !== 'Perebutan Juara 3')
    );

    if (!finalMatch || !finalMatch.winnerId || !finalMatch.entryId1 || !finalMatch.entryId2) {
      setShowAlert({
        title: 'Gagal Memperbaiki 🛑',
        message: 'Pertandingan Final belum memiliki data pemenang dan peserta yang valid.'
      });
      return;
    }

    const candidateLoserId = finalMatch.winnerId === finalMatch.entryId1 ? finalMatch.entryId2 : finalMatch.entryId1;

    const updatedMatches = knockoutStage.matches.map(m => {
      if (m.id === finalMatch.id) {
        return {
          ...m,
          loserId: candidateLoserId,
          notes: m.notes
            ? `${m.notes} | Koreksi loserId: ${fixFinalReason.trim()}`
            : `Koreksi loserId ke candidate Runner-up: ${fixFinalReason.trim()}`
        };
      }
      return m;
    });

    onUpdateDivision({
      ...division,
      knockoutStage: {
        ...knockoutStage,
        matches: updatedMatches
      }
    });

    setShowFixFinalModal(false);
    setFixFinalReason('');
    setShowAlert({
      title: 'Perbaikan Berhasil ✅',
      message: 'Data pihak kalah (loserId) pertandingan Final telah diperbarui ke Runner-up yang sah dan disimpan.'
    });
  };

    // Helper for canonical knockout match variant
    const getKnockoutMatchVariant = (match: Match, allMatches?: Match[]): 'final' | 'bronze_playoff' | 'semifinal' | 'standard' => {
      const rName = (match.roundName || '').trim().toLowerCase();
      const stage = ((match as any).stage || '').trim().toLowerCase();
      const round = ((match as any).round || '').trim().toLowerCase();

      // 1. Bronze metadata check
      if (
        match.isBronzeMatch ||
        stage === 'bronze' ||
        round === 'third_place' ||
        rName === 'perebutan juara 3' ||
        rName === 'perebutan tempat ketiga' ||
        rName.includes('juara 3') ||
        rName.includes('tempat ketiga')
      ) {
        return 'bronze_playoff';
      }

      // 2. Explicit Final metadata check
      if (
        rName === 'final' ||
        stage === 'final' ||
        round === 'final'
      ) {
        return 'final';
      }

      // 3. Explicit Semifinal metadata check
      if (
        rName === 'semifinal' ||
        stage === 'semifinal' ||
        round === 'semifinal'
      ) {
        return 'semifinal';
      }

      // 4. Safe Legacy Fallback for Final ONLY if:
      // - match is not bronze
      // - match has no nextMatchNum
      // - no explicit final exists among all matches
      if (!match.nextMatchNum) {
        const matchesList = allMatches || knockoutStage?.matches || [];
        const hasExplicitFinal = matchesList.some(m => {
          const mr = (m.roundName || '').trim().toLowerCase();
          const ms = ((m as any).stage || '').trim().toLowerCase();
          return mr === 'final' || ms === 'final';
        });

        if (!hasExplicitFinal) {
          const isFedBySemifinals = matchesList.filter(m => {
            const mr = (m.roundName || '').trim().toLowerCase();
            return (mr === 'semifinal' || (m as any).stage === 'semifinal') && m.nextMatchNum === match.matchNum;
          }).length === 2;

          const isCanonicalFinalMatchNum = match.matchNum === 3 || match.matchNum === 7 || match.matchNum === 15 || match.matchNum === 31;

          if (isFedBySemifinals || isCanonicalFinalMatchNum) {
            return 'final';
          }
        }
      }

      return 'standard';
    };

    // Helper for slot source badge label
    const getSlotSourceBadge = (entryId: string | null, seedNo?: number): string | null => {
      if (!activeSlots || activeSlots.length === 0) return null;

      let matchedSlot: KnockoutSlot | undefined;
      if (seedNo) {
        matchedSlot = activeSlots.find(s => s.seedNo === seedNo);
      } else if (entryId && entryId !== 'BYE') {
        matchedSlot = activeSlots.find(s => s.entryId === entryId);
      }

      if (!matchedSlot) {
        if (entryId === 'BYE') return 'BYE';
        return null;
      }

      if (matchedSlot.isBye || matchedSlot.entryId === 'BYE') {
        return 'BYE (Lolos Langsung)';
      }

      if (matchedSlot.sourceGroupName && matchedSlot.sourceGroupRank) {
        if (matchedSlot.sourceGroupRank === 1) return `Juara Grup ${matchedSlot.sourceGroupName}`;
        if (matchedSlot.sourceGroupRank === 2) return `Runner-up Grup ${matchedSlot.sourceGroupName}`;
        return `Peringkat ${matchedSlot.sourceGroupRank} Grup ${matchedSlot.sourceGroupName}`;
      }

      if (matchedSlot.isWildcard || matchedSlot.qualificationType === 'wildcard') {
        return `Wildcard #${matchedSlot.wildcardRank || 1}`;
      }

      if (matchedSlot.sourceLabel && matchedSlot.sourceLabel !== 'TBD') {
        return matchedSlot.sourceLabel;
      }

      return 'Pilihan Manual Admin';
    };

    // Helper for slot empty state label (never plain TBD when source is known)
    const getSlotEmptyLabel = (match: Match, slotNum: 1 | 2): string => {
      if (!knockoutStage || !knockoutStage.matches) {
        return match.roundName === 'Final'
          ? (slotNum === 1 ? 'Pemenang Semifinal 1' : 'Pemenang Semifinal 2')
          : 'TBD';
      }

      const feedingMatch = knockoutStage.matches.find(m => {
        if (m.isBronzeMatch) return false;
        if (m.nextMatchNum === match.matchNum) {
          if (slotNum === 1) return m.nextMatchSlot === 'player1' || m.matchNum % 2 !== 0;
          if (slotNum === 2) return m.nextMatchSlot === 'player2' || m.matchNum % 2 === 0;
        }
        return false;
      });

      if (feedingMatch) {
        if ((feedingMatch.status === 'selesai' || feedingMatch.status === 'walkover') && feedingMatch.winnerId) {
          return getEntryLabel(feedingMatch.winnerId);
        }
        const rName = feedingMatch.roundName || 'Match';
        return `Pemenang ${rName} #${feedingMatch.matchNum}`;
      }

      const variant = getKnockoutMatchVariant(match);
      if (variant === 'final') {
        return slotNum === 1 ? 'Pemenang Semifinal 1' : 'Pemenang Semifinal 2';
      }

      if (variant === 'semifinal') {
        return slotNum === 1 ? 'Pemenang Perempat Final 1' : 'Pemenang Perempat Final 2';
      }

      return 'TBD';
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
                disabled={hasCompletedMatches}
                onClick={() => handleThirdPlaceModeChange('shared_bronze')}
                className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                  thirdPlaceMode === 'shared_bronze'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${hasCompletedMatches ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                disabled={hasCompletedMatches}
                onClick={() => handleThirdPlaceModeChange('playoff')}
                className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                  thirdPlaceMode === 'playoff'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${hasCompletedMatches ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                disabled={hasCompletedMatches}
                onClick={() => handleThirdPlaceModeChange('none')}
                className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                  thirdPlaceMode === 'none'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${hasCompletedMatches ? 'opacity-60 cursor-not-allowed' : ''}`}
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

          {/* Bracket Arrangement Active Summary Bar */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3" id="bracket-active-summary-bar">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-navy shrink-0" />
                <span className="text-xs font-black text-navy uppercase tracking-wider">
                  Ringkasan Susunan Bracket Aktif
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold">
                <span className="px-2.5 py-1 bg-navy/10 text-navy border border-navy/20 rounded-lg flex items-center gap-1">
                  Mode: <strong className="font-black">{bracketMode === 'automatic' ? 'Otomatis' : bracketMode === 'group_cross' ? 'Silang Grup' : 'Manual Admin'}</strong>
                </span>
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg">
                  Template: <strong>Tersimpan</strong>
                </span>
                <span className="px-2.5 py-1 bg-sky-50 text-sky-800 border border-sky-200 rounded-lg">
                  Peserta: <strong>{isGroupPhaseComplete ? 'Sudah Terisi' : 'Proyeksi'}</strong>
                </span>
                <span className={`px-2.5 py-1 rounded-lg border ${
                  knockoutStage.isLocked
                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}>
                  Bracket: <strong>{knockoutStage.isLocked ? 'Terkunci' : 'Draft'}</strong>
                </span>
              </div>
            </div>

            {/* Group Cross Pairings Summary if active */}
            {bracketMode === 'group_cross' && (
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2" id="group-cross-active-summary">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-black text-navy uppercase tracking-wider">
                    <Layers className="h-3.5 w-3.5 text-amber-600" />
                    PENGATURAN SILANG GRUP
                  </div>
                  {isAdmin && !hasCompletedMatches && !knockoutStage?.arrangementLocked && (
                    <a
                      href="#bracket-arrangement-manager"
                      className="text-[10px] font-extrabold text-navy hover:text-navy-light underline"
                    >
                      Ubah Pasangan Grup
                    </a>
                  )}
                </div>

                {groupCrossPairings.length === 0 ? (
                  <p className="text-xs text-amber-800 italic">Belum ada pasangan silang grup yang dikonfigurasi.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {groupCrossPairings.map((pair, pIdx) => {
                      const g1 = groups.find(g => g.id === pair.groupOneId);
                      const g2 = groups.find(g => g.id === pair.groupTwoId);
                      const g1Name = g1 ? g1.name : 'Grup ?';
                      const g2Name = g2 ? g2.name : 'Grup ?';

                      return (
                        <div key={pair.id || pIdx} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold space-y-1">
                          <div className="flex items-center justify-between text-navy font-black border-b border-slate-200 pb-1">
                            <span>{g1Name}</span>
                            <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded font-mono">⚔️ SILANG</span>
                            <span>{g2Name}</span>
                          </div>
                          <div className="text-[10px] text-slate-600 space-y-0.5 font-mono">
                            <div>• Juara {g1Name} vs Runner-up {g2Name}</div>
                            <div>• Juara {g2Name} vs Runner-up {g1Name}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bracket Tree Matches */}
          <div className="overflow-x-auto pt-4" id="bracket-matches-tree">
            <div className="flex items-start gap-8 sm:gap-12 min-w-max pb-4 relative">
              {orderedRoundNames().map((roundName, rIdx) => {
                const roundMatches = getMatchesByRound()[roundName] || [];
                const isFinalRound = roundName === 'Final';

                // Helper to render an individual match card
                const renderMatchCard = (m: Match) => {
                  const isFinished = m.status === 'selesai' || m.status === 'walkover';
                  const isWO = m.status === 'walkover';
                  const variant = getKnockoutMatchVariant(m);
                  const isFinal = variant === 'final';

                  const slot1Source = m.entryId1 ? getSlotSourceBadge(m.entryId1) : getSlotEmptyLabel(m, 1);
                  const slot2Source = m.entryId2 ? getSlotSourceBadge(m.entryId2) : getSlotEmptyLabel(m, 2);

                  if (isFinal) {
                    // FINAL CARD VARIANT - DOMINANT CENTERPIECE (PAINDO-009A & HOTFIX border-[3px])
                    return (
                      <div
                        key={m.id}
                        className="bg-gradient-to-br from-amber-500/20 via-amber-400/10 to-amber-600/25 border-[3px] border-amber-400 rounded-2xl p-5 sm:p-6 shadow-2xl relative overflow-hidden space-y-4 transition min-w-[320px] sm:min-w-[380px]"
                      >
                        {/* Glowing Aksen Gold */}
                        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-300/20 rounded-full blur-xl pointer-events-none" />

                        <div className="flex items-center justify-between pb-3 border-b-2 border-amber-300/80 relative z-10">
                          <div className="flex items-center gap-2">
                            <Trophy className="h-6 w-6 text-amber-600 animate-pulse shrink-0" />
                            <div>
                              <span className="font-black text-sm sm:text-base text-amber-950 uppercase tracking-wider block">FINAL</span>
                              <span className="text-[10px] font-extrabold text-amber-900/90 uppercase tracking-widest block">Perebutan Gelar Juara Utama</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-black text-amber-900/80">#{m.matchNum}</span>
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              isWO ? 'bg-amber-600 text-white' :
                              isFinished ? 'bg-emerald-600 text-white' :
                              'bg-amber-200 text-amber-950 border border-amber-300'
                            }`}>
                              {isWO ? 'WO' : isFinished ? 'SELESAI' : 'BELUM DIMAINKAN'}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-3 relative z-10">
                          {/* Player 1 Slot */}
                          <div className={`p-3 rounded-xl border-2 flex items-center justify-between transition ${
                            m.winnerId === m.entryId1 && m.entryId1
                              ? 'bg-amber-100 border-amber-400 text-amber-950 font-black shadow-md'
                              : 'bg-white/95 border-amber-200 text-slate-800 font-extrabold'
                          }`}>
                            <div className="flex flex-col truncate pr-2">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="truncate text-sm sm:text-base font-extrabold">{m.entryId1 ? getEntryLabel(m.entryId1) : getSlotEmptyLabel(m, 1)}</span>
                                {m.winnerId === m.entryId1 && m.entryId1 && (
                                  <span className="shrink-0 bg-amber-400 text-amber-950 font-black text-[10px] px-2 py-0.5 rounded flex items-center gap-0.5 shadow-xs">
                                    <Trophy className="h-3 w-3" /> JUARA
                                  </span>
                                )}
                                {isFinished && m.winnerId && m.winnerId !== m.entryId1 && m.entryId1 && (
                                  <span className="shrink-0 bg-slate-200 text-slate-700 font-bold text-[10px] px-2 py-0.5 rounded">
                                    RUNNER-UP
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-mono text-amber-800/80 font-bold mt-0.5">
                                {slot1Source}
                              </span>
                            </div>
                            <span className="font-mono text-base sm:text-lg font-black px-3 py-1 bg-amber-200/80 rounded-lg text-amber-950 shrink-0">
                              {m.score1 ?? '-'}
                            </span>
                          </div>

                          {/* Player 2 Slot */}
                          <div className={`p-3 rounded-xl border-2 flex items-center justify-between transition ${
                            m.winnerId === m.entryId2 && m.entryId2
                              ? 'bg-amber-100 border-amber-400 text-amber-950 font-black shadow-md'
                              : 'bg-white/95 border-amber-200 text-slate-800 font-extrabold'
                          }`}>
                            <div className="flex flex-col truncate pr-2">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="truncate text-sm sm:text-base font-extrabold">{m.entryId2 ? getEntryLabel(m.entryId2) : getSlotEmptyLabel(m, 2)}</span>
                                {m.winnerId === m.entryId2 && m.entryId2 && (
                                  <span className="shrink-0 bg-amber-400 text-amber-950 font-black text-[10px] px-2 py-0.5 rounded flex items-center gap-0.5 shadow-xs">
                                    <Trophy className="h-3 w-3" /> JUARA
                                  </span>
                                )}
                                {isFinished && m.winnerId && m.winnerId !== m.entryId2 && m.entryId2 && (
                                  <span className="shrink-0 bg-slate-200 text-slate-700 font-bold text-[10px] px-2 py-0.5 rounded">
                                    RUNNER-UP
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-mono text-amber-800/80 font-bold mt-0.5">
                                {slot2Source}
                              </span>
                            </div>
                            <span className="font-mono text-base sm:text-lg font-black px-3 py-1 bg-amber-200/80 rounded-lg text-amber-950 shrink-0">
                              {m.score2 ?? '-'}
                            </span>
                          </div>
                        </div>

                        {m.notes && (
                          <div className="text-[10px] italic text-amber-900/90 bg-amber-100/80 p-2 rounded-lg font-mono truncate border border-amber-200 relative z-10">
                            💬 {m.notes}
                          </div>
                        )}

                        {isAdmin && knockoutStage?.arrangementLocked && (
                          <div className="flex items-center gap-2 pt-1 relative z-10">
                            {m.entryId1 && m.entryId2 && m.entryId1 !== 'BYE' && m.entryId2 !== 'BYE' && (
                              <button
                                type="button"
                                onClick={() => openKoScoreModal(m)}
                                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-amber-950 font-black rounded-xl text-xs transition flex items-center justify-center gap-1 shadow-md cursor-pointer"
                              >
                                <Edit3 className="h-4 w-4" /> {isFinished ? 'Edit Skor Final' : 'Input Skor Final'}
                              </button>
                            )}
                            {isFinished && (
                              <button
                                type="button"
                                onClick={() => handleResetKoScore(m)}
                                title="Reset hasil final"
                                className="px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                              >
                                <RotateCcw className="h-4 w-4" /> Reset
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // STANDARD MATCH CARD
                  return (
                    <div
                      key={m.id}
                      className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 card-shadow hover:border-slate-300 transition relative flex-1"
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-500">
                        <span className="font-extrabold text-navy">Match #{m.matchNum}</span>
                        <span className={`px-1.5 py-0.5 rounded font-extrabold ${
                          isWO ? 'bg-amber-100 text-amber-800' :
                          m.status === 'selesai' ? 'bg-emerald-100 text-emerald-800' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {isWO ? 'WO' : m.status === 'selesai' ? 'SELESAI' : 'BELUM'}
                        </span>
                      </div>

                      <div className="space-y-2 text-xs font-bold">
                        {/* Player 1 */}
                        <div className={`p-2 rounded-lg border flex items-center justify-between transition ${
                          m.winnerId === m.entryId1 && m.entryId1 ? 'bg-emerald-100/90 border-emerald-300 text-emerald-950 font-black' : 'bg-white border-slate-200 text-slate-700'
                        }`}>
                          <div className="flex flex-col truncate pr-2">
                            <span className="truncate">{m.entryId1 ? getEntryLabel(m.entryId1) : getSlotEmptyLabel(m, 1)}</span>
                            <span className="text-[9px] font-mono text-slate-400 font-semibold">
                              {slot1Source}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-black shrink-0 px-1.5 py-0.5 bg-slate-100 rounded">{m.score1 ?? '-'}</span>
                        </div>

                        {/* Player 2 */}
                        <div className={`p-2 rounded-lg border flex items-center justify-between transition ${
                          m.winnerId === m.entryId2 && m.entryId2 ? 'bg-emerald-100/90 border-emerald-300 text-emerald-950 font-black' : 'bg-white border-slate-200 text-slate-700'
                        }`}>
                          <div className="flex flex-col truncate pr-2">
                            <span className="truncate">{m.entryId2 ? getEntryLabel(m.entryId2) : getSlotEmptyLabel(m, 2)}</span>
                            <span className="text-[9px] font-mono text-slate-400 font-semibold">
                              {slot2Source}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-black shrink-0 px-1.5 py-0.5 bg-slate-100 rounded">{m.score2 ?? '-'}</span>
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
                              className="flex-1 py-1 bg-navy text-neon rounded-lg text-[10px] font-extrabold hover:bg-navy-light transition flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Edit3 className="h-3 w-3" /> {isFinished ? 'Edit Skor' : 'Input Skor'}
                            </button>
                          )}

                          {isFinished && (
                            <button
                              type="button"
                              onClick={() => handleResetKoScore(m)}
                              title="Reset hasil pertandingan ini"
                              className="px-2 py-1 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="h-3 w-3" /> Reset
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                // Group round matches into canonical feeder pairs based on nextMatchNum
                const matchGroups: { nextMatchNum: number | null; matches: Match[] }[] = [];
                const processedIds = new Set<string>();

                roundMatches.forEach(m => {
                  if (processedIds.has(m.id)) return;
                  if (m.nextMatchNum) {
                    const siblings = roundMatches.filter(s => s.nextMatchNum === m.nextMatchNum);
                    siblings.forEach(s => processedIds.add(s.id));
                    matchGroups.push({ nextMatchNum: m.nextMatchNum, matches: siblings });
                  } else {
                    processedIds.add(m.id);
                    matchGroups.push({ nextMatchNum: null, matches: [m] });
                  }
                });

                return (
                  <div
                    key={roundName}
                    className={`flex-1 space-y-4 ${
                      isFinalRound ? 'min-w-[320px] sm:min-w-[380px]' : 'min-w-[280px]'
                    }`}
                  >
                    <div className="text-center font-black text-xs text-navy uppercase tracking-wider pb-2 border-b-2 border-navy/20 flex items-center justify-center gap-1.5">
                      {isFinalRound && <Trophy className="h-4 w-4 text-amber-600" />}
                      <span>{roundName}</span>
                    </div>

                    <div className="space-y-6">
                      {matchGroups.map((group, gIdx) => {
                        if (group.matches.length === 2) {
                          const matchA = group.matches.find(s => s.nextMatchSlot === 'player1') || group.matches[0];
                          const matchB = group.matches.find(s => s.nextMatchSlot === 'player2') || group.matches[1];

                          return (
                            <div key={`pair-${group.nextMatchNum || gIdx}`} className="flex items-stretch relative my-3">
                              {/* Left: Feeder Match Cards Stacked */}
                              <div className="flex flex-col justify-between gap-6 flex-1 min-w-[240px]">
                                {renderMatchCard(matchA)}
                                {renderMatchCard(matchB)}
                              </div>

                              {/* Right: Canonical Connector Branch (Horizontal / Vertical) */}
                              <div className="hidden md:flex w-8 sm:w-10 relative items-center justify-center shrink-0 pointer-events-none ml-2">
                                {/* Top horizontal line from Match A */}
                                <div className="absolute top-[25%] left-0 right-1/2 h-[2px] bg-slate-300" />
                                {/* Bottom horizontal line from Match B */}
                                <div className="absolute top-[75%] left-0 right-1/2 h-[2px] bg-slate-300" />
                                {/* Vertical joining line */}
                                <div className="absolute top-[25%] bottom-[25%] right-1/2 w-[2px] bg-slate-300" />
                                {/* Center horizontal line pointing right to next match */}
                                <div className="absolute top-1/2 left-1/2 right-0 h-[2px] bg-slate-300 flex items-center justify-end">
                                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 -mr-2 shrink-0" />
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // Single match in group (e.g. Final or orphan/standalone)
                        const singleMatch = group.matches[0];
                        return (
                          <div key={singleMatch.id} className="flex items-center relative my-3">
                            <div className="flex-1">
                              {renderMatchCard(singleMatch)}
                            </div>
                            {singleMatch.nextMatchNum && !isFinalRound && (
                              <div className="hidden md:flex w-8 sm:w-10 relative items-center justify-center shrink-0 pointer-events-none ml-2">
                                <div className="w-full h-[2px] bg-slate-300 flex items-center justify-end">
                                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 -mr-2 shrink-0" />
                                </div>
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

          {/* PAINDO-010: PENYELESAIAN DIVISI & HASIL RESMI */}
          <div className="space-y-6 pt-6 border-t border-slate-200 mt-8">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-600" />
                  <h3 className="text-base font-black text-navy uppercase tracking-wide">
                    PENYELESAIAN DIVISI & HASIL RESMI
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Modul penetapan juara, verifikasi podium canonical, dan pengesahan hasil divisi resmi.
                </p>
              </div>

              {division.podiumOfficial ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-black">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>HASIL DISAHKAN</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-xl text-xs font-extrabold">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>BELUM DISAHKAN</span>
                </div>
              )}
            </div>

            {/* Official Endorsement Status Banner if podiumOfficial */}
            {division.podiumOfficial && (
              <div className="bg-emerald-500/10 border-2 border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-3 card-shadow">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-xs shrink-0">
                      <Award className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-emerald-950 uppercase tracking-wide">
                        HASIL RESMI DIVISI TELAH DISAHKAN
                      </h4>
                      <p className="text-xs text-emerald-800 font-medium mt-0.5">
                        Podium dan peringkat juara telah resmi terkunci secara permanen.
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-emerald-900 mt-2">
                        <span>Waktu Pengesahan: <strong>{division.officialAt ? new Date(division.officialAt).toLocaleString('id-ID') : '-'}</strong></span>
                        {(division.officialName || division.officialBy || division.officialPodium?.officialName || division.officialPodium?.officialBy) && (
                          <span>Oleh Admin: <strong>{division.officialName || division.officialBy || division.officialPodium?.officialName || division.officialPodium?.officialBy}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleRevokePodium}
                      className="self-start sm:self-center px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-extrabold text-xs rounded-xl transition flex items-center gap-1.5 shrink-0"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Batalkan Pengesahan
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Checklists & Preview Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Checklist Status Penyelasaian */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 card-shadow space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-150">
                  <UserCheck className="h-4 w-4 text-navy" />
                  <h4 className="font-extrabold text-xs text-navy uppercase tracking-wider">
                    CHECKLIST PENYELESAIAN DIVISI
                  </h4>
                </div>

                <div className="space-y-2.5 text-xs">
                  {/* Check 1: Group Stage */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-150">
                    <span className="font-bold text-slate-700">Fase Grup</span>
                    {(() => {
                      const unplayed = (division.roundRobinMatches || []).filter(m => m.status === 'belum_dimainkan').length;
                      if (division.groups.length === 0) return <span className="text-slate-400 font-mono text-[10px]">TANPA GRUP</span>;
                      if (unplayed === 0) return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-extrabold text-[10px] rounded-md flex items-center gap-1"><Check className="h-3 w-3" /> SELESAI</span>;
                      return <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-extrabold text-[10px] rounded-md">{unplayed} BELUM</span>;
                    })()}
                  </div>

                  {/* Check 2: Bracket Locked */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-150">
                    <span className="font-bold text-slate-700">Status Bagan</span>
                    {knockoutStage.isLocked ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-extrabold text-[10px] rounded-md flex items-center gap-1"><Lock className="h-3 w-3" /> TERKUNCI</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-extrabold text-[10px] rounded-md flex items-center gap-1"><Unlock className="h-3 w-3" /> UNLOCKED</span>
                    )}
                  </div>

                  {/* Check 3: Final Match */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-150">
                    <span className="font-bold text-slate-700">Pertandingan Final</span>
                    {(() => {
                      const finalM = knockoutStage.matches.find(m => m.roundName === 'Final' || (!m.nextMatchNum && !m.isBronzeMatch));
                      const isDone = finalM && (finalM.status === 'selesai' || finalM.status === 'walkover') && !!finalM.winnerId;
                      if (isDone) return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-extrabold text-[10px] rounded-md flex items-center gap-1"><Check className="h-3 w-3" /> SELESAI</span>;
                      return <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-extrabold text-[10px] rounded-md">BELUM SELESAI</span>;
                    })()}
                  </div>

                  {/* Check 4: Third Place Policy */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-150">
                    <span className="font-bold text-slate-700">Mode Juara 3</span>
                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 font-black text-[10px] rounded-md uppercase">
                      {thirdPlaceMode === 'shared_bronze' ? 'Shared Bronze' : thirdPlaceMode === 'playoff' ? 'Playoff (Perebutan)' : 'Tanpa Juara 3'}
                    </span>
                  </div>

                  {/* Check 5: Podium Derivation Validity */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-150">
                    <span className="font-bold text-slate-700">Derivasi Podium</span>
                    {podiumPreview.valid ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-extrabold text-[10px] rounded-md flex items-center gap-1"><Check className="h-3 w-3" /> VALID</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-rose-100 text-rose-800 font-extrabold text-[10px] rounded-md">TIDAK VALID</span>
                    )}
                  </div>
                </div>

                {/* Validation Blockers or Warnings */}
                {completionValidation.blockers.length > 0 && !division.podiumOfficial && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                    <span className="font-extrabold text-[11px] text-amber-900 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Syarat Pengesahan Belum Terpenuhi:
                    </span>
                    <ul className="list-disc list-inside text-[11px] text-amber-800 space-y-0.5 pl-1">
                      {completionValidation.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Endorse Button for Admin */}
                {isAdmin && !division.podiumOfficial && (
                  <button
                    type="button"
                    onClick={handleEndorsePodium}
                    disabled={!completionValidation.canFinalize}
                    className={`w-full py-2.5 px-4 font-black text-xs rounded-xl card-shadow transition flex items-center justify-center gap-2 ${
                      completionValidation.canFinalize
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Sahkan Hasil Divisi Ini
                  </button>
                )}
              </div>

              {/* Right Column (2 cols): PREVIEW PODIUM RESMI */}
              <div className="lg:col-span-2 bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 card-shadow space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-150">
                  <div className="flex items-center gap-2">
                    <Medal className="h-4 w-4 text-amber-600" />
                    <h4 className="font-extrabold text-xs text-navy uppercase tracking-wider">
                      {division.podiumOfficial ? 'PODIUM HASIL RESMI' : 'PREVIEW PODIUM DIVISI'}
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-slate-500">
                    {podiumPreview.entries.length} Posisi Canonical
                  </span>
                </div>

                {podiumPreview.warnings.length > 0 && (
                  <div className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-black text-amber-900">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        Peringatan Integritas Hasil Final
                      </div>
                      {isAdmin && !isReadOnly && (
                        <button
                          type="button"
                          onClick={() => setShowFixFinalModal(true)}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[11px] rounded-lg shadow-xs transition flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="h-3 w-3" />
                          Perbaiki Data Hasil Final
                        </button>
                      )}
                    </div>
                    <ul className="list-disc list-inside text-xs font-bold text-amber-800 space-y-0.5">
                      {podiumPreview.warnings.map((warn, i) => (
                        <li key={i}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {podiumPreview.entries.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-250 text-slate-500 text-xs font-medium space-y-2">
                    <Trophy className="h-8 w-8 text-slate-300 mx-auto" />
                    <p>Podium belum dapat dirumuskan. Selesaikan seluruh pertandingan babak final/semifinal/perebutan juara 3 terlebih dahulu.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {podiumPreview.entries.map((pEntry, idx) => {
                      const isWinner = pEntry.placement === 1;
                      const isRunnerUp = pEntry.placement === 2;
                      const isBronze = pEntry.placement === 3;

                      const bgCard = isWinner
                        ? 'bg-gradient-to-br from-amber-50 to-amber-100/60 border-amber-300'
                        : isRunnerUp
                        ? 'bg-gradient-to-br from-slate-50 to-slate-100 border-slate-300'
                        : isBronze
                        ? 'bg-gradient-to-br from-amber-50/50 to-orange-50/50 border-amber-200'
                        : 'bg-slate-50 border-slate-200';

                      const iconColor = isWinner
                        ? 'text-amber-500'
                        : isRunnerUp
                        ? 'text-slate-400'
                        : isBronze
                        ? 'text-amber-700'
                        : 'text-slate-500';

                      return (
                        <div key={idx} className={`p-3.5 rounded-xl border ${bgCard} space-y-2 card-shadow`}>
                          <div className="flex items-center justify-between">
                            <span className="font-black text-[11px] uppercase tracking-wider text-navy flex items-center gap-1.5">
                              <Trophy className={`h-4 w-4 ${iconColor}`} />
                              {pEntry.label}
                            </span>
                            <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700">
                              P{pEntry.placement}
                            </span>
                          </div>

                          <div className="font-black text-sm text-navy truncate">
                            {getEntryLabel(pEntry.entryId)}
                          </div>

                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-200/60">
                            <span>Sumber: {pEntry.sourceType}</span>
                            {pEntry.isShared && (
                              <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 font-extrabold rounded">
                                SHARED
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
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
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{showAlert.message}</p>
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

      {/* Endorse Confirmation Modal */}
      {showEndorseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                Pengesahan Hasil Resmi Divisi
              </h4>
              <button onClick={() => setShowEndorseModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 space-y-1">
                <div className="font-black">Pernyataan Pengesahan Resmi</div>
                <p>
                  Dengan mengesahkan hasil divisi ini, seluruh daftar pemenang/podium akan disimpan secara permanen di database cloud (canonical multi-row) dan status divisi dinyatakan <strong>SELESAI (COMPLETED)</strong>.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-extrabold text-navy block">
                  Nama Official / Admin untuk Ditampilkan <span className="text-slate-400 font-normal">(Opsional)</span>
                </label>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Nama ini disimpan sebagai identitas tampilan pada riwayat pengesahan. ID pengguna diambil otomatis dari akun yang sedang login.
                </p>
                <input
                  type="text"
                  value={endorseBy}
                  onChange={e => setEndorseBy(e.target.value.slice(0, 120))}
                  maxLength={120}
                  placeholder="Contoh: Farid Wajidi atau Panitia Turnamen"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-navy font-medium"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={endorseConfirmChecked}
                    onChange={e => setEndorseConfirmChecked(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs font-bold text-slate-800 leading-snug">
                    Saya telah mereview seluruh hasil pertandingan, verifikasi podium, dan secara resmi mengesahkan hasil divisi ini.
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-150">
              <button
                type="button"
                onClick={() => setShowEndorseModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeEndorsePodium}
                disabled={!endorseConfirmChecked}
                className={`px-4 py-2 font-extrabold text-xs rounded-xl card-shadow transition ${
                  endorseConfirmChecked
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                Sahkan Hasil Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {showRevokeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-rose-600" />
                Pencabutan Pengesahan Hasil Divisi
              </h4>
              <button onClick={() => setShowRevokeModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-950 space-y-1">
                <div className="font-black">Peringatan Soft-Revoke</div>
                <p>
                  Pengesahan divisi akan dibatalkan. Data pengesahan sebelumnya akan diberi status <strong>REVOKED</strong> sebagai riwayat histori, dan bracket akan terbuka kembali untuk koreksi. Skor pertandingan tidak dihapus.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-extrabold text-navy block">Alasan Pencabutan Pengesahan <span className="text-rose-500">*</span></label>
                <textarea
                  value={revokeReason}
                  onChange={e => setRevokeReason(e.target.value)}
                  placeholder="Contoh: Terdapat koreksi kesalahan penulisan skor pada pertandingan semifinal"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-navy"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-150">
              <button
                type="button"
                onClick={() => setShowRevokeModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeRevokePodium}
                disabled={!revokeReason.trim()}
                className={`px-4 py-2 font-extrabold text-xs rounded-xl card-shadow transition ${
                  revokeReason.trim()
                    ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                Batalkan Pengesahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix Final Match Data Modal */}
      {showFixFinalModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 card-shadow border border-slate-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-sm flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-amber-600" />
                Perbaiki Data Hasil Final
              </h4>
              <button onClick={() => setShowFixFinalModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 space-y-1">
                <div className="font-black">Koreksi Data Loser Final (Hotfix Sync)</div>
                <p>
                  Sistem mendeteksi bahwa data pihak kalah (loserId) pertandingan Final tidak konsisten. Aksi ini hanya akan memperbarui <strong className="font-mono">loserId</strong> ke Runner-up sah dari peserta Final tanpa mengubah skor, winnerId, atau susunan bracket.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-extrabold text-navy block">Alasan Koreksi Data Final <span className="text-rose-500">*</span></label>
                <textarea
                  value={fixFinalReason}
                  onChange={e => setFixFinalReason(e.target.value)}
                  placeholder="Contoh: Koreksi sinkronisasi runner-up sah pertandingan Final sesuai audit canonical"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-navy"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-150">
              <button
                type="button"
                onClick={() => setShowFixFinalModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeFixFinalMatchData}
                disabled={!fixFinalReason.trim()}
                className={`px-4 py-2 font-extrabold text-xs rounded-xl card-shadow transition ${
                  fixFinalReason.trim()
                    ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                Simpan & Perbaiki Data Final
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
