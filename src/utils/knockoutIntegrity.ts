import { Match, KnockoutSlot, DivisionSettings, ThirdPlaceMode } from '../types';

export interface DownstreamImpact {
  directNextMatch?: Match;
  loserDestinationMatch?: Match;
  affectedMatches: Match[];
  hasScoredDownstream: boolean;
  reasons: string[];
}

export interface KnockoutIntegrityResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Detects downstream dependencies and whether any downstream match already has scores or results.
 */
export function getDownstreamImpact(matchId: string, matches: Match[]): DownstreamImpact {
  const affectedMatchesMap = new Map<string, Match>();
  const reasons: string[] = [];
  let hasScoredDownstream = false;

  const matchMap = new Map<string, Match>(matches.map(m => [m.id, m]));
  const currentMatch = matchMap.get(matchId);

  if (!currentMatch) {
    return { affectedMatches: [], hasScoredDownstream: false, reasons: ['Pertandingan tidak ditemukan.'] };
  }

  // Find direct next match (winner destination)
  let directNextMatch: Match | undefined = undefined;
  if (currentMatch.nextMatchNum) {
    directNextMatch = matches.find(m => m.matchNum === currentMatch.nextMatchNum);
  }

  // Find loser destination match (e.g., Bronze match for semifinals)
  let loserDestinationMatch: Match | undefined = undefined;
  if (currentMatch.roundName === 'Semifinal') {
    loserDestinationMatch = matches.find(m => m.isBronzeMatch || m.roundName === 'Perebutan Juara 3');
  }

  // Traverse downstream recursively starting from next match and loser destination
  const queue: Match[] = [];
  if (directNextMatch) queue.push(directNextMatch);
  if (loserDestinationMatch) queue.push(loserDestinationMatch);

  const visited = new Set<string>();

  while (queue.length > 0) {
    const target = queue.shift()!;
    if (visited.has(target.id)) continue;
    visited.add(target.id);
    affectedMatchesMap.set(target.id, target);

    // Check if downstream match already has completed score or walkover result
    if (target.status === 'selesai' || target.status === 'walkover') {
      hasScoredDownstream = true;
      reasons.push(
        `Pertandingan lanjutan "${target.roundName || 'Ronde'} #${target.matchNum || target.id}" sudah memiliki hasil (${target.status === 'walkover' ? 'WO' : `${target.score1}-${target.score2}`}).`
      );
    }

    // Add target's downstream match
    if (target.nextMatchNum) {
      const nextDown = matches.find(m => m.matchNum === target.nextMatchNum);
      if (nextDown && !visited.has(nextDown.id)) queue.push(nextDown);
    }
  }

  return {
    directNextMatch,
    loserDestinationMatch,
    affectedMatches: Array.from(affectedMatchesMap.values()),
    hasScoredDownstream,
    reasons
  };
}

/**
 * Validates knockout match tree integrity based on PAINDO-009 requirements (18 checks).
 */
export function validateKnockoutIntegrity(
  matches: Match[],
  slots: KnockoutSlot[],
  bracketSize: number,
  thirdPlaceMode: ThirdPlaceMode = 'playoff'
): KnockoutIntegrityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!matches || matches.length === 0) {
    errors.push('Pertandingan fase gugur belum dibentuk.');
    return { isValid: false, errors, warnings };
  }

  const matchMap = new Map<string, Match>();
  const seenMatchNums = new Set<number>();

  // Check 1: Duplicate Match ID & matchNum
  for (const m of matches) {
    if (matchMap.has(m.id)) {
      errors.push(`Match ID ganda terdeteksi: "${m.id}".`);
    } else {
      matchMap.set(m.id, m);
    }

    if (m.matchNum) {
      if (seenMatchNums.has(m.matchNum)) {
        errors.push(`Nomor pertandingan (${m.matchNum}) ganda terdeteksi.`);
      } else {
        seenMatchNums.add(m.matchNum);
      }
    }
  }

  // Check 2: Match count per round & Final variant detection
  const mainMatches = matches.filter(m => !m.isBronzeMatch && m.roundName !== 'Perebutan Juara 3');
  const expectedMainCount = bracketSize - 1;
  if (mainMatches.length !== expectedMainCount) {
    errors.push(`Jumlah pertandingan utama (${mainMatches.length}) tidak sesuai dengan ukuran bracket ${bracketSize} (seharusnya ${expectedMainCount}).`);
  }

  // Explicit Final verification
  const explicitFinalMatches = matches.filter(m => {
    const rName = (m.roundName || '').trim().toLowerCase();
    const stage = ((m as any).stage || '').trim().toLowerCase();
    const round = ((m as any).round || '').trim().toLowerCase();
    return !m.isBronzeMatch && (rName === 'final' || stage === 'final' || round === 'final');
  });

  if (explicitFinalMatches.length > 1) {
    errors.push(`Terdeteksi lebih dari satu pertandingan Final (${explicitFinalMatches.length}).`);
  } else if (explicitFinalMatches.length === 0) {
    const fallbackFinals = matches.filter(m => !m.nextMatchNum && !m.isBronzeMatch && (m.roundName || '').trim().toLowerCase() !== 'perebutan juara 3');
    if (fallbackFinals.length === 0) {
      errors.push('Tidak ada pertandingan Final yang terdeteksi pada bracket.');
    } else if (fallbackFinals.length > 1) {
      warnings.push(`Tidak ada pertandingan berketerangan Final eksplisit, dan terdapat ${fallbackFinals.length} pertandingan terminal.`);
    }
  }

  // Check orphan terminal matches (matches without nextMatchNum that are not valid Final)
  const orphanTerminalMatches = matches.filter(m => {
    if (m.nextMatchNum || m.isBronzeMatch || (m.roundName || '').trim().toLowerCase() === 'perebutan juara 3') return false;
    const rName = (m.roundName || '').trim().toLowerCase();
    const isExplicitFinal = rName === 'final' || ((m as any).stage || '').trim().toLowerCase() === 'final';
    if (isExplicitFinal) return false;

    const feeders = matches.filter(fm => fm.nextMatchNum === m.matchNum);
    const isFedBySF = feeders.filter(fm => (fm.roundName || '').trim().toLowerCase() === 'semifinal').length === 2;
    const isCanonical = m.matchNum === 3 || m.matchNum === 7 || m.matchNum === 15 || m.matchNum === 31;
    return !isFedBySF && !isCanonical;
  });

  for (const orphan of orphanTerminalMatches) {
    warnings.push(`Pertandingan #${orphan.matchNum} (${orphan.roundName || 'Lainnya'}) tidak memiliki nextMatchNum tetapi bukan Final sah (match orphan).`);
  }

  const bronzeMatch = matches.find(m => m.isBronzeMatch || m.roundName === 'Perebutan Juara 3');
  if (thirdPlaceMode === 'playoff') {
    if (!bronzeMatch && bracketSize >= 4) {
      warnings.push('Pertandingan perebutan juara 3 diaktifkan (playoff) namun belum dibuat dalam tree.');
    }
  } else if (thirdPlaceMode === 'shared_bronze' || thirdPlaceMode === 'none') {
    if (bronzeMatch && (bronzeMatch.status === 'selesai' || bronzeMatch.status === 'walkover')) {
      errors.push('Pertandingan perebutan juara 3 memiliki skor padahal mode juara 3 bukan playoff.');
    }
  }

  // Check 3: Check duplicate entries in same round
  const roundEntriesMap = new Map<string, Set<string>>();
  for (const m of matches) {
    const rName = m.roundName || 'Ronde';
    if (!roundEntriesMap.has(rName)) roundEntriesMap.set(rName, new Set<string>());
    const entrySet = roundEntriesMap.get(rName)!;

    if (m.entryId1 && m.entryId1 !== 'BYE') {
      if (entrySet.has(m.entryId1)) {
        errors.push(`Peserta "${m.entryId1}" muncul lebih dari satu kali di ronde "${rName}".`);
      } else {
        entrySet.add(m.entryId1);
      }
    }

    if (m.entryId2 && m.entryId2 !== 'BYE') {
      if (entrySet.has(m.entryId2)) {
        errors.push(`Peserta "${m.entryId2}" muncul lebih dari satu kali di ronde "${rName}".`);
      } else {
        entrySet.add(m.entryId2);
      }
    }
  }

  // Check 4-18: Relationship, winner/loser consistency, BYE score rules, WO notes
  for (const m of matches) {
    const label = `${m.roundName || 'Ronde'} #${m.matchNum || m.id}`;

    // Self match check
    if (m.entryId1 && m.entryId2 && m.entryId1 === m.entryId2 && m.entryId1 !== 'BYE') {
      errors.push(`${label}: Peserta bertanding melawan dirinya sendiri.`);
    }

    // Winner/Loser consistency when finished
    if (m.status === 'selesai' || m.status === 'walkover') {
      if (m.winnerId) {
        if (m.winnerId !== m.entryId1 && m.winnerId !== m.entryId2) {
          errors.push(`${label}: Pemenang (${m.winnerId}) bukan salah satu peserta dalam pertandingan (${m.entryId1} vs ${m.entryId2}).`);
        }
      } else if (m.status === 'selesai' && (m.score1 !== null || m.score2 !== null)) {
        errors.push(`${label}: Pertandingan selesai dengan skor tetapi winnerId tidak ditentukan.`);
      }

      if (m.loserId && m.loserId !== 'BYE' && m.loserId !== m.entryId1 && m.loserId !== m.entryId2) {
        errors.push(`${label}: Peserta kalah (${m.loserId}) bukan salah satu peserta dalam pertandingan.`);
      }
    }

    // BYE score check (BYE MUST NOT HAVE FAKE SCORES!)
    const isByeMatch = (m.entryId1 && (!m.entryId2 || m.entryId2 === 'BYE')) || (m.entryId2 && (!m.entryId1 || m.entryId1 === 'BYE'));
    if (isByeMatch && (m.score1 !== null || m.score2 !== null)) {
      if (m.score1 !== null && m.score2 !== null && (m.score1 > 0 || m.score2 > 0)) {
        warnings.push(`${label}: Pertandingan BYE memiliki skor fiktif (${m.score1}-${m.score2}). BYE tidak boleh memiliki skor.`);
      }
    }

    // Waiting match score check
    const isWaiting = (!m.entryId1 || m.entryId1 === 'BYE') && (!m.entryId2 || m.entryId2 === 'BYE');
    if (isWaiting && m.status === 'selesai' && m.winnerId) {
      errors.push(`${label}: Pertandingan berstatus selesai padahal kedua peserta belum diketahui (waiting match).`);
    }

    // Walkover notes check
    if (m.status === 'walkover' && !m.notes) {
      errors.push(`${label}: Pertandingan Walkover (WO) wajib menyertakan alasan.`);
    }

    // Next match slot check
    if (m.nextMatchNum) {
      const target = matches.find(tm => tm.matchNum === m.nextMatchNum);
      if (!target) {
        errors.push(`${label}: Target pertandingan berikutnya (#${m.nextMatchNum}) tidak ditemukan.`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Cascading auto-advance logic for BYE slots.
 * Per PAINDO-009:
 * - Participant automatically advances.
 * - No fake scores (score1: null, score2: null).
 * - status: 'selesai'
 * - winnerId: participant entryId
 * - loserId: null
 * - notes: 'Lolos karena BYE'
 */
export function resolveAutoAdvanceByes(
  matches: Match[],
  thirdPlaceEnabled: boolean = true
): { updatedMatches: Match[]; advancedCount: number } {
  let updatedMatches = matches.map(m => ({ ...m }));
  let changed = true;
  let advancedCount = 0;
  let loopGuard = 0;

  while (changed && loopGuard < 50) {
    changed = false;
    loopGuard++;

    for (let i = 0; i < updatedMatches.length; i++) {
      const m = updatedMatches[i];
      if (m.isBronzeMatch) continue; // Bronze match doesn't auto-advance BYE

      if (m.status === 'belum_dimainkan') {
        const hasP1 = !!m.entryId1 && m.entryId1 !== 'BYE';
        const hasP2 = !!m.entryId2 && m.entryId2 !== 'BYE';
        const isP1Bye = !m.entryId1 || m.entryId1 === 'BYE';
        const isP2Bye = !m.entryId2 || m.entryId2 === 'BYE';

        if (hasP1 && isP2Bye) {
          // Player 1 advances via BYE
          m.status = 'selesai';
          m.score1 = null;
          m.score2 = null;
          m.winnerId = m.entryId1;
          m.loserId = null;
          m.notes = 'Lolos karena BYE';

          // Propagate winner to next match
          if (m.nextMatchNum) {
            const nextMatch = updatedMatches.find(nm => nm.matchNum === m.nextMatchNum);
            if (nextMatch) {
              if (m.nextMatchSlot === 'player1') nextMatch.entryId1 = m.entryId1;
              else if (m.nextMatchSlot === 'player2') nextMatch.entryId2 = m.entryId1;
            }
          }
          changed = true;
          advancedCount++;
        } else if (hasP2 && isP1Bye) {
          // Player 2 advances via BYE
          m.status = 'selesai';
          m.score1 = null;
          m.score2 = null;
          m.winnerId = m.entryId2;
          m.loserId = null;
          m.notes = 'Lolos karena BYE';

          // Propagate winner to next match
          if (m.nextMatchNum) {
            const nextMatch = updatedMatches.find(nm => nm.matchNum === m.nextMatchNum);
            if (nextMatch) {
              if (m.nextMatchSlot === 'player1') nextMatch.entryId1 = m.entryId2;
              else if (m.nextMatchSlot === 'player2') nextMatch.entryId2 = m.entryId2;
            }
          }
          changed = true;
          advancedCount++;
        }
      }
    }
  }

  return { updatedMatches, advancedCount };
}
