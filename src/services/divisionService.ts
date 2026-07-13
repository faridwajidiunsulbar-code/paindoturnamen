import { saveTournamentToSupabase } from './tournamentService';
import { Tournament, Division } from '../types';

/**
 * Service to handle active tournament divisions.
 * Uses unified save state for atomic consistency.
 */
export async function updateDivisionInDatabase(
  tournament: Tournament,
  updatedDivision: Division
): Promise<boolean> {
  const updatedDivisions = tournament.activeDivisions.map(div =>
    div.id === updatedDivision.id ? updatedDivision : div
  );

  const updatedTournament: Tournament = {
    ...tournament,
    activeDivisions: updatedDivisions
  };

  return saveTournamentToSupabase(updatedTournament);
}
