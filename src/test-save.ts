import { createClient } from '@supabase/supabase-js';
import { saveTournamentToSupabase } from './services/tournamentService';
import { Tournament } from './types';

const supabaseUrl = 'https://awvwmveuoamqnbihzrsw.supabase.co';
const supabaseAnonKey = 'sb_publishable_DK-VNwKsaq-WfBdPJ_46rQ_XvLXs_hd';

// We need to set the environment variable or global state so saveTournamentToSupabase thinks it's configured
process.env.VITE_SUPABASE_URL = supabaseUrl;
process.env.VITE_SUPABASE_ANON_KEY = supabaseAnonKey;

// We need to log in first as admin@gmail.com
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log('Logging in as admin@gmail.com...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'admin@gmail.com',
    password: 'password123' // Or whatever password was used
  });

  if (authError) {
    console.error('Auth error:', authError);
    // Let's try to sign up or use session directly if we can't login
    return;
  }

  console.log('Logged in successfully, user ID:', authData.user?.id);

  const mockTournament: Tournament = {
    id: `t-fresh-${Date.now()}`,
    name: 'Turnamen Pickleball Baru',
    date: '2026-07-14',
    location: '',
    events: [
      { id: 'ev-gp-123', name: 'Ganda Putra', isDouble: true }
    ],
    ageGroups: [
      { id: 'ag-open-123', name: 'Open/Bebas' }
    ],
    activeDivisions: []
  };

  console.log('Saving mock tournament...');
  const success = await saveTournamentToSupabase(mockTournament);
  console.log('Save result:', success);
  if (!success) {
    console.error('Last error:', (global as any).lastSupabaseError || 'No error details recorded on global');
  }
}

run().catch(err => {
  console.error('Unhandled error in script:', err);
});
