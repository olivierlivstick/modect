/**
 * Edge Function: realtime-agent
 *
 * Thin launcher : reçoit les paramètres d'appel depuis initiate-call
 * et les transmet au service Node.js apps/agent/ qui gère le bridge audio.
 *
 * Architecture :
 *   initiate-call (Edge Function)
 *     └─► realtime-agent (Edge Function)   ← cette fonction
 *              └─► apps/agent (Node.js)     ← bridge audio LiveKit ↔ OpenAI
 */

import { corsHeaders, handleCors } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const body = await req.json()
    const { call_id, room_name, agent_token, system_prompt, max_duration_minutes } = body

    if (!call_id || !room_name || !agent_token || !system_prompt) {
      return new Response(
        JSON.stringify({ error: 'Paramètres manquants' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // URL du service agent Node.js (configurable par variable d'env)
    const agentServiceUrl = Deno.env.get('AGENT_SERVICE_URL')

    if (!agentServiceUrl) {
      // Mode dev local : log et retourner un succès simulé
      console.warn('[realtime-agent] AGENT_SERVICE_URL non défini — mode simulation')
      console.log(`[realtime-agent] Would start agent for call ${call_id} in room ${room_name}`)
      return new Response(
        JSON.stringify({ status: 'simulated', call_id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Déléguer au service Node.js (fire-and-forget)
    fetch(`${agentServiceUrl}/start-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call_id,
        room_name,
        agent_token,
        system_prompt,
        max_duration_minutes: max_duration_minutes ?? 15,
      }),
    }).catch((err) => console.error('[realtime-agent] Failed to reach agent service:', err))

    return new Response(
      JSON.stringify({ status: 'dispatched', call_id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('[realtime-agent] Erreur:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur interne' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
