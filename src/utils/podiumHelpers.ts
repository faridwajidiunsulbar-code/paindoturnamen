/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Match,
  Entry,
  ThirdPlaceMode,
  Division,
  PodiumEntry,
  DivisionPodiumPreview,
  OfficialPodium
} from '../types';

/**
 * Pure function to derive podium entries for a division based on knockout matches and thirdPlaceMode.
 */
export function deriveDivisionPodium(
  knockoutMatches: Match[] = [],
  thirdPlaceMode: ThirdPlaceMode = 'playoff',
  entries: Entry[] = []
): DivisionPodiumPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const podiumEntries: PodiumEntry[] = [];

  if (!knockoutMatches || knockoutMatches.length === 0) {
    return {
      valid: false,
      entries: [],
      errors: ['Pertandingan fase gugur belum dibentuk.'],
      warnings: [],
      generatedAt: new Date().toISOString()
    };
  }

  // 1. Identify Final Match
  const finalMatch = knockoutMatches.find(
    m => m.roundName === 'Final' || (!m.nextMatchNum && !m.isBronzeMatch && m.roundName !== 'Perebutan Juara 3')
  );

  if (!finalMatch) {
    errors.push('Pertandingan Final tidak ditemukan.');
  } else if (finalMatch.status !== 'selesai' && finalMatch.status !== 'walkover') {
    errors.push('Pertandingan Final belum selesai.');
  } else if (!finalMatch.winnerId) {
    errors.push('Pemenang pertandingan Final belum ditentukan.');
  } else {
    const e1 = finalMatch.entryId1;
    const e2 = finalMatch.entryId2;
    const actualWinnerId = finalMatch.winnerId;
    const actualLoserId = finalMatch.loserId;

    if (!e1 || !e2 || e1 === e2) {
      errors.push('Peserta pertandingan Final tidak valid.');
    } else if (actualWinnerId !== e1 && actualWinnerId !== e2) {
      errors.push('Pemenang Final bukan salah satu peserta Final.');
    } else {
      // Final Winner -> Placement 1
      podiumEntries.push({
        placement: 1,
        entryId: actualWinnerId,
        label: 'Juara',
        sourceType: 'final_winner',
        sourceMatchId: finalMatch.id,
        isShared: false
      });

      // Compute candidate Runner-up as the Final participant besides the winner
      const expectedCandidateLoserId = actualWinnerId === e1 ? e2 : e1;
      let effectiveLoserId = actualLoserId;

      if (!actualLoserId || (actualLoserId !== e1 && actualLoserId !== e2) || actualLoserId === actualWinnerId) {
        effectiveLoserId = expectedCandidateLoserId;

        const candidateEntry = entries.find(e => e.id === expectedCandidateLoserId);
        const candidateName = candidateEntry
          ? `${candidateEntry.name1}${candidateEntry.name2 ? ` / ${candidateEntry.name2}` : ''}`
          : expectedCandidateLoserId;

        warnings.push(
          `Data pihak kalah Final tidak konsisten. Runner-up seharusnya ${candidateName}.`
        );
      }

      // Final Loser -> Placement 2
      podiumEntries.push({
        placement: 2,
        entryId: effectiveLoserId,
        label: 'Runner-up',
        sourceType: 'final_loser',
        sourceMatchId: finalMatch.id,
        isShared: false
      });
    }
  }

  // 2. Identify 3rd/4th place based on thirdPlaceMode
  if (thirdPlaceMode === 'shared_bronze') {
    const sfMatches = knockoutMatches.filter(m => m.roundName === 'Semifinal');
    if (sfMatches.length < 2) {
      errors.push('Pertandingan Semifinal (2 pertandingan) tidak ditemukan.');
    } else {
      const sf1 = sfMatches[0];
      const sf2 = sfMatches[1];

      const isSf1Complete = (sf1.status === 'selesai' || sf1.status === 'walkover') && !!sf1.loserId;
      const isSf2Complete = (sf2.status === 'selesai' || sf2.status === 'walkover') && !!sf2.loserId;

      if (!isSf1Complete || !isSf2Complete) {
        errors.push('Pertandingan Semifinal belum selesai sehingga Juara 3 Bersama belum dapat ditentukan.');
      } else {
        const sf1LoserId = sf1.loserId!;
        const sf2LoserId = sf2.loserId!;

        if (sf1LoserId === sf2LoserId) {
          errors.push('Loser dari kedua Semifinal adalah peserta yang sama.');
        } else {
          podiumEntries.push({
            placement: 3,
            entryId: sf1LoserId,
            label: 'Juara 3 Bersama',
            sourceType: 'semifinal_loser',
            sourceMatchId: sf1.id,
            isShared: true
          });

          podiumEntries.push({
            placement: 3,
            entryId: sf2LoserId,
            label: 'Juara 3 Bersama',
            sourceType: 'semifinal_loser',
            sourceMatchId: sf2.id,
            isShared: true
          });
        }
      }
    }
  } else if (thirdPlaceMode === 'playoff') {
    const bronzeMatch = knockoutMatches.find(m => m.isBronzeMatch || m.roundName === 'Perebutan Juara 3');
    if (!bronzeMatch) {
      errors.push('Pertandingan Perebutan Juara 3 (Playoff) tidak ditemukan.');
    } else if (bronzeMatch.status !== 'selesai' && bronzeMatch.status !== 'walkover') {
      errors.push('Pertandingan Perebutan Juara 3 belum selesai.');
    } else if (!bronzeMatch.winnerId || !bronzeMatch.loserId) {
      errors.push('Pemenang atau tim kalah Pertandingan Perebutan Juara 3 belum ditentukan.');
    } else {
      podiumEntries.push({
        placement: 3,
        entryId: bronzeMatch.winnerId,
        label: 'Juara 3',
        sourceType: 'third_place_winner',
        sourceMatchId: bronzeMatch.id,
        isShared: false
      });

      podiumEntries.push({
        placement: 4,
        entryId: bronzeMatch.loserId,
        label: 'Peringkat 4',
        sourceType: 'third_place_loser',
        sourceMatchId: bronzeMatch.id,
        isShared: false
      });
    }
  } else if (thirdPlaceMode === 'none') {
    // No 3rd or 4th place rows added
  }

  // 3. Duplicate check across podium positions
  const seenEntryIds = new Set<string>();
  for (const entry of podiumEntries) {
    if (seenEntryIds.has(entry.entryId)) {
      errors.push(`Peserta ganda terdeteksi pada posisi podium: "${entry.entryId}".`);
    } else {
      seenEntryIds.add(entry.entryId);
    }
  }

  return {
    valid: errors.length === 0,
    entries: podiumEntries,
    errors,
    warnings,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Validates division completion readiness and revocation capability.
 */
export function validateDivisionCompletion(
  division: Division,
  knockoutMatches: Match[] = [],
  podiumPreview: DivisionPodiumPreview,
  officialPodium?: OfficialPodium | null
): { canFinalize: boolean; canRevoke: boolean; blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Check group stage completion if groups exist
  if (division.groups && division.groups.length > 0) {
    const rrMatches = division.roundRobinMatches || [];
    const unplayedRR = rrMatches.filter(m => m.status === 'belum_dimainkan');
    if (unplayedRR.length > 0) {
      warnings.push(`Terdapat ${unplayedRR.length} pertandingan fase grup yang belum dimainkan.`);
    }
  }

  // Check bracket lock status
  if (!division.knockoutStage?.isLocked) {
    blockers.push('Bagan fase gugur belum dikunci (bracket unlocked).');
  }

  // Check podium preview validity
  if (!podiumPreview.valid) {
    blockers.push(...podiumPreview.errors);
  }

  // Check if official podium exists and matches current matches
  if (officialPodium) {
    const currentMode: ThirdPlaceMode = division.settings?.thirdPlaceMode || (division.settings?.thirdPlaceEnabled === false ? 'none' : 'playoff');
    const integrityCheck = validateOfficialPodiumAgainstMatches(officialPodium, knockoutMatches, currentMode);
    if (!integrityCheck.valid) {
      warnings.push(...integrityCheck.warnings);
    }
  }

  const canFinalize = !division.podiumOfficial && blockers.length === 0;
  const canRevoke = !!division.podiumOfficial;

  return {
    canFinalize,
    canRevoke,
    blockers,
    warnings
  };
}

/**
 * Validates saved official podium entries against current match results.
 */
export function validateOfficialPodiumAgainstMatches(
  officialPodium: OfficialPodium,
  knockoutMatches: Match[],
  thirdPlaceMode: ThirdPlaceMode
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const derived = deriveDivisionPodium(knockoutMatches, thirdPlaceMode);

  if (!derived.valid) {
    warnings.push('Hasil pertandingan fase gugur saat ini tidak lengkap untuk memverifikasi podium resmi.');
    return { valid: false, warnings };
  }

  if (officialPodium.entries.length !== derived.entries.length) {
    warnings.push(
      `Jumlah posisi podium resmi (${officialPodium.entries.length}) tidak sesuai dengan derivasi pertandingan (${derived.entries.length}).`
    );
    return { valid: false, warnings };
  }

  for (let i = 0; i < derived.entries.length; i++) {
    const derivedItem = derived.entries[i];
    const officialItem = officialPodium.entries.find(e => e.placement === derivedItem.placement && e.entryId === derivedItem.entryId);

    if (!officialItem) {
      warnings.push(
        `Ketidaksesuaian podium resmi untuk posisi ${derivedItem.label} (Placement ${derivedItem.placement}): peserta "${derivedItem.entryId}".`
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}
