/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match, Group, Entry, GroupStandingRow, DivisionSettings, KnockoutSlot, WildcardCandidate } from '../types';

/**
 * Generate all round robin matches within a group (all-play-all exactly once).
 */
export function generateRoundRobinMatches(
  divisionId: string,
  group: Group,
  entries: Entry[]
): Match[] {
  const matches: Match[] = [];
  const entryIds = group.entryIds;
  let matchIndex = 1;

  for (let i = 0; i < entryIds.length; i++) {
    for (let j = i + 1; j < entryIds.length; j++) {
      matches.push({
        id: `rr-${divisionId}-${group.id}-${matchIndex++}`,
        divisionId,
        groupName: group.name,
        type: 'ROUND_ROBIN',
        entryId1: entryIds[i],
        entryId2: entryIds[j],
        score1: null,
        score2: null,
        status: 'belum_dimainkan',
      });
    }
  }

  return matches;
}

/**
 * Calculate standings for a group based on matches played.
 * Urutan tie-breaker wajib PAINDO-007:
 * 1. Jumlah Menang (Won)
 * 2. Poin Masuk Terbanyak (Points For / PF)
 * 3. Selisih Poin (Point Difference / Diff)
 * 4. Head-to-Head (H2H), HANYA jika tepat 2 peserta yang seri pada kriteria 1, 2, dan 3
 * 5. Keputusan Admin (jika H2H tidak valid / belum dimainkan, atau jika >= 3 peserta seri)
 */
export function calculateGroupStandings(
  group: Group,
  matches: Match[],
  entries: Entry[],
  qualifyingCountPerGroup: number = 2
): GroupStandingRow[] {
  // Deduplicate and filter group matches
  const groupMatchIds = new Set<string>();
  const groupMatches: Match[] = [];

  matches.forEach(m => {
    if (m.type && m.type !== 'ROUND_ROBIN' && (m.type as any) !== 'ROUND_ROBIN') return;
    if (groupMatchIds.has(m.id)) return;

    let belongsToGroup = false;

    // 1. Check if both entries belong to group
    if (m.entryId1 && m.entryId2 && group.entryIds.includes(m.entryId1) && group.entryIds.includes(m.entryId2)) {
      belongsToGroup = true;
    }

    // 2. Check by group name
    if (!belongsToGroup && m.groupName && group.name) {
      if (m.groupName === group.name) belongsToGroup = true;
      else {
        const mNorm = m.groupName.replace(/^(grup|pool)\s+/i, '').trim().toLowerCase();
        const gNorm = group.name.replace(/^(grup|pool)\s+/i, '').trim().toLowerCase();
        if (mNorm === gNorm) belongsToGroup = true;
      }
    }

    if (belongsToGroup) {
      groupMatchIds.add(m.id);
      groupMatches.push(m);
    }
  });

  const standingsMap: Record<string, GroupStandingRow> = {};

  // Initialize standings for all entries in the group
  group.entryIds.forEach(id => {
    const entry = entries.find(e => e.id === id);
    const entryName = entry
      ? `${entry.name1}${entry.name2 ? ` / ${entry.name2}` : ''}`
      : 'Unknown';

    standingsMap[id] = {
      entryId: id,
      entryName,
      played: 0,
      won: 0,
      lost: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifference: 0,
      rank: 0,
      needsAdminDecision: false,
      tieBreakReason: '',
      isTieBoundary: false,
    };
  });

  // Accumulate valid match scores
  groupMatches.forEach(match => {
    const { entryId1, entryId2, score1, score2, status, winnerId } = match;
    if (!entryId1 || !entryId2) return;

    const row1 = standingsMap[entryId1];
    const row2 = standingsMap[entryId2];
    if (!row1 || !row2) return;

    const s1 = score1 ?? null;
    const s2 = score2 ?? null;

    if (status === 'selesai') {
      if (s1 === null || s2 === null || s1 < 0 || s2 < 0 || !Number.isInteger(s1) || !Number.isInteger(s2) || s1 === s2) {
        return; // Skip invalid or draw score
      }

      const expectedWinner = s1 > s2 ? entryId1 : entryId2;
      const actualWinner = winnerId || expectedWinner;

      if (actualWinner !== entryId1 && actualWinner !== entryId2) return;
      if (actualWinner !== expectedWinner) return; // Mismatch between winnerId and scores

      row1.played += 1;
      row2.played += 1;
      row1.pointsFor += s1;
      row1.pointsAgainst += s2;
      row2.pointsFor += s2;
      row2.pointsAgainst += s1;

      if (actualWinner === entryId1) {
        row1.won += 1;
        row2.lost += 1;
      } else {
        row2.won += 1;
        row1.lost += 1;
      }
    } else if (status === 'walkover') {
      if (!winnerId || (winnerId !== entryId1 && winnerId !== entryId2)) return;
      if (s1 === null || s2 === null || s1 < 0 || s2 < 0 || !Number.isInteger(s1) || !Number.isInteger(s2) || s1 === s2) {
        return; // Skip incomplete or invalid WO scores
      }

      if (winnerId === entryId1 && s1 <= s2) return;
      if (winnerId === entryId2 && s2 <= s1) return;

      row1.played += 1;
      row2.played += 1;
      row1.pointsFor += s1;
      row1.pointsAgainst += s2;
      row2.pointsFor += s2;
      row2.pointsAgainst += s1;

      if (winnerId === entryId1) {
        row1.won += 1;
        row2.lost += 1;
      } else {
        row2.won += 1;
        row1.lost += 1;
      }
    }
  });

  // Calculate Point Difference
  const rows = Object.values(standingsMap).map(row => {
    row.pointDifference = row.pointsFor - row.pointsAgainst;
    return row;
  });

  // Initial sort by 1. Won desc, 2. PointsFor desc, 3. PointDifference desc
  rows.sort((a, b) => {
    if (b.won !== a.won) return b.won - a.won;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
    return 0;
  });

  // Partition into tied clusters
  const clusters: GroupStandingRow[][] = [];
  let currentCluster: GroupStandingRow[] = [];

  rows.forEach(row => {
    if (currentCluster.length === 0) {
      currentCluster.push(row);
    } else {
      const prev = currentCluster[0];
      if (
        row.won === prev.won &&
        row.pointsFor === prev.pointsFor &&
        row.pointDifference === prev.pointDifference
      ) {
        currentCluster.push(row);
      } else {
        clusters.push(currentCluster);
        currentCluster = [row];
      }
    }
  });
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // Resolve clusters
  const finalOrderedRows: GroupStandingRow[] = [];

  clusters.forEach(cluster => {
    if (cluster.length === 1) {
      const item = cluster[0];
      item.needsAdminDecision = false;
      item.tieBreakReason = `Statistik Utama (${item.won} Menang, ${item.pointsFor} PF, Diff ${item.pointDifference > 0 ? `+${item.pointDifference}` : item.pointDifference})`;
      finalOrderedRows.push(item);
    } else if (cluster.length === 2) {
      const p1 = cluster[0];
      const p2 = cluster[1];

      // Find H2H match
      const h2hMatch = groupMatches.find(
        m =>
          (m.status === 'selesai' || m.status === 'walkover') &&
          ((m.entryId1 === p1.entryId && m.entryId2 === p2.entryId) ||
            (m.entryId1 === p2.entryId && m.entryId2 === p1.entryId))
      );

      let h2hWinnerId: string | null = null;
      if (h2hMatch) {
        const s1 = h2hMatch.score1;
        const s2 = h2hMatch.score2;
        if (s1 !== null && s2 !== null && s1 !== s2 && s1 >= 0 && s2 >= 0) {
          if (h2hMatch.status === 'selesai') {
            const expW = s1 > s2 ? h2hMatch.entryId1 : h2hMatch.entryId2;
            if (h2hMatch.winnerId === expW) {
              h2hWinnerId = expW;
            }
          } else if (h2hMatch.status === 'walkover') {
            if (h2hMatch.winnerId === h2hMatch.entryId1 && s1 > s2) {
              h2hWinnerId = h2hMatch.entryId1;
            } else if (h2hMatch.winnerId === h2hMatch.entryId2 && s2 > s1) {
              h2hWinnerId = h2hMatch.entryId2;
            }
          }
        }
      }

      if (h2hWinnerId) {
        const winner = h2hWinnerId === p1.entryId ? p1 : p2;
        const loser = h2hWinnerId === p1.entryId ? p2 : p1;

        winner.needsAdminDecision = false;
        winner.tieBreakReason = `Unggul Head-to-Head (${winner.won}W, ${winner.pointsFor}PF, Diff ${winner.pointDifference > 0 ? `+${winner.pointDifference}` : winner.pointDifference})`;

        loser.needsAdminDecision = false;
        loser.tieBreakReason = `Kalah Head-to-Head (${loser.won}W, ${loser.pointsFor}PF, Diff ${loser.pointDifference > 0 ? `+${loser.pointDifference}` : loser.pointDifference})`;

        if (group.manualRankings && group.manualRankings[winner.entryId] !== undefined && group.manualRankings[loser.entryId] !== undefined) {
          const rW = group.manualRankings[winner.entryId];
          const rL = group.manualRankings[loser.entryId];
          if (rW < rL) {
            finalOrderedRows.push(winner, loser);
          } else {
            finalOrderedRows.push(loser, winner);
          }
        } else {
          finalOrderedRows.push(winner, loser);
        }
      } else {
        // H2H not valid / unplayed -> Needs Admin Decision!
        const hasAdminOverride = group.manualRankings &&
          group.manualRankings[p1.entryId] !== undefined &&
          group.manualRankings[p2.entryId] !== undefined;

        p1.needsAdminDecision = true;
        p2.needsAdminDecision = true;

        const reasonStr = hasAdminOverride && group.manualRankingReason
          ? `Keputusan Admin: ${group.manualRankingReason}`
          : 'Seri 2 Peserta (H2H Belum/Tidak Valid) — Keputusan Admin Diperlukan';

        p1.tieBreakReason = reasonStr;
        p2.tieBreakReason = reasonStr;

        if (hasAdminOverride) {
          if (group.manualRankings![p1.entryId] < group.manualRankings![p2.entryId]) {
            finalOrderedRows.push(p1, p2);
          } else {
            finalOrderedRows.push(p2, p1);
          }
        } else {
          finalOrderedRows.push(p1, p2);
        }
      }
    } else {
      // Cluster size >= 3 -> H2H is NOT used per PAINDO-007 rules
      const hasAdminOverride = group.manualRankings && cluster.every(item => group.manualRankings![item.entryId] !== undefined);

      cluster.forEach(item => {
        item.needsAdminDecision = true;
        const reasonStr = hasAdminOverride && group.manualRankingReason
          ? `Keputusan Admin: ${group.manualRankingReason}`
          : `Seri ${cluster.length} Peserta — Keputusan Admin Diperlukan`;
        item.tieBreakReason = reasonStr;
      });

      if (hasAdminOverride) {
        cluster.sort((a, b) => {
          const rA = group.manualRankings?.[a.entryId] ?? 999;
          const rB = group.manualRankings?.[b.entryId] ?? 999;
          return rA - rB;
        });
      }

      finalOrderedRows.push(...cluster);
    }
  });

  // Assign ranks & check tie boundary
  const rankedRows = finalOrderedRows.map((row, index) => {
    const r = index + 1;
    return {
      ...row,
      rank: r,
      manualOverrideRank: group.manualRankings?.[row.entryId],
    };
  });

  // Check if any tied group crosses the qualification boundary
  rankedRows.forEach(row => {
    if (row.needsAdminDecision && (!group.manualRankings || !group.manualRankings[row.entryId])) {
      const tiedGroup = rankedRows.filter(r => r.won === row.won && r.pointsFor === row.pointsFor && r.pointDifference === row.pointDifference);
      const minRank = Math.min(...tiedGroup.map(t => t.rank));
      const maxRank = Math.max(...tiedGroup.map(t => t.rank));

      if (minRank <= qualifyingCountPerGroup && maxRank > qualifyingCountPerGroup) {
        row.isTieBoundary = true;
      }
    }
  });

  return rankedRows;
}

/**
 * Direct Qualifier item structure for PAINDO-008
 */
export interface DirectQualifier {
  entryId: string;
  groupId: string;
  groupName: string;
  groupRank: number;
  sourceLabel: string;
  qualificationType: 'group';
  won: number;
  pointsFor: number;
  pointDifference: number;
}

/**
 * Returns direct qualifiers for each group based on qualifyingCountPerGroup
 */
export function getDirectQualifiers(
  allGroupStandings: Record<string, GroupStandingRow[]>,
  groups: Group[],
  qualifyingCountPerGroup: number
): DirectQualifier[] {
  const qualifiers: DirectQualifier[] = [];

  groups.forEach(g => {
    const standings = allGroupStandings[g.id] || [];
    const directRows = standings.filter(r => r.rank <= qualifyingCountPerGroup);
    directRows.forEach(row => {
      let rankTitle = `Peringkat ${row.rank}`;
      if (row.rank === 1) rankTitle = 'Juara';
      else if (row.rank === 2) rankTitle = 'Runner-up';
      
      const label = `${rankTitle} ${g.name}`;
      qualifiers.push({
        entryId: row.entryId,
        groupId: g.id,
        groupName: g.name,
        groupRank: row.rank,
        sourceLabel: label,
        qualificationType: 'group',
        won: row.won,
        pointsFor: row.pointsFor,
        pointDifference: row.pointDifference
      });
    });
  });

  return qualifiers;
}

export interface WildcardAnalysisResult {
  candidates: WildcardCandidate[];
  wildcardsNeeded: number;
  directQualifierCount: number;
  isNormalizedStats: boolean;
  hasTiedCluster: boolean;
  requiresAdminDecision: boolean;
  selectedWildcardEntryIds: string[];
  invalidConfigMessage?: string;
}

/**
 * Calculates wildcard rankings, candidate evaluation (total vs normalized), and tie handling
 */
export function getWildcardCandidateRankings(
  allGroupStandings: Record<string, GroupStandingRow[]>,
  groups: Group[],
  qualifyingCountPerGroup: number,
  bracketSize: number,
  manualRankings?: Record<string, number>
): WildcardAnalysisResult {
  // 1. Gather Direct Qualifiers
  const directQualifiers = getDirectQualifiers(allGroupStandings, groups, qualifyingCountPerGroup);
  const directCount = directQualifiers.length;

  const wildcardsNeeded = bracketSize - directCount;

  if (wildcardsNeeded < 0) {
    return {
      candidates: [],
      wildcardsNeeded,
      directQualifierCount: directCount,
      isNormalizedStats: false,
      hasTiedCluster: false,
      requiresAdminDecision: false,
      selectedWildcardEntryIds: [],
      invalidConfigMessage: `Jumlah peserta lolos langsung (${directCount}) melebihi slot bracket (${bracketSize}). Harap sesuaikan jumlah peserta lolos per grup atau ukuran bracket.`
    };
  }

  if (wildcardsNeeded === 0) {
    return {
      candidates: [],
      wildcardsNeeded: 0,
      directQualifierCount: directCount,
      isNormalizedStats: false,
      hasTiedCluster: false,
      requiresAdminDecision: false,
      selectedWildcardEntryIds: []
    };
  }

  // 2. Gather Candidates: group members ranked after qualifyingCountPerGroup
  const rawCandidates: WildcardCandidate[] = [];

  groups.forEach(g => {
    const standings = allGroupStandings[g.id] || [];
    const nonDirectRows = standings.filter(r => r.rank > qualifyingCountPerGroup);

    nonDirectRows.forEach(row => {
      const played = row.played || 0;
      const won = row.won || 0;
      const pointsFor = row.pointsFor || 0;
      const pointsAgainst = row.pointsAgainst || 0;
      const pointDifference = row.pointDifference || 0;

      const winPercentage = played > 0 ? won / played : 0;
      const avgPointsFor = played > 0 ? pointsFor / played : 0;
      const avgPointDifference = played > 0 ? pointDifference / played : 0;

      rawCandidates.push({
        entryId: row.entryId,
        groupId: g.id,
        groupName: g.name,
        groupRank: row.rank,
        won,
        played,
        pointsFor,
        pointsAgainst,
        pointDifference,
        winPercentage,
        avgPointsFor,
        avgPointDifference,
        eligible: true
      });
    });
  });

  if (rawCandidates.length === 0) {
    return {
      candidates: [],
      wildcardsNeeded,
      directQualifierCount: directCount,
      isNormalizedStats: false,
      hasTiedCluster: false,
      requiresAdminDecision: false,
      selectedWildcardEntryIds: []
    };
  }

  // 3. Determine whether played count differs across candidate groups
  const playedCounts = new Set(rawCandidates.map(c => c.played));
  const isNormalizedStats = playedCounts.size > 1;

  // Helper sorting comparator
  const compareCandidates = (a: WildcardCandidate, b: WildcardCandidate): number => {
    if (isNormalizedStats) {
      if (Math.abs(b.winPercentage - a.winPercentage) > 1e-9) return b.winPercentage - a.winPercentage;
      if (Math.abs(b.avgPointsFor - a.avgPointsFor) > 1e-9) return b.avgPointsFor - a.avgPointsFor;
      if (Math.abs(b.avgPointDifference - a.avgPointDifference) > 1e-9) return b.avgPointDifference - a.avgPointDifference;
      return 0;
    } else {
      if (b.won !== a.won) return b.won - a.won;
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
      return 0;
    }
  };

  // Sort candidate list
  rawCandidates.sort(compareCandidates);

  // 4. Group candidates into tied clusters
  const clusters: WildcardCandidate[][] = [];
  let currentCluster: WildcardCandidate[] = [];

  rawCandidates.forEach(cand => {
    if (currentCluster.length === 0) {
      currentCluster.push(cand);
    } else {
      const prev = currentCluster[0];
      if (compareCandidates(prev, cand) === 0) {
        currentCluster.push(cand);
      } else {
        clusters.push(currentCluster);
        currentCluster = [cand];
      }
    }
  });
  if (currentCluster.length > 0) clusters.push(currentCluster);

  // Apply admin manualRankings if provided
  const finalCandidates: WildcardCandidate[] = [];
  let requiresAdminDecision = false;
  let hasTiedCluster = false;
  let accumulatedCount = 0;

  clusters.forEach(cluster => {
    const clusterStartIdx = accumulatedCount + 1;
    const clusterEndIdx = accumulatedCount + cluster.length;

    // Check if this cluster crosses the wildcardsNeeded boundary
    const crossesBoundary = clusterStartIdx <= wildcardsNeeded && clusterEndIdx > wildcardsNeeded;

    if (cluster.length > 1) {
      cluster.forEach(c => c.tieStatus = true);
      hasTiedCluster = true;

      // Check if manualRankings covers all entries in this cluster
      const hasAllAdminOverrides = manualRankings && cluster.every(c => typeof manualRankings[c.entryId] === 'number');

      if (crossesBoundary && !hasAllAdminOverrides) {
        requiresAdminDecision = true;
      }

      if (hasAllAdminOverrides) {
        cluster.sort((a, b) => (manualRankings![a.entryId] || 999) - (manualRankings![b.entryId] || 999));
        cluster.forEach(c => c.manualOverrideRank = manualRankings![c.entryId]);
      }
    } else {
      cluster[0].tieStatus = false;
    }

    finalCandidates.push(...cluster);
    accumulatedCount += cluster.length;
  });

  // Assign wildcardRank (1, 2, 3...)
  finalCandidates.forEach((c, idx) => {
    c.wildcardRank = idx + 1;
  });

  const selectedWildcards = finalCandidates
    .slice(0, wildcardsNeeded)
    .map(c => c.entryId);

  return {
    candidates: finalCandidates,
    wildcardsNeeded,
    directQualifierCount: directCount,
    isNormalizedStats,
    hasTiedCluster,
    requiresAdminDecision,
    selectedWildcardEntryIds: selectedWildcards
  };
}

export interface SeedingResult {
  slots: KnockoutSlot[];
  confirmedEntryIds: string[];
  groupCollisionWarning?: string;
  hasByeSlots: boolean;
}

/**
 * Builds seeding tiers and places participants into knockout bracket slots with same-group avoidance
 */
export function buildSeedingAndSlots(
  allGroupStandings: Record<string, GroupStandingRow[]>,
  groups: Group[],
  qualifyingCountPerGroup: number,
  selectedWildcardEntryIds: string[],
  wildcardCandidates: WildcardCandidate[],
  bracketSize: number
): SeedingResult {
  // 1. Gather Direct Qualifiers
  const direct = getDirectQualifiers(allGroupStandings, groups, qualifyingCountPerGroup);

  // Group direct qualifiers into tiers (Tier 1 = Juara 1, Tier 2 = Juara 2, Tier 3 = Juara 3...)
  const directByRank: Record<number, DirectQualifier[]> = {};
  direct.forEach(q => {
    if (!directByRank[q.groupRank]) directByRank[q.groupRank] = [];
    directByRank[q.groupRank].push(q);
  });

  // Sort each direct tier deterministically (by won desc -> pointsFor desc -> pointDifference desc -> groupName asc)
  Object.keys(directByRank).forEach(rk => {
    const rankNum = Number(rk);
    directByRank[rankNum].sort((a, b) => {
      if (b.won !== a.won) return b.won - a.won;
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
      return a.groupName.localeCompare(b.groupName);
    });
  });

  // Construct tiered list of entries
  const tieredEntries: Array<{
    entryId: string;
    sourceLabel: string;
    qualificationType: 'group' | 'wildcard' | 'bye';
    groupId?: string;
    groupName?: string;
    groupRank?: number;
    wildcardRank?: number;
    tier: number;
  }> = [];

  // Add Direct Qualifiers tier by tier
  const sortedRanks = Object.keys(directByRank).map(Number).sort((a, b) => a - b);
  sortedRanks.forEach(rk => {
    directByRank[rk].forEach(q => {
      tieredEntries.push({
        entryId: q.entryId,
        sourceLabel: q.sourceLabel,
        qualificationType: 'group',
        groupId: q.groupId,
        groupName: q.groupName,
        groupRank: q.groupRank,
        tier: rk
      });
    });
  });

  // Add Selected Wildcards (Tier = maxRank + 1)
  const maxDirectRank = sortedRanks.length > 0 ? Math.max(...sortedRanks) : 1;
  const wildcardTier = maxDirectRank + 1;

  selectedWildcardEntryIds.forEach((wId, idx) => {
    const cand = wildcardCandidates.find(c => c.entryId === wId);
    const label = cand
      ? `Wildcard ${idx + 1} (${cand.groupName}, R${cand.groupRank})`
      : `Wildcard ${idx + 1}`;

    tieredEntries.push({
      entryId: wId,
      sourceLabel: label,
      qualificationType: 'wildcard',
      groupId: cand?.groupId,
      groupName: cand?.groupName,
      groupRank: cand?.groupRank,
      wildcardRank: idx + 1,
      tier: wildcardTier
    });
  });

  // Add BYE slots if needed to reach bracketSize
  const byeTier = wildcardTier + 1;
  while (tieredEntries.length < bracketSize) {
    const byeNo = tieredEntries.length + 1;
    tieredEntries.push({
      entryId: 'BYE',
      sourceLabel: `BYE Slot ${byeNo}`,
      qualificationType: 'bye',
      tier: byeTier
    });
  }

  // Trim to bracketSize if needed
  const finalParticipants = tieredEntries.slice(0, bracketSize);

  // Standard Seed Positions mapping for Bracket Sizes (4, 8, 16, 32)
  let seedPattern: number[] = [];

  if (bracketSize === 4) {
    seedPattern = [1, 4, 2, 3];
  } else if (bracketSize === 8) {
    seedPattern = [1, 8, 4, 5, 2, 7, 3, 6];
  } else if (bracketSize === 16) {
    seedPattern = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
  } else {
    seedPattern = Array.from({ length: bracketSize }, (_, i) => i + 1);
  }

  const slotList: KnockoutSlot[] = Array(bracketSize).fill(null);

  seedPattern.forEach((seedNum, slotIndex) => {
    const pIndex = seedNum - 1;
    const p = finalParticipants[pIndex] || {
      entryId: 'BYE',
      sourceLabel: `BYE Slot`,
      qualificationType: 'bye' as const,
      tier: byeTier
    };

    slotList[slotIndex] = {
      seedNo: seedNum,
      entryId: p.entryId === 'BYE' ? null : p.entryId,
      sourceLabel: p.sourceLabel,
      isWildcard: p.qualificationType === 'wildcard',
      isBye: p.qualificationType === 'bye' || p.entryId === 'BYE',
      sourceGroupId: p.groupId,
      sourceGroupName: p.groupName,
      sourceGroupRank: p.groupRank,
      qualificationType: p.qualificationType,
      wildcardRank: p.wildcardRank
    };
  });

  // Evaluate same-group collision in Round 1
  let groupCollisionWarning: string | undefined = undefined;

  for (let i = 0; i < bracketSize / 2; i++) {
    const s1 = slotList[2 * i];
    const s2 = slotList[2 * i + 1];

    if (s1 && s2 && s1.sourceGroupId && s2.sourceGroupId && s1.sourceGroupId === s2.sourceGroupId) {
      let swapped = false;
      for (let j = 0; j < bracketSize / 2; j++) {
        if (i === j) continue;
        const candidateSlot = slotList[2 * j + 1];
        if (
          candidateSlot &&
          candidateSlot.sourceGroupId !== s1.sourceGroupId &&
          candidateSlot.sourceGroupId !== s2.sourceGroupId
        ) {
          const temp = slotList[2 * i + 1];
          slotList[2 * i + 1] = slotList[2 * j + 1];
          slotList[2 * j + 1] = temp;
          swapped = true;
          break;
        }
      }

      if (!swapped) {
        groupCollisionWarning = `Peringatan: Peserta dari ${s1.sourceGroupName} terpasang pada ronde pertama di bracket (Secara matematis tidak dapat dihindari dengan jumlah grup/bracket yang ada).`;
      }
    }
  }

  const confirmedEntryIds = slotList.map(s => (s.isBye || !s.entryId) ? 'BYE' : s.entryId);
  const hasByeSlots = slotList.some(s => s.isBye);

  return {
    slots: slotList,
    confirmedEntryIds,
    groupCollisionWarning,
    hasByeSlots
  };
}

/**
 * Backward-compatible helper wrapper
 */
export function getWildcardRecommendations(
  allGroupStandings: Record<string, GroupStandingRow[]>,
  qualifyingCountPerGroup: number,
  totalNeeded: number
): { direct: string[]; wildcards: string[]; nextBestList: GroupStandingRow[] } {
  const direct: string[] = [];
  const nextBestList: GroupStandingRow[] = [];

  Object.keys(allGroupStandings).forEach(groupId => {
    const groupStandings = allGroupStandings[groupId];
    groupStandings.forEach(row => {
      if (row.rank <= qualifyingCountPerGroup) {
        direct.push(row.entryId);
      } else {
        nextBestList.push(row);
      }
    });
  });

  nextBestList.sort((a, b) => {
    if (b.won !== a.won) return b.won - a.won;
    if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return 0;
  });

  const wildcardsNeeded = Math.max(0, totalNeeded - direct.length);
  const wildcards = nextBestList.slice(0, wildcardsNeeded).map(row => row.entryId);

  return {
    direct,
    wildcards,
    nextBestList,
  };
}

/**
 * Generate a complete Knockout stage structure with matches linked.
 */
export function generateKnockoutBracket(
  divisionId: string,
  qualifiedEntryIds: string[], // Seeds 1 to N
  bracketSize: number
): Match[] {
  const matches: Match[] = [];

  // Create a list of slot entries based on bracket size, padding with nulls or 'BYE'
  const entriesList: (string | 'BYE' | null)[] = Array(bracketSize).fill(null);
  
  // Fill the bracket slots with qualified entry IDs
  for (let i = 0; i < bracketSize; i++) {
    if (i < qualifiedEntryIds.length) {
      entriesList[i] = qualifiedEntryIds[i];
    } else {
      // If we don't have enough entries, pad with BYE
      entriesList[i] = 'BYE';
    }
  }

  // Bracket sizing logic and round generation
  // We need to define standard tournament match trees:
  // For size N, there are N - 1 standard matches + 1 bronze match (juara 3)
  // Let's index matches from 1 to N.
  // Match structure:
  // e.g. for N=4:
  // - Match 1 (SF1): Entry 1 vs Entry 4 -> Winner to Match 3 (Finals) Slot 1
  // - Match 2 (SF2): Entry 2 vs Entry 3 -> Winner to Match 3 (Finals) Slot 2
  // - Match 3 (Finals): Winner SF1 vs Winner SF2
  // - Match 4 (Bronze Match): Loser SF1 vs Loser SF2
  
  if (bracketSize === 4) {
    // Round of Semifinals
    matches.push({
      id: `ko-${divisionId}-1`,
      divisionId,
      roundName: 'Semifinal',
      type: 'KNOCKOUT',
      matchNum: 1,
      nextMatchNum: 3,
      nextMatchSlot: 'player1',
      entryId1: entriesList[0] === 'BYE' ? null : entriesList[0],
      entryId2: entriesList[3] === 'BYE' ? null : entriesList[3],
      score1: null,
      score2: null,
      status: 'belum_dimainkan',
    });

    matches.push({
      id: `ko-${divisionId}-2`,
      divisionId,
      roundName: 'Semifinal',
      type: 'KNOCKOUT',
      matchNum: 2,
      nextMatchNum: 3,
      nextMatchSlot: 'player2',
      entryId1: entriesList[1] === 'BYE' ? null : entriesList[1],
      entryId2: entriesList[2] === 'BYE' ? null : entriesList[2],
      score1: null,
      score2: null,
      status: 'belum_dimainkan',
    });

    // Finals
    matches.push({
      id: `ko-${divisionId}-3`,
      divisionId,
      roundName: 'Final',
      type: 'KNOCKOUT',
      matchNum: 3,
      entryId1: null,
      entryId2: null,
      score1: null,
      score2: null,
      status: 'belum_dimainkan',
    });

    // Bronze Match
    matches.push({
      id: `ko-${divisionId}-4`,
      divisionId,
      roundName: 'Perebutan Juara 3',
      type: 'KNOCKOUT',
      matchNum: 4,
      isBronzeMatch: true,
      entryId1: null,
      entryId2: null,
      score1: null,
      score2: null,
      status: 'belum_dimainkan',
    });
  } 
  else if (bracketSize === 8) {
    // Quarterfinals (Matches 1 to 4)
    // Seeding matchups: 
    // QF1: S1 vs S8 -> Winner to SF1 (Match 5) Slot 1
    // QF2: S4 vs S5 -> Winner to SF1 (Match 5) Slot 2
    // QF3: S2 vs S7 -> Winner to SF2 (Match 6) Slot 1
    // QF4: S3 vs S6 -> Winner to SF2 (Match 6) Slot 2
    matches.push({
      id: `ko-${divisionId}-1`,
      divisionId,
      roundName: 'Perempat Final',
      type: 'KNOCKOUT',
      matchNum: 1,
      nextMatchNum: 5,
      nextMatchSlot: 'player1',
      entryId1: entriesList[0] === 'BYE' ? null : entriesList[0],
      entryId2: entriesList[7] === 'BYE' ? null : entriesList[7],
      score1: null, score2: null, status: 'belum_dimainkan',
    });
    matches.push({
      id: `ko-${divisionId}-2`,
      divisionId,
      roundName: 'Perempat Final',
      type: 'KNOCKOUT',
      matchNum: 2,
      nextMatchNum: 5,
      nextMatchSlot: 'player2',
      entryId1: entriesList[3] === 'BYE' ? null : entriesList[3],
      entryId2: entriesList[4] === 'BYE' ? null : entriesList[4],
      score1: null, score2: null, status: 'belum_dimainkan',
    });
    matches.push({
      id: `ko-${divisionId}-3`,
      divisionId,
      roundName: 'Perempat Final',
      type: 'KNOCKOUT',
      matchNum: 3,
      nextMatchNum: 6,
      nextMatchSlot: 'player1',
      entryId1: entriesList[1] === 'BYE' ? null : entriesList[1],
      entryId2: entriesList[6] === 'BYE' ? null : entriesList[6],
      score1: null, score2: null, status: 'belum_dimainkan',
    });
    matches.push({
      id: `ko-${divisionId}-4`,
      divisionId,
      roundName: 'Perempat Final',
      type: 'KNOCKOUT',
      matchNum: 4,
      nextMatchNum: 6,
      nextMatchSlot: 'player2',
      entryId1: entriesList[2] === 'BYE' ? null : entriesList[2],
      entryId2: entriesList[5] === 'BYE' ? null : entriesList[5],
      score1: null, score2: null, status: 'belum_dimainkan',
    });

    // Semifinals (Matches 5 & 6)
    matches.push({
      id: `ko-${divisionId}-5`,
      divisionId,
      roundName: 'Semifinal',
      type: 'KNOCKOUT',
      matchNum: 5,
      nextMatchNum: 7,
      nextMatchSlot: 'player1',
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });
    matches.push({
      id: `ko-${divisionId}-6`,
      divisionId,
      roundName: 'Semifinal',
      type: 'KNOCKOUT',
      matchNum: 6,
      nextMatchNum: 7,
      nextMatchSlot: 'player2',
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });

    // Finals (Match 7)
    matches.push({
      id: `ko-${divisionId}-7`,
      divisionId,
      roundName: 'Final',
      type: 'KNOCKOUT',
      matchNum: 7,
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });

    // Bronze Match (Match 8)
    matches.push({
      id: `ko-${divisionId}-8`,
      divisionId,
      roundName: 'Perebutan Juara 3',
      type: 'KNOCKOUT',
      matchNum: 8,
      isBronzeMatch: true,
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });
  } 
  else {
    // For size 16 (and fallback for 32, we map them out dynamically)
    // To keep it clean and robust, let's build size 16 directly
    const r16Count = bracketSize; // 16
    const r16MatchesCount = r16Count / 2; // 8
    
    // Round of 16 (Matches 1 to 8)
    // S1 vs S16 (M1) -> M9 P1
    // S8 vs S9 (M2)  -> M9 P2
    // S4 vs S13 (M3) -> M10 P1
    // S5 vs S12 (M4) -> M10 P2
    // S2 vs S15 (M5) -> M11 P1
    // S7 vs S10 (M6) -> M11 P2
    // S3 vs S14 (M7) -> M12 P1
    // S6 vs S11 (M8) -> M12 P2
    const matchups16 = [
      [0, 15], [7, 8], [3, 12], [4, 11],
      [1, 14], [6, 9], [2, 13], [5, 10]
    ];

    for (let i = 0; i < 8; i++) {
      const p1Index = matchups16[i][0];
      const p2Index = matchups16[i][1];
      const nextMatch = 9 + Math.floor(i / 2);
      const nextSlot = (i % 2 === 0) ? 'player1' : 'player2';

      matches.push({
        id: `ko-${divisionId}-${i + 1}`,
        divisionId,
        roundName: 'Babak 16 Besar',
        type: 'KNOCKOUT',
        matchNum: i + 1,
        nextMatchNum: nextMatch,
        nextMatchSlot: nextSlot as 'player1' | 'player2',
        entryId1: entriesList[p1Index] === 'BYE' ? null : entriesList[p1Index],
        entryId2: entriesList[p2Index] === 'BYE' ? null : entriesList[p2Index],
        score1: null, score2: null, status: 'belum_dimainkan',
      });
    }

    // Quarterfinals (Matches 9 to 12)
    // M9  -> M13 P1
    // M10 -> M13 P2
    // M11 -> M14 P1
    // M12 -> M14 P2
    for (let i = 0; i < 4; i++) {
      const nextMatch = 13 + Math.floor(i / 2);
      const nextSlot = (i % 2 === 0) ? 'player1' : 'player2';

      matches.push({
        id: `ko-${divisionId}-${9 + i}`,
        divisionId,
        roundName: 'Perempat Final',
        type: 'KNOCKOUT',
        matchNum: 9 + i,
        nextMatchNum: nextMatch,
        nextMatchSlot: nextSlot as 'player1' | 'player2',
        entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
      });
    }

    // Semifinals (Matches 13 & 14) -> Finals (Match 15)
    matches.push({
      id: `ko-${divisionId}-13`,
      divisionId,
      roundName: 'Semifinal',
      type: 'KNOCKOUT',
      matchNum: 13,
      nextMatchNum: 15,
      nextMatchSlot: 'player1',
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });
    matches.push({
      id: `ko-${divisionId}-14`,
      divisionId,
      roundName: 'Semifinal',
      type: 'KNOCKOUT',
      matchNum: 14,
      nextMatchNum: 15,
      nextMatchSlot: 'player2',
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });

    // Finals (Match 15)
    matches.push({
      id: `ko-${divisionId}-15`,
      divisionId,
      roundName: 'Final',
      type: 'KNOCKOUT',
      matchNum: 15,
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });

    // Bronze Match (Match 16)
    matches.push({
      id: `ko-${divisionId}-16`,
      divisionId,
      roundName: 'Perebutan Juara 3',
      type: 'KNOCKOUT',
      matchNum: 16,
      isBronzeMatch: true,
      entryId1: null, entryId2: null, score1: null, score2: null, status: 'belum_dimainkan',
    });
  }

  // Handle automatic advanced matches for BYE situations
  // If entryId1 is set but entryId2 is 'BYE' (or vice-versa), we can auto-advance.
  // Wait, let's keep it simple: if a match has only one player because the other slot is empty or has a BYE,
  // we let the user see it, and we can provide an "Auto-advance Bye" or let them input score/walkover.
  // Even better: during KO render, if entryId1 exists and entryId2 is empty or BYE, we can mark it as a bye-match.
  // Let's implement dynamic bracket progression when matches are updated.

  return matches;
}

/**
 * Propagates knockout match results to subsequent matches in the tree.
 * When a match score is entered, we determine the winner and loser:
 * - Winner goes to `nextMatchNum` at `nextMatchSlot`
 * - Loser goes to the bronze match if this was a semifinal match!
 */
export function propagateKnockoutResult(
  matches: Match[],
  matchNum: number,
  winnerId: string,
  loserId: string
): Match[] {
  const updated = matches.map(m => ({ ...m }));
  const match = updated.find(m => m.matchNum === matchNum);
  if (!match) return updated;

  // Set winner and loser for this match
  match.winnerId = winnerId;
  match.loserId = loserId;

  // If there's a next match, propagate the winner
  if (match.nextMatchNum) {
    const nextMatch = updated.find(m => m.matchNum === match.nextMatchNum);
    if (nextMatch) {
      if (match.nextMatchSlot === 'player1') {
        nextMatch.entryId1 = winnerId;
      } else if (match.nextMatchSlot === 'player2') {
        nextMatch.entryId2 = winnerId;
      }
    }
  }

  // If this is a Semifinal match, the loser goes to the Bronze Match (Perebutan Juara 3)!
  // Let's identify the Bronze Match:
  // - In bracketSize=4: SFs are Match 1 & 2. Bronze Match is Match 4.
  //   - Loser of Match 1 goes to Match 4 Entry 1
  //   - Loser of Match 2 goes to Match 4 Entry 2
  // - In bracketSize=8: SFs are Match 5 & 6. Bronze Match is Match 8.
  //   - Loser of Match 5 goes to Match 8 Entry 1
  //   - Loser of Match 6 goes to Match 8 Entry 2
  // - In bracketSize=16: SFs are Match 13 & 14. Bronze Match is Match 16.
  //   - Loser of Match 13 goes to Match 16 Entry 1
  //   - Loser of Match 14 goes to Match 16 Entry 2
  
  if (match.roundName === 'Semifinal') {
    let bronzeMatchNum = 0;
    let slot: 'player1' | 'player2' = 'player1';

    if (matchNum === 1 || matchNum === 2) {
      bronzeMatchNum = 4;
      slot = matchNum === 1 ? 'player1' : 'player2';
    } else if (matchNum === 5 || matchNum === 6) {
      bronzeMatchNum = 8;
      slot = matchNum === 5 ? 'player1' : 'player2';
    } else if (matchNum === 13 || matchNum === 14) {
      bronzeMatchNum = 16;
      slot = matchNum === 13 ? 'player1' : 'player2';
    }

    if (bronzeMatchNum > 0) {
      const bronzeMatch = updated.find(m => m.matchNum === bronzeMatchNum);
      if (bronzeMatch) {
        if (slot === 'player1') {
          bronzeMatch.entryId1 = loserId;
        } else {
          bronzeMatch.entryId2 = loserId;
        }
      }
    }
  }

  return updated;
}
