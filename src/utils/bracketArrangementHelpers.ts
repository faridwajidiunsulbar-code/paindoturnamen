import { Group, GroupStandingRow, KnockoutSlot, WildcardCandidate, GroupCrossPairing, ManualSlotAssignment, Entry } from '../types';

export function getSeedPattern(bracketSize: number): number[] {
  if (bracketSize === 4) {
    return [1, 4, 2, 3];
  } else if (bracketSize === 8) {
    return [1, 8, 4, 5, 2, 7, 3, 6];
  } else if (bracketSize === 16) {
    return [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
  } else if (bracketSize === 32) {
    return [
      1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21,
      2, 31, 15, 18, 7, 26, 10, 23, 3, 30, 14, 19, 6, 27, 11, 22
    ];
  } else {
    return Array.from({ length: bracketSize }, (_, i) => i + 1);
  }
}

export function getBracketHalf(seedNo: number, bracketSize: number): 'upper' | 'lower' {
  const pattern = getSeedPattern(bracketSize);
  const pos = pattern.indexOf(seedNo);
  const halfSize = bracketSize / 2;
  if (pos !== -1 && pos < halfSize) {
    return 'upper';
  }
  return 'lower';
}

export function getEarliestPossibleRound(
  seedOne: number,
  seedTwo: number,
  bracketSize: number
): {
  roundNumber: number;
  roundName: 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'final';
} {
  const pattern = getSeedPattern(bracketSize);
  const pos1 = pattern.indexOf(seedOne);
  const pos2 = pattern.indexOf(seedTwo);

  if (pos1 === -1 || pos2 === -1 || pos1 === pos2) {
    return { roundNumber: Math.log2(bracketSize), roundName: 'final' };
  }

  const xor = pos1 ^ pos2;
  const bit = 32 - Math.clz32(xor); // Highest 1-based bit position of difference

  const totalRounds = Math.log2(bracketSize);
  const roundNum = Math.min(bit, totalRounds);

  let roundName: 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'final' = 'final';

  if (bracketSize === 4) {
    roundName = roundNum === 1 ? 'semifinal' : 'final';
  } else if (bracketSize === 8) {
    if (roundNum === 1) roundName = 'quarterfinal';
    else if (roundNum === 2) roundName = 'semifinal';
    else roundName = 'final';
  } else if (bracketSize === 16) {
    if (roundNum === 1) roundName = 'round_of_16';
    else if (roundNum === 2) roundName = 'quarterfinal';
    else if (roundNum === 3) roundName = 'semifinal';
    else roundName = 'final';
  } else if (bracketSize === 32) {
    if (roundNum === 1) roundName = 'round_of_32';
    else if (roundNum === 2) roundName = 'round_of_16';
    else if (roundNum === 3) roundName = 'quarterfinal';
    else if (roundNum === 4) roundName = 'semifinal';
    else roundName = 'final';
  }

  return { roundNumber: roundNum, roundName };
}

export interface GroupSeparationConflict {
  groupId: string;
  groupName?: string;
  entryIdOne?: string;
  entryIdTwo?: string;
  seedOne: number;
  seedTwo: number;
  earliestPossibleRound: 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'final';
  requiredRound: 'final';
  avoidable: boolean;
  reason: string;
}

export function validateBracketGroupSeparation(
  slots: KnockoutSlot[],
  bracketSize: number
): {
  valid: boolean;
  conflicts: GroupSeparationConflict[];
} {
  const conflicts: GroupSeparationConflict[] = [];

  // Group slots by sourceGroupId
  const slotsByGroup: Record<string, KnockoutSlot[]> = {};
  slots.forEach(s => {
    if (!s.isBye && s.sourceGroupId) {
      if (!slotsByGroup[s.sourceGroupId]) {
        slotsByGroup[s.sourceGroupId] = [];
      }
      slotsByGroup[s.sourceGroupId].push(s);
    }
  });

  const totalRounds = Math.log2(bracketSize);

  Object.entries(slotsByGroup).forEach(([grpId, grpSlots]) => {
    if (grpSlots.length < 2) return;

    for (let i = 0; i < grpSlots.length; i++) {
      for (let j = i + 1; j < grpSlots.length; j++) {
        const slotA = grpSlots[i];
        const slotB = grpSlots[j];

        const { roundNumber, roundName } = getEarliestPossibleRound(slotA.seedNo, slotB.seedNo, bracketSize);

        const isRank1And2 =
          (slotA.sourceGroupRank === 1 && slotB.sourceGroupRank === 2) ||
          (slotA.sourceGroupRank === 2 && slotB.sourceGroupRank === 1);

        if (roundNumber < totalRounds) {
          const gName = slotA.sourceGroupName || grpId;
          const reason = isRank1And2
            ? `Peserta Peringkat 1 dan 2 dari Grup ${gName} berpotensi bertemu di ronde ${roundName.toUpperCase()} (sebelum Final).`
            : `Dua peserta dari Grup ${gName} berpotensi bertemu di ronde ${roundName.toUpperCase()}.`;

          conflicts.push({
            groupId: grpId,
            groupName: gName,
            entryIdOne: slotA.entryId || undefined,
            entryIdTwo: slotB.entryId || undefined,
            seedOne: slotA.seedNo,
            seedTwo: slotB.seedNo,
            earliestPossibleRound: roundName,
            requiredRound: 'final',
            avoidable: grpSlots.length <= 2,
            reason
          });
        }
      }
    }
  });

  return {
    valid: conflicts.length === 0,
    conflicts
  };
}

export function buildGroupCrossTemplateSlots(
  groups: Group[],
  pairings: GroupCrossPairing[],
  qualifyingCountPerGroup: number,
  wildcardCount: number,
  bracketSize: number
): KnockoutSlot[] {
  const slots: KnockoutSlot[] = Array(bracketSize).fill(null);
  const pattern = getSeedPattern(bracketSize);
  const halfSize = bracketSize / 2;

  // Track which positions in the upper/lower half pattern are allocated
  const upperHalfSeedNos: number[] = [];
  const lowerHalfSeedNos: number[] = [];

  pattern.forEach((seed, idx) => {
    if (idx < halfSize) {
      upperHalfSeedNos.push(seed);
    } else {
      lowerHalfSeedNos.push(seed);
    }
  });

  let upperIndex = 0;
  let lowerIndex = 0;

  const usedGroupIds = new Set<string>();

  // Process pairs
  pairings.forEach(p => {
    const g1 = groups.find(g => g.id === p.groupOneId || g.id.startsWith(p.groupOneId + '-') || p.groupOneId.startsWith(g.id + '-'));
    const g2 = groups.find(g => g.id === p.groupTwoId || g.id.startsWith(p.groupTwoId + '-') || p.groupTwoId.startsWith(g.id + '-'));
    if (!g1 || !g2) return;

    usedGroupIds.add(g1.id);
    usedGroupIds.add(g2.id);

    // Cross Match 1: Rank 1 Group 1 vs Rank 2 Group 2 -> Upper Half
    if (upperIndex + 1 < upperHalfSeedNos.length) {
      const seedA = upperHalfSeedNos[upperIndex++];
      const seedB = upperHalfSeedNos[upperIndex++];

      const slotAIdx = pattern.indexOf(seedA);
      const slotBIdx = pattern.indexOf(seedB);

      slots[slotAIdx] = {
        seedNo: seedA,
        entryId: null,
        sourceLabel: `Juara ${g1.name}`,
        isWildcard: false,
        isBye: false,
        sourceGroupId: g1.id,
        sourceGroupName: g1.name,
        sourceGroupRank: 1,
        qualificationType: 'group'
      };

      slots[slotBIdx] = {
        seedNo: seedB,
        entryId: null,
        sourceLabel: `Runner-up ${g2.name}`,
        isWildcard: false,
        isBye: false,
        sourceGroupId: g2.id,
        sourceGroupName: g2.name,
        sourceGroupRank: 2,
        qualificationType: 'group'
      };
    }

    // Cross Match 2: Rank 1 Group 2 vs Rank 2 Group 1 -> Lower Half
    if (lowerIndex + 1 < lowerHalfSeedNos.length) {
      const seedC = lowerHalfSeedNos[lowerIndex++];
      const seedD = lowerHalfSeedNos[lowerIndex++];

      const slotCIdx = pattern.indexOf(seedC);
      const slotDIdx = pattern.indexOf(seedD);

      slots[slotCIdx] = {
        seedNo: seedC,
        entryId: null,
        sourceLabel: `Juara ${g2.name}`,
        isWildcard: false,
        isBye: false,
        sourceGroupId: g2.id,
        sourceGroupName: g2.name,
        sourceGroupRank: 1,
        qualificationType: 'group'
      };

      slots[slotDIdx] = {
        seedNo: seedD,
        entryId: null,
        sourceLabel: `Runner-up ${g1.name}`,
        isWildcard: false,
        isBye: false,
        sourceGroupId: g1.id,
        sourceGroupName: g1.name,
        sourceGroupRank: 2,
        qualificationType: 'group'
      };
    }
  });

  // Handle unpaired groups or rank 3+ direct qualifiers
  const remainingGroups = groups.filter(g => !usedGroupIds.has(g.id));

  // Collect all remaining group rank slots to place
  const extraGroupSlots: Array<{ groupId: string; groupName: string; rank: number }> = [];

  // 1. Paired groups rank 3+
  groups.filter(g => usedGroupIds.has(g.id)).forEach(g => {
    for (let r = 3; r <= qualifyingCountPerGroup; r++) {
      extraGroupSlots.push({ groupId: g.id, groupName: g.name, rank: r });
    }
  });

  // 2. Unpaired groups rank 1..qualifyingCountPerGroup
  remainingGroups.forEach(g => {
    for (let r = 1; r <= qualifyingCountPerGroup; r++) {
      extraGroupSlots.push({ groupId: g.id, groupName: g.name, rank: r });
    }
  });

  // Collect Wildcard slots
  const wildcardSlots: Array<{ wildcardRank: number }> = [];
  for (let w = 1; w <= wildcardCount; w++) {
    wildcardSlots.push({ wildcardRank: w });
  }

  // Fill empty slots in pattern
  pattern.forEach((seed, idx) => {
    if (slots[idx]) return; // already set by group cross

    if (extraGroupSlots.length > 0) {
      const item = extraGroupSlots.shift()!;
      const rankLabel = item.rank === 1 ? 'Juara' : (item.rank === 2 ? 'Runner-up' : `Peringkat ${item.rank}`);
      slots[idx] = {
        seedNo: seed,
        entryId: null,
        sourceLabel: `${rankLabel} ${item.groupName}`,
        isWildcard: false,
        isBye: false,
        sourceGroupId: item.groupId,
        sourceGroupName: item.groupName,
        sourceGroupRank: item.rank,
        qualificationType: 'group'
      };
    } else if (wildcardSlots.length > 0) {
      const item = wildcardSlots.shift()!;
      slots[idx] = {
        seedNo: seed,
        entryId: null,
        sourceLabel: `Wildcard ${item.wildcardRank}`,
        isWildcard: true,
        isBye: false,
        qualificationType: 'wildcard',
        wildcardRank: item.wildcardRank
      };
    } else {
      slots[idx] = {
        seedNo: seed,
        entryId: null,
        sourceLabel: `BYE Slot ${seed}`,
        isWildcard: false,
        isBye: true,
        qualificationType: 'bye'
      };
    }
  });

  return slots;
}

export function resolveBracketTemplateSlots(
  templateSlots: KnockoutSlot[],
  allGroupStandings: Record<string, GroupStandingRow[]>,
  wildcardCandidates: WildcardCandidate[],
  selectedWildcardEntryIds: string[],
  entries: Entry[]
): {
  resolvedSlots: KnockoutSlot[];
  unresolvedSources: KnockoutSlot[];
  invalidSources: KnockoutSlot[];
  duplicateEntries: string[];
  missingEligible: string[];
  isFullyResolved: boolean;
} {
  const resolvedSlots: KnockoutSlot[] = [];
  const unresolvedSources: KnockoutSlot[] = [];
  const invalidSources: KnockoutSlot[] = [];
  const seenEntries = new Set<string>();
  const duplicateEntries: string[] = [];

  const entryMap = new Map<string, Entry>();
  entries.forEach(e => entryMap.set(e.id, e));

  templateSlots.forEach(slot => {
    let resolvedId: string | null = null;
    let label = slot.sourceLabel;

    if (slot.isBye) {
      resolvedSlots.push({
        ...slot,
        entryId: null,
        isBye: true,
        sourceLabel: `BYE`
      });
      return;
    }

    if (slot.qualificationType === 'group' && slot.sourceGroupId && slot.sourceGroupRank) {
      let grpStandings = allGroupStandings[slot.sourceGroupId];
      if (!grpStandings) {
        const matchingKey = Object.keys(allGroupStandings).find(k => k === slot.sourceGroupId || k.startsWith(slot.sourceGroupId + '-') || slot.sourceGroupId.startsWith(k + '-'));
        if (matchingKey) {
          grpStandings = allGroupStandings[matchingKey];
        }
      }
      if (grpStandings && grpStandings.length >= slot.sourceGroupRank) {
        const row = grpStandings[slot.sourceGroupRank - 1];
        if (row && row.entryId) {
          resolvedId = row.entryId;
          const rankPrefix = slot.sourceGroupRank === 1 ? 'Juara' : (slot.sourceGroupRank === 2 ? 'Runner-up' : `P1 ${slot.sourceGroupRank}`);
          label = `${row.entryName} (${rankPrefix})`;
        } else {
          unresolvedSources.push(slot);
        }
      } else {
        unresolvedSources.push(slot);
      }
    } else if (slot.qualificationType === 'wildcard' && slot.wildcardRank) {
      const wIdx = slot.wildcardRank - 1;
      if (wIdx >= 0 && wIdx < selectedWildcardEntryIds.length) {
        resolvedId = selectedWildcardEntryIds[wIdx];
        const cand = wildcardCandidates.find(c => c.entryId === resolvedId);
        const p = entryMap.get(resolvedId);
        const pName = p ? `${p.name1}${p.name2 ? ` / ${p.name2}` : ''}` : 'Peserta';
        label = cand
          ? `${pName} (Wildcard ${slot.wildcardRank} - ${cand.groupName})`
          : `${pName} (Wildcard ${slot.wildcardRank})`;
      } else {
        unresolvedSources.push(slot);
      }
    } else if (slot.entryId) {
      resolvedId = slot.entryId;
      const p = entryMap.get(resolvedId);
      if (p) {
        label = `${p.name1}${p.name2 ? ` / ${p.name2}` : ''}`;
      }
    } else {
      unresolvedSources.push(slot);
    }

    if (resolvedId) {
      if (seenEntries.has(resolvedId)) {
        duplicateEntries.push(resolvedId);
      }
      seenEntries.add(resolvedId);
    }

    resolvedSlots.push({
      ...slot,
      entryId: resolvedId,
      sourceLabel: label
    });
  });

  const missingEligible: string[] = [];

  const isFullyResolved = unresolvedSources.length === 0 && invalidSources.length === 0;

  return {
    resolvedSlots,
    unresolvedSources,
    invalidSources,
    duplicateEntries,
    missingEligible,
    isFullyResolved
  };
}
