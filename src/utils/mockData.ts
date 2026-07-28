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
  return {
    id: '',
    name: 'Belum Ada Turnamen',
    date: new Date().toISOString().split('T')[0],
    location: '',
    events: DEFAULT_EVENTS,
    ageGroups: DEFAULT_AGE_GROUPS,
    activeDivisions: []
  };
}
