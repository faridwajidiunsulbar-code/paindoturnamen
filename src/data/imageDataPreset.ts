/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Division, Entry, Group, Match } from '../types';
import { generateRoundRobinMatches } from '../utils/tournamentHelpers';

export function createGandaPutraDivisionFromImage(
  rand: string,
  eventId: string,
  ageGroupId: string
): Division {
  const divId = `${eventId}-${ageGroupId}`;

  // Pool A (4 entries)
  const poolA: Entry[] = [
    { id: `ent-a1-${rand}`, name1: 'HAEDAR', name2: 'FAIQ', affiliation: 'Pool A' },
    { id: `ent-a2-${rand}`, name1: 'H. ALIMIN', name2: 'WAWAN', affiliation: 'Pool A' },
    { id: `ent-a3-${rand}`, name1: 'AMIR', name2: 'RAHMAN', affiliation: 'Pool A' },
    { id: `ent-a4-${rand}`, name1: 'ALIF', name2: 'HENDRA', affiliation: 'Pool A' },
  ];

  // Pool B (5 entries)
  const poolB: Entry[] = [
    { id: `ent-b1-${rand}`, name1: 'IRUL', name2: 'BAKRI', affiliation: 'Pool B' },
    { id: `ent-b2-${rand}`, name1: 'RAHMAT', name2: 'ASLAN', affiliation: 'Pool B' },
    { id: `ent-b3-${rand}`, name1: 'FANDHI', name2: 'PANGERAN', affiliation: 'Pool B' },
    { id: `ent-b4-${rand}`, name1: 'ACO', name2: 'ADAM', affiliation: 'Pool B' },
    { id: `ent-b5-${rand}`, name1: 'ADI', name2: 'SEKDA', affiliation: 'Pool B' },
  ];

  // Pool C (4 entries)
  const poolC: Entry[] = [
    { id: `ent-c1-${rand}`, name1: 'ISWAN', name2: 'SABRI', affiliation: 'Pool C' },
    { id: `ent-c2-${rand}`, name1: 'FARID', name2: 'RADHI', affiliation: 'Pool C' },
    { id: `ent-c3-${rand}`, name1: 'MULTAZAM', name2: 'RIFAI', affiliation: 'Pool C' },
    { id: `ent-c4-${rand}`, name1: 'FIRDAUS', name2: 'BURHAN', affiliation: 'Pool C' },
  ];

  // Pool D (4 entries)
  const poolD: Entry[] = [
    { id: `ent-d1-${rand}`, name1: 'DEDE', name2: 'TAMSIL', affiliation: 'Pool D' },
    { id: `ent-d2-${rand}`, name1: 'AMRI', name2: 'RAJA SALMAN', affiliation: 'Pool D' },
    { id: `ent-d3-${rand}`, name1: 'ARIF', name2: 'MILAN', affiliation: 'Pool D' },
    { id: `ent-d4-${rand}`, name1: 'AWI', name2: 'ZHAKY', affiliation: 'Pool D' },
  ];

  const allEntries = [...poolA, ...poolB, ...poolC, ...poolD];

  const groupA: Group = {
    id: `grp-a-${rand}`,
    name: 'Pool A',
    entryIds: poolA.map(e => e.id)
  };

  const groupB: Group = {
    id: `grp-b-${rand}`,
    name: 'Pool B',
    entryIds: poolB.map(e => e.id)
  };

  const groupC: Group = {
    id: `grp-c-${rand}`,
    name: 'Pool C',
    entryIds: poolC.map(e => e.id)
  };

  const groupD: Group = {
    id: `grp-d-${rand}`,
    name: 'Pool D',
    entryIds: poolD.map(e => e.id)
  };

  const groups = [groupA, groupB, groupC, groupD];

  const roundRobinMatches: Match[] = [
    ...generateRoundRobinMatches(divId, groupA, allEntries),
    ...generateRoundRobinMatches(divId, groupB, allEntries),
    ...generateRoundRobinMatches(divId, groupC, allEntries),
    ...generateRoundRobinMatches(divId, groupD, allEntries),
  ];

  return {
    id: divId,
    eventId,
    eventName: 'Ganda Putra',
    ageGroupId,
    ageGroupName: 'Open/Bebas',
    settings: {
      format: 'RR_KO',
      targetScore: 11,
      winByTwo: true,
      playersPerGroup: 4,
      playersQualifyingPerGroup: 2,
      bracketSize: 8,
      wildcardActive: false,
      byeActive: false
    },
    entries: allEntries,
    groups,
    roundRobinMatches,
    knockoutStage: null,
    champions: null
  };
}
