import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('A conexão do sistema não foi configurada. Confira as variáveis Supabase.');
  return { url, key };
}
let browserClient: SupabaseClient | undefined;
export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === 'undefined') throw new Error('O cliente de sessão só pode ser utilizado no navegador.');
  if (!browserClient) {
    const {url, key} = getSupabaseConfig();
    browserClient = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }
  return browserClient;
}
export const getSupabaseClient = getSupabaseBrowserClient;
