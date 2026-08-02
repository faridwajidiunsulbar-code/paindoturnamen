import { Tournament, Division, Match, OfficialPodium, Champions, ThirdPlaceMode } from '../types';

export interface DivisionClosureSummary {
  divisionId: string;
  divisionName: string;
  active: boolean;
  groupStageComplete: boolean;
  bracketValid: boolean;
  finalComplete: boolean;
  podiumOfficial: boolean;
  divisionCompleted: boolean;
  blockers: string[];
}

export interface TournamentClosureReadiness {
  canClose: boolean;
  blockers: string[];
  warnings: string[];
  divisionSummaries: DivisionClosureSummary[];
}

export interface TournamentIntegrityCheck {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
  * Global Read-Only Helper
  * Returns true if tournament is officially closed or archived
  */
export function isTournamentReadOnly(tournament: Tournament | null | undefined): boolean {
  if (!tournament) return false;
  return tournament.isClosed === true || tournament.status === 'closed';
}

/**
  * Validate readiness for official tournament closure (PAINDO-011)
  */
export function validateTournamentClosureReadiness(
  tournament: Tournament
): TournamentClosureReadiness {
  const globalBlockers: string[] = [];
  const globalWarnings: string[] = [];
  const divisionSummaries: DivisionClosureSummary[] = [];

  if (!tournament) {
    return {
      canClose: false,
      blockers: ['Data turnamen tidak ditemukan.'],
      warnings: [],
      divisionSummaries: []
    };
  }

  if (isTournamentReadOnly(tournament)) {
    globalBlockers.push('Turnamen sudah ditutup sebelumnya.');
  }

  if (tournament.cloudSaveStatus === 'failed') {
    globalBlockers.push('Terdapat status penyimpanan cloud yang gagal (cloudSaveStatus: failed). Selesaikan penyinkronkan data terlebih dahulu.');
  }

  if (tournament.cloudSaveStatus === 'saving') {
    globalBlockers.push('Proses penyimpanan cloud sedang berlangsung.');
  }

  const activeDivs = (tournament.activeDivisions || []);

  if (activeDivs.length === 0) {
    globalBlockers.push('Turnamen tidak memiliki divisi aktif.');
  }

  for (const div of activeDivs) {
    const divBlockers: string[] = [];
    const divName = `${div.eventName || 'Divisi'} ${div.ageGroupName || ''}`.trim();

    // 1. Group Stage Check
    const rrMatches = div.roundRobinMatches || [];
    const unplayedRR = rrMatches.filter(m => m.status === 'belum_dimainkan').length;
    const groupStageComplete = div.groups.length === 0 || unplayedRR === 0;
    if (!groupStageComplete) {
      divBlockers.push(`Masih ada ${unplayedRR} pertandingan fase grup yang belum dimainkan.`);
    }

    // 2. Bracket Check
    const koStage = div.knockoutStage;
    const bracketValid = !!koStage && (koStage.isLocked || koStage.arrangementLocked) && !koStage.arrangementInvalidatedReason && !koStage.invalidatedReason;
    if (!koStage) {
      divBlockers.push('Babak gugur belum dibuat.');
    } else if (!koStage.isLocked && !koStage.arrangementLocked) {
      divBlockers.push('Bagan babak gugur belum dikunci.');
    } else if (koStage.arrangementInvalidatedReason || koStage.invalidatedReason) {
      divBlockers.push(`Bagan gugur tidak valid: ${koStage.arrangementInvalidatedReason || koStage.invalidatedReason}`);
    }

    // 3. Mandatory Matches & Final Check
    let finalComplete = false;
    if (koStage && koStage.matches.length > 0) {
      const finalMatch = koStage.matches.find(m => m.roundName === 'Final' || (!m.nextMatchNum && !m.isBronzeMatch));
      if (finalMatch) {
        finalComplete = (finalMatch.status === 'selesai' || finalMatch.status === 'walkover') && !!finalMatch.winnerId;
      }
      
      const unplayedKO = koStage.matches.filter(m => {
        // Ignore optional third place matches if mode is shared_bronze or none
        const thirdPlaceMode: ThirdPlaceMode = div.settings.thirdPlaceMode || (div.settings.thirdPlaceEnabled === false ? 'none' : 'playoff');
        if (m.isBronzeMatch && (thirdPlaceMode === 'shared_bronze' || thirdPlaceMode === 'none')) {
          return false;
        }
        // Ignore matches where entries are BYE / not required
        if (!m.entryId1 && !m.entryId2 && m.status === 'belum_dimainkan') {
          return false;
        }
        return m.status === 'belum_dimainkan';
      });

      if (unplayedKO.length > 0) {
        divBlockers.push(`Masih ada ${unplayedKO.length} pertandingan babak gugur wajib yang belum selesai.`);
      }

      if (!finalComplete) {
        divBlockers.push('Pertandingan Final belum selesai atau pemenang belum ditetapkan.');
      }
    } else {
      divBlockers.push('Pertandingan babak gugur belum tersedia.');
    }

    // 4. Check Walkover matches without notes
    const woMatches = [...rrMatches, ...(koStage?.matches || [])].filter(m => m.status === 'walkover');
    for (const wo of woMatches) {
      if (!wo.notes?.trim()) {
        divBlockers.push(`Pertandingan WO (${wo.groupName || wo.roundName || 'Match'}) belum dilengkapi catatan alasan WO.`);
        break;
      }
    }

    // 5. Podium Official Check
    const podiumOfficial = !!div.podiumOfficial && !!div.officialPodium;
    if (!podiumOfficial) {
      divBlockers.push('Hasil divisi dan podium belum disahkan secara resmi (podiumOfficial = false).');
    }

    // 6. Division Completed Status Check
    const divisionCompleted = div.status === 'completed' || div.status === 'finalized';
    if (!divisionCompleted && podiumOfficial) {
      divBlockers.push('Status divisi belum dalam kondisi SELESAI (completed).');
    }

    if (divBlockers.length > 0) {
      globalBlockers.push(`Divisi "${divName}": ${divBlockers.join(' ')}`);
    }

    divisionSummaries.push({
      divisionId: div.id,
      divisionName: divName,
      active: true,
      groupStageComplete,
      bracketValid,
      finalComplete,
      podiumOfficial,
      divisionCompleted,
      blockers: divBlockers
    });
  }

  const canClose = globalBlockers.length === 0;

  return {
    canClose,
    blockers: globalBlockers,
    warnings: globalWarnings,
    divisionSummaries
  };
}

/**
  * Deep integrity validator for entire tournament closure (PAINDO-011)
  */
export function validateTournamentIntegrityForClosure(
  tournament: Tournament
): TournamentIntegrityCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!tournament) {
    return { valid: false, errors: ['Tournament null'], warnings: [] };
  }

  // Check unique division IDs
  const divIds = new Set<string>();
  for (const d of tournament.activeDivisions || []) {
    if (divIds.has(d.id)) {
      errors.push(`Duplikasi ID divisi terdeteksi: ${d.id}`);
    }
    divIds.add(d.id);

    if (!d.entries || d.entries.length === 0) {
      errors.push(`Divisi "${d.eventName}" tidak memiliki peserta.`);
    }

    if (!d.podiumOfficial || !d.officialPodium) {
      errors.push(`Divisi "${d.eventName}" belum mengesahkan podium resmi.`);
    }

    if (d.officialPodium) {
      const pEntries = d.officialPodium.entries || [];
      const placements = pEntries.map(e => e.placement);
      if (!placements.includes(1)) {
        errors.push(`Divisi "${d.eventName}" kehilangan Juara 1 (placement 1).`);
      }
      if (!placements.includes(2)) {
        errors.push(`Divisi "${d.eventName}" kehilangan Runner-up (placement 2).`);
      }

      const mode = d.settings.thirdPlaceMode || (d.settings.thirdPlaceEnabled === false ? 'none' : 'playoff');
      if (mode === 'shared_bronze') {
        const countP3 = pEntries.filter(e => e.placement === 3).length;
        if (countP3 !== 2) {
          errors.push(`Divisi "${d.eventName}" dengan mode Shared Bronze harus memiliki 2 pemenang Juara 3.`);
        }
      } else if (mode === 'playoff') {
        const hasP3 = pEntries.some(e => e.placement === 3);
        const hasP4 = pEntries.some(e => e.placement === 4);
        if (!hasP3 || !hasP4) {
          errors.push(`Divisi "${d.eventName}" dengan mode Playoff harus memiliki Peringkat 3 dan Peringkat 4.`);
        }
      } else if (mode === 'none') {
        const hasP34 = pEntries.some(e => e.placement === 3 || e.placement === 4);
        if (hasP34) {
          errors.push(`Divisi "${d.eventName}" dengan mode Tanpa Juara 3 tidak boleh memiliki Juara 3/4 di podium.`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
