// ============================================================
// QuestLog — Delete Account Edge Function
// Requires the service role key (safe here — server-side only)
//
// DEPLOY:
//   supabase login
//   supabase link --project-ref dmehwmnnplzxmjazgyun
//   supabase functions deploy delete-account
//
// The function is called from the app with the user's JWT.
// It deletes all their data then removes their auth.users row.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Verify the user's JWT with the anon client
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userId = user.id
  const userIdStr = userId // used for text-type user_id columns

  // Admin client — can delete from auth.users
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // 1. Delete child rows first (tables with FK references to tasks/rewards)
    await Promise.all([
      supabaseAdmin.from('completions').delete().eq('user_id', userIdStr),
      supabaseAdmin.from('habits').delete().eq('user_id', userIdStr),
      supabaseAdmin.from('reward_redemptions').delete().eq('user_id', userIdStr),
    ])

    // 2. Delete parent rows
    await Promise.all([
      supabaseAdmin.from('tasks').delete().eq('user_id', userIdStr),
      supabaseAdmin.from('character').delete().eq('user_id', userIdStr),
      supabaseAdmin.from('goals').delete().eq('user_id', userIdStr),
      supabaseAdmin.from('rewards').delete().eq('user_id', userIdStr),
      supabaseAdmin.from('profiles').delete().eq('id', userId),
    ])

    // 3. Delete the auth user — this is the only step requiring service role key
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteError) throw deleteError

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
