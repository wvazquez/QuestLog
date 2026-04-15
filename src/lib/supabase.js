import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://dmehwmnnplzxmjazgyun.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Fs7rxMuHLz1SzZj1iB_xuw_jhwX6lYF'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})
