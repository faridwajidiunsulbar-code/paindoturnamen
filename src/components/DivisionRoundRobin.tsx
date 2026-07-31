/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Division, Match, Entry, Group, GroupStandingRow } from '../types';
import { calculateGroupStandings, generateRoundRobinMatches } from '../utils/tournamentHelpers';
import { checkRoundRobinLockStatus, inspectRoundRobinMatches } from '../services/matchService';
import { checkDivisionGroupLockStatus, validateAndCleanGroups } from '../services/groupService';
import {
  Award,
  Check,
  Eye,
  Edit3,
  Circle,
  ClipboardCheck,
  Trophy,
  RefreshCw,
  X,
  AlertCircle,
  Play,
  Sparkles,
  Lock,
  ShieldAlert,
  RotateCcw,
  Trash2,
  Info,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Sliders
} from 'lucide-react';

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
  const [woReasonCategory, setWoReasonCategory] = useState<string>('cedera');
  const [woCustomReason, setWoCustomReason] = useState<string>('');

  // Admin Single Match Correction / Force Majeure Modal State
  const [correctionMatch, setCorrectionMatch] = useState<Match | null>(null);
  const [korReasonCategory, setKorReasonCategory] = useState<string>('keputusan_panitia');
  const [korCustomReason, setKorCustomReason] = useState<string>('');
  const [korActionType, setKorActionType] = useState<'update_score' | 'mark_walkover' | 'reset_match'>('update_score');
  const [korScore1, setKorScore1] = useState<number | string>('');
  const [korScore2, setKorScore2] = useState<number | string>('');
  const [korWinnerId, setKorWinnerId] = useState<string>('');

  // Single Match Reset State
  const [resetSingleMatchItem, setResetSingleMatchItem] = useState<Match | null>(null);
  const [resetSingleReasonCategory, setResetSingleReasonCategory] = useState<string>('kesalahan_input');
  const [resetSingleCustomReason, setResetSingleCustomReason] = useState<string>('');

  // Reset All Group Results Modal State
  const [showResetAllResultsModal, setShowResetAllResultsModal] = useState(false);
  const [resetAllResultsCategory, setResetAllResultsCategory] = useState<string>('koreksi_total');
  const [resetAllResultsCustomReason, setResetAllResultsCustomReason] = useState<string>('');

  // Reset Schedule and All Group Results Modal State
  const [showResetScheduleModal, setShowResetScheduleModal] = useState(false);
  const [resetScheduleCategory, setResetScheduleCategory] = useState<string>('perubahan_grup');
  const [resetScheduleCustomReason, setResetScheduleCustomReason] = useState<string>('');

  // Integrity Modal State
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);

  // General Confirmation & Alert Popups
  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [showAlert, setShowAlert] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // Check locks
  const lockStatus = checkRoundRobinLockStatus(division);
  const groupLock = checkDivisionGroupLockStatus(division);
  const anomalies = inspectRoundRobinMatches(division);

  // Generate matches safely with PAINDO-005B & PAINDO-006 lock checks
  const handleGenerateMatchesDirectly = () => {
    if (lockStatus.isLocked) {
      setShowAlert({
        title: 'Jadwal Terkunci 🔒',
        message: lockStatus.reason
      });
      return;
    }

    if (groups.length === 0) {
      setShowAlert({
        title: 'Belum Ada Grup ⚠️',
        message: 'Belum ada grup yang dibentuk pada divisi ini. Silakan buat grup di tab Pembagian Grup terlebih dahulu.'
      });
      return;
    }

    const groupValResult = validateAndCleanGroups(groups, entries);

    if (groupValResult.unassignedEntries.length > 0) {
      setShowAlert({
        title: 'Pembagian Grup Belum Selesai ⚠️',
        message: `Masih terdapat ${groupValResult.unassignedEntries.length} peserta yang belum dimasukkan ke dalam grup. Selesaikan pembagian grup terlebih dahulu.`
      });
      return;
    }

    if (groupLock.hasScores) {
      setShowAlert({
        title: 'Jadwal Terkunci 🔒',
        message: 'Jadwal terkunci karena sudah terdapat pertandingan dengan skor/hasil terisi.'
      });
      return;
    }

    const doGenerate = () => {
      const { cleanedGroups } = validateAndCleanGroups(groups, entries);
      const groupMatchesList: Match[][] = [];

      cleanedGroups.forEach(g => {
        const validEntryIds = g.entryIds.filter(id => entries.some(e => e.id === id));
        const matches: Match[] = [];
        let matchIndex = 1;

        for (let i = 0; i < validEntryIds.length; i++) {
          for (let j = i + 1; j < validEntryIds.length; j++) {
            matches.push({
              id: `rr-${division.id}-${g.id}-${matchIndex++}`,
              divisionId: division.id,
              groupName: g.name,
              type: 'ROUND_ROBIN',
              entryId1: validEntryIds[i],
              entryId2: validEntryIds[j],
              score1: null,
              score2: null,
              status: 'belum_dimainkan'
            });
          }
        }
        groupMatchesList.push(matches);
      });

      // Interleave matches across groups for smooth match rotation
      const interleaved: Match[] = [];
      let maxLen = 0;
      groupMatchesList.forEach(mList => {
        if (mList.length > maxLen) maxLen = mList.length;
      });

      for (let roundIdx = 0; roundIdx < maxLen; roundIdx++) {
        groupMatchesList.forEach(mList => {
          if (mList[roundIdx]) {
            interleaved.push({
              ...mList[roundIdx],
              matchNum: interleaved.length + 1
            });
          }
        });
      }

      onUpdateDivision({
        ...division,
        groups: cleanedGroups,
        roundRobinMatches: interleaved
      });

      setShowAlert({
        title: 'Jadwal Round Robin Berhasil Dibuat ✅',
        message: `Berhasil membuat ${interleaved.length} pertandingan dari ${cleanedGroups.length} grup. Setiap pasangan peserta bertemu tepat satu kali.`
      });
    };

    if (roundRobinMatches.length > 0) {
      setShowConfirm({
        title: 'Konfirmasi Generate Ulang Jadwal',
        message: 'Jadwal pertandingan fase grup sudah ada. Apakah Anda yakin ingin meng-generate ulang jadwal? (Susunan grup dan peserta tetap dipertahankan).',
        onConfirm: () => {
          setShowConfirm(null);
          doGenerate();
        }
      });
    } else {
      doGenerate();
    }
  };

  // Generate groups automatically & create round-robin matches
  const handleGenerateGroupsAndMatches = () => {
    if (lockStatus.isLocked) {
      setShowAlert({
        title: 'Fitur Terkunci 🔒',
        message: lockStatus.reason
      });
      return;
    }

    if (entries.length === 0) {
      setShowAlert({
        title: 'Tidak Ada Peserta',
        message: 'Belum ada peserta terdaftar. Silakan tambahkan atau impor peserta di tab Peserta terlebih dahulu.'
      });
      return;
    }

    const targetPerGroup = settings.playersPerGroup || 4;
    const numGroups = Math.max(1, Math.ceil(entries.length / targetPerGroup));
    
    const newGroups: Group[] = Array.from({ length: numGroups }, (_, i) => {
      const code = String.fromCharCode(65 + i);
      return {
        id: `grp-${code.toLowerCase()}-${Date.now()}-${i}`,
        name: `Grup ${code}`,
        entryIds: []
      };
    });

    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    shuffled.forEach((entry, idx) => {
      const targetIdx = idx % numGroups;
      newGroups[targetIdx].entryIds.push(entry.id);
    });

    const groupMatchesList: Match[][] = [];
    newGroups.forEach(g => {
      const groupMatches = generateRoundRobinMatches(division.id, g, entries);
      groupMatchesList.push(groupMatches);
    });

    const interleaved: Match[] = [];
    let maxLen = 0;
    groupMatchesList.forEach(mList => {
      if (mList.length > maxLen) maxLen = mList.length;
    });

    for (let roundIdx = 0; roundIdx < maxLen; roundIdx++) {
      groupMatchesList.forEach(mList => {
        if (mList[roundIdx]) {
          interleaved.push({
            ...mList[roundIdx],
            matchNum: interleaved.length + 1
          });
        }
      });
    }

    onUpdateDivision({
      ...division,
      groups: newGroups,
      roundRobinMatches: interleaved,
      knockoutStage: null,
      champions: null
    });

    setShowAlert({
      title: 'Grup & Jadwal Berhasil Dibuat 🎯',
      message: `Berhasil membentuk ${newGroups.length} grup dan ${interleaved.length} pertandingan round robin.`
    });
  };

  // Calculate standings for each group
  const standingsByGroup: Record<string, GroupStandingRow[]> = {};
  groups.forEach(g => {
    standingsByGroup[g.id] = calculateGroupStandings(g, roundRobinMatches, entries);
  });

  // Open scoring modal
  const openScoringModal = (match: Match) => {
    if (lockStatus.isLocked) {
      setShowAlert({
        title: 'Input Skor Terkunci 🔒',
        message: lockStatus.reason
      });
      return;
    }

    setScoringMatch(match);
    const initialWinner = match.winnerId || match.entryId1 || '';
    setWalkoverWinner(initialWinner);
    setWoReasonCategory(match.notes ? 'lainnya' : 'cedera');
    setWoCustomReason(match.notes || '');

    const initialStatus = match.status === 'belum_dimainkan' ? 'selesai' : match.status;
    setMatchStatus(initialStatus);

    if (match.score1 !== null && match.score2 !== null) {
      setScore1(match.score1);
      setScore2(match.score2);
    } else if (initialStatus === 'walkover' && settings.targetScore) {
      setScore1(initialWinner === match.entryId1 ? settings.targetScore : 0);
      setScore2(initialWinner === match.entryId2 ? settings.targetScore : 0);
    } else {
      setScore1('');
      setScore2('');
    }
  };

  // Close scoring modal
  const closeScoringModal = () => {
    setScoringMatch(null);
  };

  const handleSelectWoWinner = (winnerId: string) => {
    setWalkoverWinner(winnerId);
    if (scoringMatch) {
      const s1Num = Number(score1);
      const s2Num = Number(score2);
      if (score1 === '' || score2 === '' || isNaN(s1Num) || isNaN(s2Num) || s1Num === s2Num) {
        if (settings.targetScore) {
          setScore1(winnerId === scoringMatch.entryId1 ? settings.targetScore : 0);
          setScore2(winnerId === scoringMatch.entryId2 ? settings.targetScore : 0);
        }
      } else if (winnerId === scoringMatch.entryId1 && s1Num <= s2Num) {
        setScore1(s2Num);
        setScore2(s1Num);
      } else if (winnerId === scoringMatch.entryId2 && s2Num <= s1Num) {
        setScore1(s2Num);
        setScore2(s1Num);
      }
    }
  };

  const executeCommitScore = (
    fs1: number | null,
    fs2: number | null,
    status: typeof matchStatus,
    wId: string | null,
    lId: string | null,
    notes?: string
  ) => {
    const updatedMatches = roundRobinMatches.map(m => {
      if (m.id === scoringMatch!.id) {
        return {
          ...m,
          score1: fs1,
          score2: fs2,
          status,
          winnerId: wId,
          loserId: lId,
          notes
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

  // Save scores with integer, Win-by-2, Walkover & non-equal validations
  const saveScore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scoringMatch) return;

    if (lockStatus.isLocked) {
      setShowAlert({
        title: 'Perubahan Terkunci 🔒',
        message: lockStatus.reason
      });
      return;
    }

    let finalScore1: number | null = 0;
    let finalScore2: number | null = 0;
    let winnerId: string | null = null;
    let loserId: string | null = null;
    let finalNotes: string | undefined = undefined;

    if (matchStatus === 'walkover') {
      if (!walkoverWinner) {
        setShowAlert({
          title: 'Pilih Pemenang WO ⚠️',
          message: 'Silakan pilih peserta yang dinyatakan menang Walkover (WO).'
        });
        return;
      }

      const s1Num = Number(score1);
      const s2Num = Number(score2);

      if (score1 === '' || score2 === '' || isNaN(s1Num) || isNaN(s2Num)) {
        setShowAlert({
          title: 'Skor WO Wajib Diisi ⚠️',
          message: 'Kedua skor Walkover (WO) wajib diisi dengan angka bulat non-negatif.'
        });
        return;
      }

      if (s1Num < 0 || s2Num < 0 || !Number.isInteger(s1Num) || !Number.isInteger(s2Num)) {
        setShowAlert({
          title: 'Skor WO Tidak Valid ⚠️',
          message: 'Skor Walkover (WO) harus berupa bilangan bulat non-negatif (0 atau lebih besar).'
        });
        return;
      }

      if (s1Num === s2Num) {
        setShowAlert({
          title: 'Skor WO Seri Tidak Diperbolehkan ⚠️',
          message: 'Skor Walkover (WO) tidak boleh seri. Pilih pemenang dengan skor lebih tinggi.'
        });
        return;
      }

      loserId = walkoverWinner === scoringMatch.entryId1 ? scoringMatch.entryId2 : scoringMatch.entryId1;

      if (walkoverWinner === scoringMatch.entryId1 && s1Num <= s2Num) {
        setShowAlert({
          title: 'Skor Tidak Sesuai Pemenang WO ⚠️',
          message: `Peserta 1 (${getEntryLabel(scoringMatch.entryId1)}) dipilih sebagai pemenang WO, maka skor Peserta 1 (${s1Num}) harus lebih besar dari Peserta 2 (${s2Num}).`
        });
        return;
      }

      if (walkoverWinner === scoringMatch.entryId2 && s2Num <= s1Num) {
        setShowAlert({
          title: 'Skor Tidak Sesuai Pemenang WO ⚠️',
          message: `Peserta 2 (${getEntryLabel(scoringMatch.entryId2)}) dipilih sebagai pemenang WO, maka skor Peserta 2 (${s2Num}) harus lebih besar dari Peserta 1 (${s1Num}).`
        });
        return;
      }

      const reasonText = woReasonCategory === 'lainnya'
        ? woCustomReason.trim()
        : {
            cedera: 'Cedera Peserta',
            mengundurkan_diri: 'Mengundurkan Diri Peserta',
            diskualifikasi: 'Diskualifikasi oleh Panitia',
            ketidakhadiran: 'Ketidakhadiran / Walkover (WO)',
            gangguan_teknis: 'Gangguan Teknis Lapangan',
            cuaca: 'Kondisi Cuaca',
            keputusan_panitia: 'Keputusan Panitia / Force Majeure'
          }[woReasonCategory] || woReasonCategory;

      if (!reasonText) {
        setShowAlert({
          title: 'Alasan WO Wajib Diisi ⚠️',
          message: 'Silakan tuliskan alasan rincian Walkover / Force Majeure.'
        });
        return;
      }

      finalScore1 = s1Num;
      finalScore2 = s2Num;
      winnerId = walkoverWinner;
      finalNotes = `Walkover (WO) - ${reasonText}`;

      executeCommitScore(finalScore1, finalScore2, 'walkover', winnerId, loserId, finalNotes);
    } else {
      const s1Num = Number(score1);
      const s2Num = Number(score2);

      if (score1 === '' || score2 === '' || isNaN(s1Num) || isNaN(s2Num)) {
        setShowAlert({
          title: 'Skor Wajib Diisi ⚠️',
          message: 'Kedua skor wajib diisi dengan angka bulat non-negatif.'
        });
        return;
      }

      if (s1Num < 0 || s2Num < 0 || !Number.isInteger(s1Num) || !Number.isInteger(s2Num)) {
        setShowAlert({
          title: 'Skor Tidak Valid ⚠️',
          message: 'Skor harus berupa bilangan bulat non-negatif (0 atau lebih besar).'
        });
        return;
      }

      if (s1Num === s2Num) {
        setShowAlert({
          title: 'Skor Seri Tidak Diperbolehkan ⚠️',
          message: 'Skor seri tidak diperbolehkan. Harus ada pemenang dalam pertandingan.'
        });
        return;
      }

      finalScore1 = s1Num;
      finalScore2 = s2Num;

      // Check win-by-2 condition
      if (settings.winByTwo) {
        const diff = Math.abs(finalScore1 - finalScore2);
        const maxScore = Math.max(finalScore1, finalScore2);

        if (maxScore < settings.targetScore) {
          setShowConfirm({
            title: 'Simpan Skor di Bawah Target',
            message: `Skor tertinggi (${maxScore}) kurang dari target poin (${settings.targetScore}). Apakah Anda yakin ingin menyimpan hasil ini?`,
            onConfirm: () => {
              const wId = finalScore1! > finalScore2! ? scoringMatch.entryId1 : scoringMatch.entryId2;
              const lId = finalScore1! > finalScore2! ? scoringMatch.entryId2 : scoringMatch.entryId1;
              executeCommitScore(finalScore1, finalScore2, 'selesai', wId, lId, undefined);
              setShowConfirm(null);
            }
          });
          return;
        } else if (maxScore > settings.targetScore && diff < 2) {
          setShowAlert({
            title: 'Aturan Win by 2 ⚠️',
            message: `Game harus dimenangkan dengan selisih minimal 2 poin (Win by 2) saat mencapai/melampaui target poin.`
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

      executeCommitScore(finalScore1, finalScore2, 'selesai', winnerId, loserId, undefined);
    }
  };

  // Single Match Admin Correction Modal Handler
  const openCorrectionModal = (match: Match) => {
    if (lockStatus.isLocked) {
      setShowAlert({
        title: 'Koreksi Terkunci 🔒',
        message: lockStatus.reason
      });
      return;
    }

    setCorrectionMatch(match);
    setKorReasonCategory('keputusan_panitia');
    setKorCustomReason('');
    setKorActionType(match.status === 'walkover' ? 'mark_walkover' : 'update_score');
    const wId = match.winnerId || match.entryId1 || '';
    setKorWinnerId(wId);

    if (match.status === 'walkover') {
      if (match.score1 !== null && match.score2 !== null) {
        setKorScore1(match.score1);
        setKorScore2(match.score2);
      } else if (settings.targetScore) {
        setKorScore1(wId === match.entryId1 ? settings.targetScore : 0);
        setKorScore2(wId === match.entryId2 ? settings.targetScore : 0);
      } else {
        setKorScore1('');
        setKorScore2('');
      }
    } else {
      setKorScore1(match.score1 ?? '');
      setKorScore2(match.score2 ?? '');
    }
  };

  const executeAdminCorrection = () => {
    if (!correctionMatch) return;

    if (lockStatus.isLocked) {
      setShowAlert({ title: 'Koreksi Terkunci 🔒', message: lockStatus.reason });
      return;
    }

    const finalReason = korReasonCategory === 'lainnya'
      ? korCustomReason.trim()
      : {
          cedera: 'Cedera / Mengundurkan Diri Peserta',
          diskualifikasi: 'Diskualifikasi Peserta oleh Panitia',
          ketidakhadiran: 'Ketidakhadiran / Walkover (WO)',
          cuaca_teknis: 'Gangguan Teknis / Kondisi Cuaca',
          keputusan_panitia: 'Keputusan Panitia / Force Majeure'
        }[korReasonCategory] || korReasonCategory;

    if (korReasonCategory === 'lainnya' && !finalReason) {
      setShowAlert({
        title: 'Alasan Wajib Diisi ⚠️',
        message: 'Silakan ketik alasan khusus untuk koreksi hasil pertandingan ini.'
      });
      return;
    }

    let updatedMatches: Match[] = [];

    if (korActionType === 'reset_match') {
      updatedMatches = roundRobinMatches.map(m => {
        if (m.id === correctionMatch.id) {
          return {
            ...m,
            score1: null,
            score2: null,
            status: 'belum_dimainkan' as const,
            winnerId: null,
            loserId: null,
            notes: undefined
          };
        }
        return m;
      });
      setShowAlert({
        title: 'Koreksi Admin Berhasil ✅',
        message: `Pertandingan ${getEntryLabel(correctionMatch.entryId1)} vs ${getEntryLabel(correctionMatch.entryId2)} di-reset menjadi Belum Dimainkan. Alasan: ${finalReason}.`
      });
    } else if (korActionType === 'mark_walkover') {
      const wId = korWinnerId || correctionMatch.entryId1;
      const lId = wId === correctionMatch.entryId1 ? correctionMatch.entryId2 : correctionMatch.entryId1;

      const s1Num = Number(korScore1);
      const s2Num = Number(korScore2);

      if (korScore1 === '' || korScore2 === '' || isNaN(s1Num) || isNaN(s2Num) || s1Num < 0 || s2Num < 0 || !Number.isInteger(s1Num) || !Number.isInteger(s2Num)) {
        setShowAlert({
          title: 'Skor WO Tidak Valid ⚠️',
          message: 'Kedua skor Walkover (WO) wajib diisi dengan bilangan bulat non-negatif.'
        });
        return;
      }

      if (s1Num === s2Num) {
        setShowAlert({
          title: 'Skor WO Seri Tidak Diperbolehkan ⚠️',
          message: 'Skor Walkover (WO) tidak boleh seri. Pilih pemenang dengan skor lebih tinggi.'
        });
        return;
      }

      if (wId === correctionMatch.entryId1 && s1Num <= s2Num) {
        setShowAlert({
          title: 'Skor Tidak Sesuai Pemenang WO ⚠️',
          message: `Peserta 1 (${getEntryLabel(correctionMatch.entryId1)}) dipilih sebagai pemenang WO, maka skor Peserta 1 (${s1Num}) harus lebih besar dari Peserta 2 (${s2Num}).`
        });
        return;
      }

      if (wId === correctionMatch.entryId2 && s2Num <= s1Num) {
        setShowAlert({
          title: 'Skor Tidak Sesuai Pemenang WO ⚠️',
          message: `Peserta 2 (${getEntryLabel(correctionMatch.entryId2)}) dipilih sebagai pemenang WO, maka skor Peserta 2 (${s2Num}) harus lebih besar dari Peserta 1 (${s1Num}).`
        });
        return;
      }

      updatedMatches = roundRobinMatches.map(m => {
        if (m.id === correctionMatch.id) {
          return {
            ...m,
            score1: s1Num,
            score2: s2Num,
            status: 'walkover' as const,
            winnerId: wId,
            loserId: lId,
            notes: `Koreksi Admin (WO) - ${finalReason}`
          };
        }
        return m;
      });

      setShowAlert({
        title: 'Koreksi Walkover Berhasil ✅',
        message: `Pertandingan ditandai Walkover dengan pemenang ${getEntryLabel(wId)} (Skor ${s1Num}-${s2Num}). Alasan: ${finalReason}.`
      });
    } else {
      const s1Num = Number(korScore1);
      const s2Num = Number(korScore2);

      if (korScore1 === '' || korScore2 === '' || isNaN(s1Num) || isNaN(s2Num) || s1Num < 0 || s2Num < 0 || !Number.isInteger(s1Num) || !Number.isInteger(s2Num)) {
        setShowAlert({
          title: 'Skor Tidak Valid ⚠️',
          message: 'Kedua skor koreksi wajib berupa bilangan bulat non-negatif.'
        });
        return;
      }

      if (s1Num === s2Num) {
        setShowAlert({
          title: 'Skor Seri Tidak Valid ⚠️',
          message: 'Skor seri tidak diperbolehkan. Harus ada pemenang.'
        });
        return;
      }

      const wId = s1Num > s2Num ? correctionMatch.entryId1 : correctionMatch.entryId2;
      const lId = s1Num > s2Num ? correctionMatch.entryId2 : correctionMatch.entryId1;

      updatedMatches = roundRobinMatches.map(m => {
        if (m.id === correctionMatch.id) {
          return {
            ...m,
            score1: s1Num,
            score2: s2Num,
            status: 'selesai' as const,
            winnerId: wId,
            loserId: lId,
            notes: `Koreksi Admin - ${finalReason}`
          };
        }
        return m;
      });

      setShowAlert({
        title: 'Koreksi Skor Berhasil ✅',
        message: `Skor pertandingan diperbarui menjadi ${s1Num} - ${s2Num} (Pemenang: ${getEntryLabel(wId)}). Alasan: ${finalReason}.`
      });
    }

    onUpdateDivision({
      ...division,
      roundRobinMatches: updatedMatches
    });

    setCorrectionMatch(null);
  };

  // Open single match reset modal
  const openResetSingleMatchModal = (match: Match) => {
    if (lockStatus.isLocked) {
      setShowAlert({
        title: 'Aksi Terkunci 🔒',
        message: lockStatus.reason
      });
      return;
    }

    setResetSingleMatchItem(match);
    setResetSingleReasonCategory('kesalahan_input');
    setResetSingleCustomReason('');
  };

  const executeResetSingleMatch = () => {
    if (!resetSingleMatchItem) return;

    if (lockStatus.isLocked) {
      setShowAlert({ title: 'Aksi Terkunci 🔒', message: lockStatus.reason });
      return;
    }

    const finalReason = resetSingleReasonCategory === 'lainnya'
      ? resetSingleCustomReason.trim()
      : {
          kesalahan_input: 'Kesalahan Input Skor',
          diskualifikasi: 'Diskualifikasi / Keputusan Panitia',
          perubahan_jadwal: 'Penjadwalan Ulang Match',
          keputusan_panitia: 'Keputusan Panitia / Force Majeure'
        }[resetSingleReasonCategory] || resetSingleReasonCategory;

    if (resetSingleReasonCategory === 'lainnya' && !finalReason) {
      setShowAlert({
        title: 'Alasan Wajib Diisi ⚠️',
        message: 'Silakan ketik alasan khusus reset pertandingan ini.'
      });
      return;
    }

    const updatedMatches = roundRobinMatches.map(m => {
      if (m.id === resetSingleMatchItem.id) {
        return {
          ...m,
          score1: null,
          score2: null,
          status: 'belum_dimainkan' as const,
          winnerId: null,
          loserId: null,
          notes: undefined
        };
      }
      return m;
    });

    onUpdateDivision({
      ...division,
      roundRobinMatches: updatedMatches
    });

    setShowAlert({
      title: 'Hasil Pertandingan Berhasil Direset ✅',
      message: `Skor dan pemenang untuk ${getEntryLabel(resetSingleMatchItem.entryId1)} vs ${getEntryLabel(resetSingleMatchItem.entryId2)} telah dikosongkan. Alasan: ${finalReason}.`
    });

    setResetSingleMatchItem(null);
  };

  // Reset All Group Results
  const executeResetAllResults = () => {
    if (lockStatus.isLocked) {
      setShowAlert({ title: 'Aksi Terkunci 🔒', message: lockStatus.reason });
      return;
    }

    const finalReason = resetAllResultsCategory === 'lainnya'
      ? resetAllResultsCustomReason.trim()
      : {
          koreksi_total: 'Koreksi Total Hasil Fase Grup',
          perubahan_skema: 'Perubahan Skema Turnamen / Force Majeure',
          gangguan_teknis: 'Gangguan Sistem / Hasil Tidak Valid',
          keputusan_panitia: 'Keputusan Panitia'
        }[resetAllResultsCategory] || resetAllResultsCategory;

    if (resetAllResultsCategory === 'lainnya' && !finalReason) {
      setShowAlert({ title: 'Alasan Wajib Diisi ⚠️', message: 'Tuliskan alasan khusus reset seluruh hasil.' });
      return;
    }

    const resetMatches = roundRobinMatches.map(m => ({
      ...m,
      score1: null,
      score2: null,
      status: 'belum_dimainkan' as const,
      winnerId: null,
      loserId: null,
      notes: undefined
    }));

    onUpdateDivision({
      ...division,
      roundRobinMatches: resetMatches
    });

    setShowAlert({
      title: 'Seluruh Hasil Fase Grup Berhasil Direset ✅',
      message: `Tindakan (${finalReason}): Seluruh skor dari ${resetMatches.length} pertandingan round-robin telah dikosongkan. Jadwal dan susunan grup dipertahankan.`
    });

    setShowResetAllResultsModal(false);
  };

  // Reset Schedule & All Group Results
  const executeResetScheduleAndResults = () => {
    if (lockStatus.isLocked) {
      setShowAlert({ title: 'Aksi Terkunci 🔒', message: lockStatus.reason });
      return;
    }

    const finalReason = resetScheduleCategory === 'lainnya'
      ? resetScheduleCustomReason.trim()
      : {
          perubahan_grup: 'Perubahan Susunan Grup / Peserta',
          generate_ulang: 'Permintaan Generate Ulang Jadwal',
          keputusan_panitia: 'Keputusan Panitia / Force Majeure'
        }[resetScheduleCategory] || resetScheduleCategory;

    if (resetScheduleCategory === 'lainnya' && !finalReason) {
      setShowAlert({ title: 'Alasan Wajib Diisi ⚠️', message: 'Tuliskan alasan khusus reset jadwal.' });
      return;
    }

    onUpdateDivision({
      ...division,
      roundRobinMatches: []
    });

    setShowAlert({
      title: 'Jadwal & Hasil Fase Grup Berhasil Direset ✅',
      message: `Tindakan (${finalReason}): Seluruh jadwal (${roundRobinMatches.length} pertandingan) dan skor fase grup telah dihapus. Peserta dan susunan grup dipertahankan.`
    });

    setShowResetScheduleModal(false);
  };

  // Clean / Fix Match Integrity (Pure & Bounded Auto-Correction)
  const handleFixMatchIntegrity = () => {
    if (lockStatus.isLocked) {
      setShowAlert({ title: 'Aksi Terkunci 🔒', message: lockStatus.reason });
      return;
    }

    setShowConfirm({
      title: 'Koreksi Otomatis Integritas Jadwal',
      message: 'Sistem hanya akan memperbaiki pemenang (winnerId) yang tidak sesuai dengan skor valid dan memperbarui status pertandingan yang sudah memiliki skor lengkap. Masalah duplikat, self-match, atau peserta tidak valid tidak akan dihapus otomatis dan harus dikoreksi manual. Apakah Anda yakin ingin melanjutkan?',
      onConfirm: () => {
        let updatedCount = 0;

        const cleanedMatches: Match[] = (roundRobinMatches || []).map(m => {
          let updated = false;
          let fixedWinnerId = m.winnerId;
          let fixedLoserId = m.loserId;
          let fixedStatus = m.status;

          // Deterministic Fix: Complete valid scores exist -> sync winnerId & status
          if (m.score1 !== null && m.score2 !== null && m.score1 !== m.score2 && m.score1 >= 0 && m.score2 >= 0) {
            const expectedWinner = m.score1 > m.score2 ? m.entryId1 : m.entryId2;
            const expectedLoser = m.score1 > m.score2 ? m.entryId2 : m.entryId1;

            if (m.status === 'selesai') {
              if (m.winnerId !== expectedWinner || m.loserId !== expectedLoser) {
                fixedWinnerId = expectedWinner;
                fixedLoserId = expectedLoser;
                updated = true;
              }
            } else if (m.status === 'belum_dimainkan') {
              fixedStatus = 'selesai';
              fixedWinnerId = expectedWinner;
              fixedLoserId = expectedLoser;
              updated = true;
            }
          }

          if (updated) {
            updatedCount++;
            return {
              ...m,
              winnerId: fixedWinnerId,
              loserId: fixedLoserId,
              status: fixedStatus
            };
          }

          return m;
        });

        if (updatedCount > 0) {
          onUpdateDivision({
            ...division,
            roundRobinMatches: cleanedMatches
          });

          setShowAlert({
            title: 'Koreksi Otomatis Berhasil ✅',
            message: `Berhasil mengoreksi ${updatedCount} pertandingan (pemenang/status disesuaikan dengan skor).`
          });
        } else {
          setShowAlert({
            title: 'Integritas Hasil Valid 👍',
            message: 'Tidak ada status hasil atau pemenang (winnerId) yang perlu diperbaiki otomatis. Jika terdapat peringatan duplikat/peserta, silakan periksa rincian untuk koreksi manual.'
          });
        }

        setShowConfirm(null);
      }
    });
  };

  // Filtered matches
  const filteredMatches = roundRobinMatches.filter(m => {
    let groupMatch = selectedGroupFilter === 'all';
    if (!groupMatch) {
      if (m.groupName === selectedGroupFilter) {
        groupMatch = true;
      } else if (m.groupName) {
        const selNorm = selectedGroupFilter.replace(/^(grup|pool)\s+/i, '').trim().toLowerCase();
        const mNorm = m.groupName.replace(/^(grup|pool)\s+/i, '').trim().toLowerCase();
        if (selNorm === mNorm) groupMatch = true;
      }
      if (!groupMatch) {
        const targetGrp = groups.find(g => g.name === selectedGroupFilter);
        if (targetGrp && m.entryId1 && m.entryId2 && targetGrp.entryIds.includes(m.entryId1) && targetGrp.entryIds.includes(m.entryId2)) {
          groupMatch = true;
        }
      }
    }

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
    <div className="space-y-6 animate-fade-in" id="division-round-robin-panel">

      {/* STATUS BANNER IF LOCKED */}
      {lockStatus.isLocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs" id="round-robin-locked-banner">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h4 className="font-extrabold text-amber-900">Perubahan Fase Grup Terkunci 🔒</h4>
              <p className="text-amber-800 leading-relaxed">{lockStatus.reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* INTEGRITY ALERT BANNER */}
      {anomalies.hasAnomalies && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs" id="integrity-alert-banner">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h4 className="font-extrabold text-rose-900">Integritas Jadwal & Skor Memerlukan Perhatian ⚠️</h4>
              <p className="text-rose-800 leading-relaxed">
                Terdeteksi {anomalies.warnings.length} ketidaksesuaian data pada pertandingan fase grup.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowIntegrityModal(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-100 transition"
            >
              Lihat Rincian ({anomalies.warnings.length})
            </button>
            {isAdmin && !lockStatus.isLocked && (
              <button
                type="button"
                onClick={handleFixMatchIntegrity}
                className="px-3 py-1.5 rounded-xl text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-700 transition"
              >
                Koreksi Otomatis
              </button>
            )}
          </div>
        </div>
      )}

      {roundRobinMatches.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-150 p-8 card-shadow space-y-5" id="empty-rr-matches">
          <div className="w-16 h-16 bg-navy/5 text-navy rounded-full flex items-center justify-center mx-auto border border-navy/10">
            <ClipboardCheck className="h-8 w-8 text-navy" />
          </div>
          <div>
            <p className="text-lg font-black text-navy">Jadwal Round Robin Belum Di-generate</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
              Divisi <strong className="text-navy">{division.eventName} ({division.ageGroupName})</strong> saat ini belum memiliki jadwal pertandingan.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {groups.length > 0 && groups.some(g => g.entryIds.length >= 2) && (
              <button
                type="button"
                onClick={handleGenerateMatchesDirectly}
                disabled={lockStatus.isLocked}
                className={`px-5 py-2.5 bg-navy hover:bg-navy-light text-neon rounded-xl font-black text-xs flex items-center gap-2 transition card-shadow shadow-xs hover:-translate-y-0.5 ${
                  lockStatus.isLocked ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                id="btn-generate-matches-rr"
              >
                <Play className="h-4 w-4 fill-neon" /> Generate Jadwal Match dari {groups.length} Pool
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={handleGenerateGroupsAndMatches}
                disabled={lockStatus.isLocked}
                className={`px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs flex items-center gap-2 transition card-shadow shadow-xs hover:-translate-y-0.5 ${
                  lockStatus.isLocked ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="Bagi seluruh peserta terdaftar ke dalam grup & buat jadwal pertandingan secara otomatis"
                id="btn-generate-groups-rr"
              >
                <Sparkles className="h-4 w-4 text-neon" /> 🎯 Generate Grup Otomatis
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8" id="rr-layout-grid">
          
          {/* COLUMN KIRI: KLASEMEN GRUP (XL: 5/12) */}
          <div className="xl:col-span-5 space-y-6" id="standings-column">
            <div>
              <h3 className="text-base font-extrabold text-navy flex items-center gap-1.5">
                <Trophy className="h-5 w-5 text-neon stroke-navy fill-neon" />
                Klasemen Grup Otomatis
              </h3>
              <p className="text-[11px] text-slate-500 font-medium mt-1 leading-snug">
                Urutan Peringkat: <strong className="text-slate-700">1. Menang (W)</strong> ➔ <strong className="text-slate-700">2. Poin Masuk (PF)</strong> ➔ <strong className="text-slate-700">3. Selisih Poin (Diff)</strong> ➔ <strong className="text-slate-700">4. Head-to-Head</strong>
              </p>
            </div>

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
              <div>
                <h3 className="text-base font-extrabold text-navy flex items-center gap-1.5">
                  <ClipboardCheck className="h-5 w-5 text-neon stroke-navy fill-neon" />
                  Pertandingan Fase Grup ({roundRobinMatches.length})
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Total pertandingan sesuai rumus $N(N-1)/2$. Setiap pasangan bertemu tepat satu kali.
                </p>
              </div>

              {/* Action Toolbar for Admin */}
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2" id="admin-rr-action-bar">
                  <button
                    type="button"
                    onClick={() => setShowResetAllResultsModal(true)}
                    disabled={lockStatus.isLocked}
                    className={`px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition ${
                      lockStatus.isLocked ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    title="Kosongkan seluruh skor hasil fase grup tanpa menghapus jadwal"
                    id="btn-reset-all-results"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-amber-600" /> Reset Seluruh Hasil
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowResetScheduleModal(true)}
                    disabled={lockStatus.isLocked}
                    className={`px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition ${
                      lockStatus.isLocked ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    title="Hapus seluruh jadwal dan hasil fase grup"
                    id="btn-reset-schedule"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" /> Reset Jadwal & Hasil
                  </button>
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-150" id="rr-filters">
              <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
                <Sliders className="h-3.5 w-3.5 text-slate-400" />
                <span>Filter Match:</span>
              </div>
              <div className="flex gap-2">
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

            <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1" id="rr-matches-list">
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 bg-navy text-neon text-[10px] font-black rounded">
                          #{match.matchNum || 1}
                        </span>
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
                        {match.notes && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-rose-50 text-rose-700 border border-rose-200" title={match.notes}>
                            {match.notes}
                          </span>
                        )}
                      </div>
                      
                      {/* Match matchup */}
                      <div className="flex items-center gap-3 text-sm pt-1" id={`matchup-text-${match.id}`}>
                        <span className={`font-bold ${match.winnerId === match.entryId1 ? 'text-navy font-black underline decoration-emerald-500 decoration-2' : 'text-slate-600'}`}>
                          {label1}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">vs</span>
                        <span className={`font-bold ${match.winnerId === match.entryId2 ? 'text-navy font-black underline decoration-emerald-500 decoration-2' : 'text-slate-600'}`}>
                          {label2}
                        </span>
                      </div>
                    </div>

                    {/* Scores or Action Buttons */}
                    <div className="flex items-center gap-3 justify-end shrink-0" id={`match-actions-${match.id}`}>
                      {isPlayed ? (
                        <div className="flex items-center gap-3">
                          <div className="bg-slate-50 border border-slate-150 rounded-lg px-3 py-1 text-sm font-bold font-mono tracking-wider flex items-center gap-1.5 text-slate-700">
                            <span>{match.score1 ?? '-'}</span>
                            <span className="text-slate-400">-</span>
                            <span>{match.score2 ?? '-'}</span>
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openScoringModal(match)}
                                disabled={lockStatus.isLocked}
                                className={`p-1.5 text-slate-500 hover:text-navy rounded transition bg-slate-50 border border-slate-200 ${
                                  lockStatus.isLocked ? 'opacity-40 cursor-not-allowed' : ''
                                }`}
                                title="Edit Skor Pertandingan"
                                id={`edit-score-button-${match.id}`}
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => openCorrectionModal(match)}
                                disabled={lockStatus.isLocked}
                                className={`p-1.5 text-rose-600 hover:text-rose-800 rounded transition bg-rose-50 border border-rose-200 ${
                                  lockStatus.isLocked ? 'opacity-40 cursor-not-allowed' : ''
                                }`}
                                title="Koreksi Admin / Force Majeure"
                                id={`correction-button-${match.id}`}
                              >
                                <ShieldAlert className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => openResetSingleMatchModal(match)}
                                disabled={lockStatus.isLocked}
                                className={`p-1.5 text-slate-400 hover:text-rose-500 rounded transition bg-slate-50 border border-slate-200 ${
                                  lockStatus.isLocked ? 'opacity-40 cursor-not-allowed' : ''
                                }`}
                                title="Reset Hasil Pertandingan Ini"
                                id={`reset-score-button-${match.id}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        isAdmin ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openScoringModal(match)}
                              disabled={lockStatus.isLocked}
                              className={`px-3.5 py-1.5 bg-neon/15 hover:bg-navy text-navy hover:text-neon rounded-lg border border-neon/30 hover:border-navy text-xs font-extrabold transition card-shadow ${
                                lockStatus.isLocked ? 'opacity-40 cursor-not-allowed' : ''
                              }`}
                              id={`score-match-button-${match.id}`}
                            >
                              Input Skor
                            </button>
                            <button
                              onClick={() => openCorrectionModal(match)}
                              disabled={lockStatus.isLocked}
                              className={`p-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition ${
                                lockStatus.isLocked ? 'opacity-40 cursor-not-allowed' : ''
                              }`}
                              title="Tandai Walkover (WO) / Force Majeure"
                              id={`wo-button-${match.id}`}
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                            </button>
                          </div>
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
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-md w-full p-6 space-y-5" id="scoring-modal-content">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h4 className="font-extrabold text-navy text-base">Input Hasil Pertandingan</h4>
              <button onClick={closeScoringModal} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveScore} className="space-y-5">
              
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
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-150">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-navy font-extrabold mb-0.5">Peserta 1</div>
                      <div className="font-extrabold text-slate-800 text-xs truncate">{getEntryLabel(scoringMatch.entryId1)}</div>
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

                  <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-150">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-navy font-extrabold mb-0.5">Peserta 2</div>
                      <div className="font-extrabold text-slate-800 text-xs truncate">{getEntryLabel(scoringMatch.entryId2)}</div>
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
                <div className="space-y-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                  <div className="flex items-center gap-1.5 text-amber-900 font-extrabold">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    Pilih Pemenang Walkover (WO), Skor & Alasan
                  </div>
                  <p className="text-amber-800 leading-relaxed text-[11px]">
                    Status Walkover (WO) disimpan bersama pemenang, skor manual (contoh: 11–0, 15–0, 21–0), dan alasan WO wajib. Skor pemenang WO harus lebih besar dari lawan.
                  </p>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-700 block">Pemenang Walkover <span className="text-rose-500">*</span></label>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => handleSelectWoWinner(scoringMatch.entryId1 || '')}
                        className={`w-full p-2.5 rounded-lg border text-left font-extrabold text-xs transition flex items-center justify-between ${
                          walkoverWinner === scoringMatch.entryId1
                            ? 'bg-navy text-neon border-navy card-shadow'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">{getEntryLabel(scoringMatch.entryId1)} (Menang WO)</span>
                        {walkoverWinner === scoringMatch.entryId1 && <Check className="h-4 w-4 shrink-0" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectWoWinner(scoringMatch.entryId2 || '')}
                        className={`w-full p-2.5 rounded-lg border text-left font-extrabold text-xs transition flex items-center justify-between ${
                          walkoverWinner === scoringMatch.entryId2
                            ? 'bg-navy text-neon border-navy card-shadow'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">{getEntryLabel(scoringMatch.entryId2)} (Menang WO)</span>
                        {walkoverWinner === scoringMatch.entryId2 && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="font-bold text-slate-700 block text-[11px] truncate mb-1">
                        Skor {getEntryLabel(scoringMatch.entryId1)} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        required
                        min="0"
                        id="wo-score-1-input"
                        value={score1}
                        onChange={(e) => setScore1(e.target.value)}
                        placeholder="Skor WO"
                        className="w-full px-3 py-2 text-center text-base font-bold font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy/15"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block text-[11px] truncate mb-1">
                        Skor {getEntryLabel(scoringMatch.entryId2)} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        required
                        min="0"
                        id="wo-score-2-input"
                        value={score2}
                        onChange={(e) => setScore2(e.target.value)}
                        placeholder="Skor WO"
                        className="w-full px-3 py-2 text-center text-base font-bold font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy/15"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 pt-1">
                    <label className="font-bold text-slate-700 block">Kategori Alasan WO <span className="text-rose-500">*</span></label>
                    <select
                      value={woReasonCategory}
                      onChange={(e) => setWoReasonCategory(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none"
                    >
                      <option value="cedera">Cedera Peserta</option>
                      <option value="mengundurkan_diri">Mengundurkan Diri Peserta</option>
                      <option value="diskualifikasi">Diskualifikasi oleh Panitia</option>
                      <option value="ketidakhadiran">Ketidakhadiran / Walkover (WO)</option>
                      <option value="gangguan_teknis">Gangguan Teknis Lapangan</option>
                      <option value="cuaca">Kondisi Cuaca</option>
                      <option value="keputusan_panitia">Keputusan Panitia / Force Majeure</option>
                      <option value="lainnya">Lainnya (Tulis alasan khusus)</option>
                    </select>
                  </div>

                  {woReasonCategory === 'lainnya' && (
                    <div className="space-y-1">
                      <label className="font-bold text-slate-700 block">Rincian Alasan WO <span className="text-rose-500">*</span></label>
                      <input
                        type="text"
                        value={woCustomReason}
                        onChange={(e) => setWoCustomReason(e.target.value)}
                        placeholder="Tuliskan rincian alasan..."
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                  )}
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

      {/* ADMIN CORRECTION / FORCE MAJEURE MODAL */}
      {correctionMatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="correction-modal">
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-scale-up" id="correction-modal-card">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-rose-600" />
                <h3 className="text-base font-extrabold text-slate-900">Koreksi Admin / Force Majeure</h3>
              </div>
              <button
                type="button"
                onClick={() => setCorrectionMatch(null)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Pertandingan Terdampak</span>
                <p className="font-extrabold text-slate-900 text-sm">
                  {getEntryLabel(correctionMatch.entryId1)} vs {getEntryLabel(correctionMatch.entryId2)} ({correctionMatch.groupName})
                </p>
                <p className="text-[11px] text-slate-600">
                  Status Saat Ini: <strong className="uppercase text-navy">{correctionMatch.status}</strong> | Skor: <strong>{correctionMatch.score1 ?? '-'} - {correctionMatch.score2 ?? '-'}</strong>
                </p>
              </div>

              {/* Action Type */}
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">Tindakan Koreksi <span className="text-rose-500">*</span></label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setKorActionType('update_score')}
                    className={`py-2 px-2 text-[11px] font-extrabold rounded-xl border transition ${
                      korActionType === 'update_score'
                        ? 'bg-navy text-neon border-navy card-shadow'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Edit Skor & Hasil
                  </button>
                  <button
                    type="button"
                    onClick={() => setKorActionType('mark_walkover')}
                    className={`py-2 px-2 text-[11px] font-extrabold rounded-xl border transition ${
                      korActionType === 'mark_walkover'
                        ? 'bg-amber-600 text-white border-amber-600 card-shadow'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Tandai Walkover
                  </button>
                  <button
                    type="button"
                    onClick={() => setKorActionType('reset_match')}
                    className={`py-2 px-2 text-[11px] font-extrabold rounded-xl border transition ${
                      korActionType === 'reset_match'
                        ? 'bg-rose-600 text-white border-rose-600 card-shadow'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Reset Hasil Match
                  </button>
                </div>
              </div>

              {/* Category Reason */}
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">Kategori Alasan Koreksi <span className="text-rose-500">*</span></label>
                <select
                  value={korReasonCategory}
                  onChange={(e) => setKorReasonCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="cedera">Cedera / Mengundurkan Diri Peserta</option>
                  <option value="diskualifikasi">Diskualifikasi Peserta oleh Panitia</option>
                  <option value="ketidakhadiran">Ketidakhadiran / Walkover (WO)</option>
                  <option value="cuaca_teknis">Gangguan Teknis / Kondisi Cuaca</option>
                  <option value="keputusan_panitia">Keputusan Panitia / Force Majeure</option>
                  <option value="lainnya">Lainnya (Tulis alasan khusus)</option>
                </select>
              </div>

              {korReasonCategory === 'lainnya' && (
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700 block">Detail Alasan Khusus <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    value={korCustomReason}
                    onChange={(e) => setKorCustomReason(e.target.value)}
                    placeholder="Tuliskan alasan khusus koreksi..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              )}

              {/* Inputs depending on action type */}
              {korActionType === 'update_score' && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block truncate">{getEntryLabel(correctionMatch.entryId1)}</label>
                    <input
                      type="number"
                      min="0"
                      value={korScore1}
                      onChange={(e) => setKorScore1(e.target.value)}
                      placeholder="Skor Baru 1"
                      className="w-full mt-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-bold font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block truncate">{getEntryLabel(correctionMatch.entryId2)}</label>
                    <input
                      type="number"
                      min="0"
                      value={korScore2}
                      onChange={(e) => setKorScore2(e.target.value)}
                      placeholder="Skor Baru 2"
                      className="w-full mt-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-bold font-mono"
                    />
                  </div>
                </div>
              )}

              {korActionType === 'mark_walkover' && (
                <div className="space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs">
                  <div>
                    <label className="font-bold text-amber-900 block mb-1">Pilih Pemenang WO <span className="text-rose-500">*</span></label>
                    <select
                      value={korWinnerId}
                      onChange={(e) => {
                        const newW = e.target.value;
                        setKorWinnerId(newW);
                        if (settings.targetScore) {
                          if (newW === correctionMatch.entryId1 && Number(korScore1) <= Number(korScore2)) {
                            setKorScore1(settings.targetScore);
                            setKorScore2(0);
                          } else if (newW === correctionMatch.entryId2 && Number(korScore2) <= Number(korScore1)) {
                            setKorScore1(0);
                            setKorScore2(settings.targetScore);
                          }
                        }
                      }}
                      className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl font-bold text-amber-900 focus:outline-none"
                    >
                      <option value={correctionMatch.entryId1 || ''}>{getEntryLabel(correctionMatch.entryId1)} (Menang WO)</option>
                      <option value={correctionMatch.entryId2 || ''}>{getEntryLabel(correctionMatch.entryId2)} (Menang WO)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="text-[10px] font-bold text-amber-900 block truncate">{getEntryLabel(correctionMatch.entryId1)}</label>
                      <input
                        type="number"
                        min="0"
                        value={korScore1}
                        onChange={(e) => setKorScore1(e.target.value)}
                        placeholder="Skor WO 1"
                        className="w-full mt-1 px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-sm font-bold font-mono focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-amber-900 block truncate">{getEntryLabel(correctionMatch.entryId2)}</label>
                      <input
                        type="number"
                        min="0"
                        value={korScore2}
                        onChange={(e) => setKorScore2(e.target.value)}
                        placeholder="Skor WO 2"
                        className="w-full mt-1 px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-sm font-bold font-mono focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-slate-400 italic">
                Catatan Sesi: Alasan disimpan sebagai catatan koreksi sementara pada sesi aplikasi dan akan memperbarui state pertandingan tanpa mengubah schema database Supabase.
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setCorrectionMatch(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeAdminCorrection}
                className="px-4 py-2 text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white border border-rose-700 rounded-xl shadow-xs transition"
              >
                Konfirmasi Koreksi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SINGLE MATCH RESET MODAL */}
      {resetSingleMatchItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <h3 className="text-base font-extrabold text-slate-900">Reset Hasil Pertandingan Ini</h3>
              <button onClick={() => setResetSingleMatchItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="font-extrabold text-slate-900">
                  {getEntryLabel(resetSingleMatchItem.entryId1)} vs {getEntryLabel(resetSingleMatchItem.entryId2)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Skor saat ini: <strong>{resetSingleMatchItem.score1 ?? '-'} - {resetSingleMatchItem.score2 ?? '-'}</strong> ({resetSingleMatchItem.status})
                </p>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">Kategori Alasan Reset <span className="text-rose-500">*</span></label>
                <select
                  value={resetSingleReasonCategory}
                  onChange={(e) => setResetSingleReasonCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="kesalahan_input">Kesalahan Input Skor</option>
                  <option value="diskualifikasi">Diskualifikasi / Keputusan Panitia</option>
                  <option value="perubahan_jadwal">Penjadwalan Ulang Match</option>
                  <option value="keputusan_panitia">Keputusan Panitia / Force Majeure</option>
                  <option value="lainnya">Lainnya (Tulis alasan khusus)</option>
                </select>
              </div>

              {resetSingleReasonCategory === 'lainnya' && (
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 block">Rincian Alasan Khusus <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    value={resetSingleCustomReason}
                    onChange={(e) => setResetSingleCustomReason(e.target.value)}
                    placeholder="Tuliskan alasan reset..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Aksi ini akan mengosongkan skor dan pemenang pertandingan ini. Item pertandingan tetap ada dalam jadwal fase grup.
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setResetSingleMatchItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeResetSingleMatch}
                className="px-4 py-2 text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white rounded-xl"
              >
                Konfirmasi Reset Match
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESET ALL GROUP RESULTS MODAL */}
      {showResetAllResultsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <div className="flex items-center gap-2 text-amber-700">
                <RotateCcw className="h-5 w-5" />
                <h3 className="text-base font-extrabold text-slate-900">Reset Seluruh Hasil Fase Grup</h3>
              </div>
              <button onClick={() => setShowResetAllResultsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">Kategori Alasan Reset Hasil <span className="text-rose-500">*</span></label>
                <select
                  value={resetAllResultsCategory}
                  onChange={(e) => setResetAllResultsCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="koreksi_total">Koreksi Total Hasil Fase Grup</option>
                  <option value="perubahan_skema">Perubahan Skema Turnamen / Force Majeure</option>
                  <option value="gangguan_teknis">Gangguan Sistem / Hasil Tidak Valid</option>
                  <option value="keputusan_panitia">Keputusan Panitia</option>
                  <option value="lainnya">Lainnya (Tulis alasan khusus)</option>
                </select>
              </div>

              {resetAllResultsCategory === 'lainnya' && (
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700 block">Detail Alasan Khusus <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    value={resetAllResultsCustomReason}
                    onChange={(e) => setResetAllResultsCustomReason(e.target.value)}
                    placeholder="Tuliskan alasan spesifik reset seluruh hasil..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              )}

              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5 text-amber-900">
                <h4 className="font-extrabold flex items-center gap-1.5 text-xs">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" /> Dampak Reset Seluruh Hasil
                </h4>
                <ul className="list-disc list-inside text-[11px] space-y-1 text-amber-800">
                  <li>Seluruh skor dari <strong>{roundRobinMatches.length} pertandingan fase grup</strong> akan dikosongkan.</li>
                  <li>Status seluruh pertandingan kembali menjadi <strong>'belum_dimainkan'</strong>.</li>
                  <li>Jadwal pertandingan dan susunan grup <strong>TETAP DIPERTAHANKAN</strong>.</li>
                </ul>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowResetAllResultsModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeResetAllResults}
                className="px-4 py-2 text-xs font-extrabold bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
              >
                Konfirmasi Reset Seluruh Hasil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESET SCHEDULE AND ALL RESULTS MODAL */}
      {showResetScheduleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <div className="flex items-center gap-2 text-rose-700">
                <Trash2 className="h-5 w-5" />
                <h3 className="text-base font-extrabold text-slate-900">Reset Jadwal & Seluruh Hasil Fase Grup</h3>
              </div>
              <button onClick={() => setShowResetScheduleModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">Kategori Alasan Reset Jadwal <span className="text-rose-500">*</span></label>
                <select
                  value={resetScheduleCategory}
                  onChange={(e) => setResetScheduleCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="perubahan_grup">Perubahan Susunan Grup / Peserta</option>
                  <option value="generate_ulang">Permintaan Generate Ulang Jadwal</option>
                  <option value="keputusan_panitia">Keputusan Panitia / Force Majeure</option>
                  <option value="lainnya">Lainnya (Tulis alasan khusus)</option>
                </select>
              </div>

              {resetScheduleCategory === 'lainnya' && (
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700 block">Detail Alasan Khusus <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    value={resetScheduleCustomReason}
                    onChange={(e) => setResetScheduleCustomReason(e.target.value)}
                    placeholder="Tuliskan alasan spesifik reset jadwal..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              )}

              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-1.5 text-rose-900">
                <h4 className="font-extrabold flex items-center gap-1.5 text-xs">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" /> Dampak Reset Jadwal & Hasil
                </h4>
                <ul className="list-disc list-inside text-[11px] space-y-1 text-rose-800">
                  <li>Seluruh jadwal <strong>({roundRobinMatches.length} pertandingan)</strong> dan skor terinput akan DIHAPUS PERMANEN dari divisi ini.</li>
                  <li>Peserta dan susunan grup <strong>TETAP DIPERTAHANKAN</strong>.</li>
                  <li>Jadwal baru dapat di-generate ulang kapan saja.</li>
                </ul>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowResetScheduleModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeResetScheduleAndResults}
                className="px-4 py-2 text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white rounded-xl"
              >
                Konfirmasi Reset Jadwal & Hasil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INTEGRITY MODAL */}
      {showIntegrityModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-150 shadow-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-150">
              <div className="flex items-center gap-2 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="text-base font-extrabold text-slate-900">Rincian Integritas Jadwal & Hasil</h3>
              </div>
              <button onClick={() => setShowIntegrityModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
              {anomalies.warnings.map((warn, idx) => (
                <div key={idx} className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{warn}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowIntegrityModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl"
              >
                Tutup
              </button>
              {isAdmin && !lockStatus.isLocked && (
                <button
                  type="button"
                  onClick={() => {
                    setShowIntegrityModal(false);
                    handleFixMatchIntegrity();
                  }}
                  className="px-4 py-2 text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white rounded-xl"
                >
                  Koreksi Otomatis
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GENERAL CONFIRM MODAL */}
      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="custom-confirm-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl space-y-4 animate-scale-up" id="custom-confirm-card">
            <h3 className="text-base font-extrabold text-navy">{showConfirm.title}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{showConfirm.message}</p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowConfirm(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={showConfirm.onConfirm}
                className="px-4 py-2 text-xs font-extrabold bg-navy hover:bg-navy-light text-neon rounded-xl card-shadow"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GENERAL ALERT MODAL */}
      {showAlert && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="custom-alert-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl space-y-4 animate-scale-up" id="custom-alert-card">
            <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              {showAlert.title}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">{showAlert.message}</p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAlert(null)}
                className="px-5 py-2 text-xs font-extrabold bg-navy hover:bg-navy-light text-neon rounded-xl card-shadow"
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
