/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tournament, TournamentEvent, AgeGroup, Division, Entry } from '../types';
import { generateRoundRobinMatches } from './tournamentHelpers';

export const DEFAULT_EVENTS: TournamentEvent[] = [
  { id: 'ev-gp', name: 'Ganda Putra', isDouble: true },
  { id: 'ev-gpi', name: 'Ganda Putri', isDouble: true },
  { id: 'ev-gm', name: 'Ganda Mix', isDouble: true },
  { id: 'ev-sp', name: 'Single Putra', isDouble: false },
  { id: 'ev-spi', name: 'Single Putri', isDouble: false },
];

export const DEFAULT_AGE_GROUPS: AgeGroup[] = [
  { id: 'ag-19', name: '19+' },
  { id: 'ag-35', name: '35+' },
  { id: 'ag-50', name: '50+' },
  { id: 'ag-open', name: 'Open/Bebas' },
];

export function getInitialTournament(): Tournament {
  const rand = Math.random().toString(36).substring(2, 7);
  const tId = `t-championship-${rand}`;
  
  const events = DEFAULT_EVENTS.map(ev => ({ ...ev, id: `${ev.id}-${rand}` }));
  const ageGroups = DEFAULT_AGE_GROUPS.map(ag => ({ ...ag, id: `${ag.id}-${rand}` }));

  // Ganda Putra 19+ (ev-gp & ag-19)
  const gandaPutra19Entries: Entry[] = [
    { id: `ent-1-${rand}`, name1: 'Farid', name2: 'Andi', affiliation: 'Garuda Pickleball' },
    { id: `ent-2-${rand}`, name1: 'Yusuf', name2: 'Bowo', affiliation: 'Banten Club' },
    { id: `ent-3-${rand}`, name1: 'Hendra', name2: 'Rudi', affiliation: 'Tangerang Elite' },
    { id: `ent-4-${rand}`, name1: 'Danny', name2: 'Aris', affiliation: 'Jakarta PB' },
    { id: `ent-5-${rand}`, name1: 'Kevin', name2: 'Taufik', affiliation: 'Bandung Smash' },
    { id: `ent-6-${rand}`, name1: 'Gibran', name2: 'Kaesang', affiliation: 'Solo PB Club' },
  ];

  const groupA = {
    id: `grp-a-${rand}`,
    name: 'Grup A',
    entryIds: [`ent-1-${rand}`, `ent-2-${rand}`, `ent-3-${rand}`]
  };

  const groupB = {
    id: `grp-b-${rand}`,
    name: 'Grup B',
    entryIds: [`ent-4-${rand}`, `ent-5-${rand}`, `ent-6-${rand}`]
  };

  const divId = `ev-gp-${rand}-ag-19-${rand}`;

  const initialMatches = [
    ...generateRoundRobinMatches(divId, groupA, gandaPutra19Entries),
    ...generateRoundRobinMatches(divId, groupB, gandaPutra19Entries)
  ];

  // Let's pre-fill some score results for a realistic dashboard feel
  // Match 1: ent-1 vs ent-2 (Grup A) - Farid/Andi vs Yusuf/Bowo
  initialMatches[0].score1 = 11;
  initialMatches[0].score2 = 8;
  initialMatches[0].status = 'selesai';
  initialMatches[0].winnerId = `ent-1-${rand}`;
  initialMatches[0].loserId = `ent-2-${rand}`;

  // Match 2: ent-1 vs ent-3 (Grup A) - Farid/Andi vs Hendra/Rudi
  initialMatches[1].score1 = 11;
  initialMatches[1].score2 = 5;
  initialMatches[1].status = 'selesai';
  initialMatches[1].winnerId = `ent-1-${rand}`;
  initialMatches[1].loserId = `ent-3-${rand}`;

  // Match 3: ent-2 vs ent-3 (Grup A) - Yusuf/Bowo vs Hendra/Rudi
  initialMatches[2].score1 = 11;
  initialMatches[2].score2 = 9;
  initialMatches[2].status = 'selesai';
  initialMatches[2].winnerId = `ent-2-${rand}`;
  initialMatches[2].loserId = `ent-3-${rand}`;

  // Match 4: ent-4 vs ent-5 (Grup B) - Danny/Aris vs Kevin/Taufik
  initialMatches[3].score1 = 6;
  initialMatches[3].score2 = 11;
  initialMatches[3].status = 'selesai';
  initialMatches[3].winnerId = `ent-5-${rand}`;
  initialMatches[3].loserId = `ent-4-${rand}`;

  const sampleDivision: Division = {
    id: divId,
    eventId: `ev-gp-${rand}`,
    eventName: 'Ganda Putra',
    ageGroupId: `ag-19-${rand}`,
    ageGroupName: '19+',
    settings: {
      format: 'RR_KO',
      targetScore: 11,
      winByTwo: true,
      playersPerGroup: 3,
      playersQualifyingPerGroup: 2,
      bracketSize: 4,
      wildcardActive: false,
      byeActive: false
    },
    entries: gandaPutra19Entries,
    groups: [groupA, groupB],
    roundRobinMatches: initialMatches,
    knockoutStage: null,
    champions: null
  };

  return {
    id: tId,
    name: 'Tournament Pickleball Open EO 2026',
    date: '2026-08-15',
    location: 'Gading Serpong Pickleball Court, Tangerang',
    events,
    ageGroups,
    activeDivisions: [sampleDivision]
  };
}
