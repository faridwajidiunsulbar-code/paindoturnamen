/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tournament, TournamentEvent, AgeGroup, Division, Entry } from '../types';
import { createGandaPutraDivisionFromImage } from '../data/imageDataPreset';

export const DEFAULT_EVENTS: TournamentEvent[] = [
  { id: 'ev-gp', name: 'Ganda Putra', isDouble: true },
  { id: 'ev-gpi', name: 'Ganda Putri', isDouble: true },
  { id: 'ev-gm', name: 'Ganda Mix', isDouble: true },
  { id: 'ev-sp', name: 'Single Putra', isDouble: false },
  { id: 'ev-spi', name: 'Single Putri', isDouble: false },
];

export const DEFAULT_AGE_GROUPS: AgeGroup[] = [
  { id: 'ag-open', name: 'Open/Bebas' },
  { id: 'ag-19', name: '19+' },
  { id: 'ag-35', name: '35+' },
  { id: 'ag-50', name: '50+' },
];

export function getInitialTournament(): Tournament {
  const rand = Math.random().toString(36).substring(2, 7);
  const tId = `t-championship-${rand}`;
  
  const events = DEFAULT_EVENTS.map(ev => ({ ...ev, id: `${ev.id}-${rand}` }));
  const ageGroups = DEFAULT_AGE_GROUPS.map(ag => ({ ...ag, id: `${ag.id}-${rand}` }));

  const eventGp = events.find(e => e.name === 'Ganda Putra') || events[0];
  const ageGroupOpen = ageGroups.find(a => a.name === 'Open/Bebas') || ageGroups[0];

  const sampleDivision: Division = createGandaPutraDivisionFromImage(rand, eventGp.id, ageGroupOpen.id);

  return {
    id: tId,
    name: 'Turnamen UGM x Paindo Pickle',
    date: '2026-07-30',
    location: 'Kantor Desa Lapeo',
    events,
    ageGroups,
    activeDivisions: [sampleDivision]
  };
}
