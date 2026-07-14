import { createClient } from '@supabase/supabase-js';

const metaEnv = (import.meta as any).env || {};
let supabaseUrl = (metaEnv.VITE_SUPABASE_URL || '').trim();
let supabaseAnonKey = (metaEnv.VITE_SUPABASE_ANON_KEY || metaEnv.VITE_SUPABASE_ANON || metaEnv.VITE_SUPABASE_ANO || '').trim();

const isPlaceholder = (val: string) => {
  const v = val.toLowerCase();
  return !v || 
         v.includes('placeholder') || 
         v.includes('your_supabase') || 
         v.includes('your-project') || 
         v.includes('your_') ||
         v.includes('project_url') ||
         v.includes('anon_public_key');
};

// Fallback to the user's specific Supabase project credentials if environment variables are not set or are placeholders
if (!supabaseUrl || isPlaceholder(supabaseUrl)) {
  supabaseUrl = 'https://awvwmveuoamqnbihzrsw.supabase.co';
}
if (!supabaseAnonKey || isPlaceholder(supabaseAnonKey)) {
  supabaseAnonKey = 'sb_publishable_DK-VNwKsaq-WfBdPJ_46rQ_XvLXs_hd';
}

export const isSupabaseConfigured = !!(
  supabaseUrl && 
  supabaseAnonKey && 
  !isPlaceholder(supabaseUrl) && 
  !isPlaceholder(supabaseAnonKey) &&
  supabaseUrl.startsWith('http')
);

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are not set. The application will run in offline/localStorage (Demo Mode).'
  );
}

// Initialize the Supabase client safely.
// If variables are missing, we pass dummy values so createClient does not throw on initial bundle parse,
// but we check isSupabaseConfigured before performing any actual requests.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project-id.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);
