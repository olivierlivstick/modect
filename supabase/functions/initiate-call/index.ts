/**
 * Edge Function: initiate-call
 *
 * Rôle : Préparer et lancer un appel MODECT
 * Input : { call_id: string }
 *
 * Actions :
 *   1. Récupérer le call + bénéficiaire + mémoires récentes
 *   2. Construire le system prompt IA
 *   3. Créer une room LiveKit
 *   4. Générer tokens LiveKit (user + agent)
 *   5. Mettre à jour calls (status='notified', livekit_room_name)
 *   6. Envoyer la notification push au bénéficiaire
 *   7. Lancer realtime-agent en background
 */

import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { createLiveKitRoom, generateLiveKitToken } from '../_shared/livekit.ts'
import { sendExpoPushNotification } from '../_shared/pushNotification.ts'
import { buildSystemPrompt } from '../_shared/systemPrompt.ts'

Deno.serve(async (req: Request) => {
  // CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // 1. Parse input
    const { call_id } = await req.json() as { call_id: string }
    if (!call_id) {
      return new Response(JSON.stringify({ error: 'call_id requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = getSupabaseAdmin()

    // 2. Récupérer le call
    console.log(`[initiate-call] call_id reçu: ${call_id}`)
    const { data: call, error: callError } = await supabase
      .from('calls')
      .select('*, session_schedules(*)')
      .eq('id', call_id)
      .single()

    console.log(`[initiate-call] call:`, JSON.stringify(call))
    console.log(`[initiate-call] callError:`, JSON.stringify(callError))

    if (callError || !call) {
      return new Response(JSON.stringify({ error: 'Call introuvable', detail: callError?.message }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Récupérer le bénéficiaire
    const { data: beneficiary, error: benError } = await supabase
      .from('beneficiaries')
      .select('*')
      .eq('id', call.beneficiary_id)
      .single()

    if (benError || !beneficiary) {
      throw new Error(`Bénéficiaire introuvable: ${call.beneficiary_id}`)
    }

    // 4. Récupérer les mémoires (triées par importance, les 20 meilleures)
    const { data: memories } = await supabase
      .from('conversation_memory')
      .select('memory_type, content, importance')
      .eq('beneficiary_id', beneficiary.id)
      .order('importance', { ascending: false })
      .limit(20)

    // 5. Récupérer les 5 derniers appels complétés (pour le contexte)
    const { data: recentCalls } = await supabase
      .from('calls')
      .select('ended_at, summary, key_topics')
      .eq('beneficiary_id', beneficiary.id)
      .eq('status', 'completed')
      .order('ended_at', { ascending: false })
      .limit(5)

    // 6. Construire le system prompt
    const schedule = call.session_schedules ?? {
      max_duration_minutes: 15,
      suggested_topics: null,
      special_instructions: null,
    }

    const systemPrompt = buildSystemPrompt(beneficiary, memories ?? [], schedule)

    // 7. Créer la room LiveKit
    const livekitUrl    = Deno.env.get('LIVEKIT_URL')!
    const livekitKey    = Deno.env.get('LIVEKIT_API_KEY')!
    const livekitSecret = Deno.env.get('LIVEKIT_API_SECRET')!

    const roomName = `modect-${call_id}`
    const room = await createLiveKitRoom(livekitUrl, livekitKey, livekitSecret, {
      name:            roomName,
      emptyTimeout:    60, // détruire après 60s vide
      maxParticipants: 2,
      metadata:        JSON.stringify({ call_id, beneficiary_id: beneficiary.id }),
    })

    // 8. Générer le token bénéficiaire (participant "user")
    const userToken = await generateLiveKitToken(
      livekitKey,
      livekitSecret,
      `user-${beneficiary.id}`,
      {
        roomJoin:    true,
        room:        roomName,
        canPublish:  true,
        canSubscribe: true,
      },
      3600,
    )

    // 9. Générer le token agent (participant "agent")
    const agentToken = await generateLiveKitToken(
      livekitKey,
      livekitSecret,
      `agent-${call_id}`,
      {
        roomJoin:    true,
        room:        roomName,
        canPublish:  true,
        canSubscribe: true,
        hidden:      false,
      },
      3600,
    )

    // 10. Mettre à jour le call
    const { error: updateError } = await supabase
      .from('calls')
      .update({
        status:            'notified',
        livekit_room_name: roomName,
        livekit_room_sid:  room.sid,
      })
      .eq('id', call_id)

    if (updateError) throw new Error(`Update call failed: ${updateError.message}`)

    // 11. Envoyer la notification push au bénéficiaire
    if (beneficiary.push_token) {
      await sendExpoPushNotification({
        to:    beneficiary.push_token,
        title: `📞 ${beneficiary.ai_persona_name} vous appelle !`,
        body:  `Votre compagnon ${beneficiary.ai_persona_name} souhaite vous parler. Décrochez !`,
        data:  {
          call_id,
          room_name:   roomName,
          user_token:  userToken,
          livekit_url: livekitUrl,
          persona_name: beneficiary.ai_persona_name,
        },
        priority: 'high',
      })
    } else {
      console.warn(`Bénéficiaire ${beneficiary.id} n'a pas de push_token`)
    }

    // 12. Lancer l'agent Railway directement
    const agentServiceUrl = Deno.env.get('AGENT_SERVICE_URL')

    if (!agentServiceUrl) {
      console.warn('[initiate-call] AGENT_SERVICE_URL non défini — agent non lancé')
    } else {
      try {
        const agentLaunch = await fetch(`${agentServiceUrl}/start-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call_id,
            room_name:            roomName,
            agent_token:          agentToken,
            system_prompt:        systemPrompt,
            max_duration_minutes: schedule.max_duration_minutes ?? 15,
          }),
        })
        console.log(`[initiate-call] agent service status: ${agentLaunch.status}`)
      } catch (err) {
        console.error('[initiate-call] Failed to reach agent service:', err)
      }
    }

    // 13. Réponse succès
    return new Response(
      JSON.stringify({
        success: true,
        call_id,
        room_name:  roomName,
        user_token: userToken,
        livekit_url: livekitUrl,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )

  } catch (err) {
    console.error('initiate-call error:', err)

    // Marquer le call comme failed si possible
    try {
      const body = await req.clone().json().catch(() => ({}))
      if (body.call_id) {
        const supabase = getSupabaseAdmin()
        await supabase.from('calls').update({ status: 'failed' }).eq('id', body.call_id)
      }
    } catch (_) { /* ignore */ }

    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur interne' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
