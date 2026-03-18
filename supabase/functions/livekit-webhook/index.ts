/**
 * Edge Function: livekit-webhook
 *
 * Rôle : Recevoir et traiter les événements LiveKit
 * Événements gérés :
 *   - room_finished       → mettre à jour ended_at + duration_seconds
 *   - participant_left    → si c'est le bénéficiaire, déclencher fin propre
 *
 * Sécurité : vérification de la signature HMAC-SHA256 de LiveKit
 * verify_jwt: false (webhook externe)
 *
 * Doc : https://docs.livekit.io/realtime/server/webhooks/
 */

import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts'

// Vérification signature LiveKit (HMAC-SHA256 sur le body)
async function verifyLiveKitSignature(
  body:      string,
  signature: string,
  secret:    string,
): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const sigBytes = hexToBytes(signature)
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const bodyText  = await req.text()
  const signature = req.headers.get('LiveKit-Signature') ?? ''
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')!

  // Vérifier la signature
  const valid = await verifyLiveKitSignature(bodyText, signature, apiSecret)
  if (!valid) {
    console.warn('[livekit-webhook] Signature invalide')
    return new Response('Unauthorized', { status: 401 })
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(bodyText)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const eventType = event.event as string
  console.log(`[livekit-webhook] Événement reçu: ${eventType}`)

  const supabase = getSupabaseAdmin()

  try {
    switch (eventType) {

      // --- Room terminée ---
      case 'room_finished': {
        const room     = event.room as Record<string, unknown>
        const roomName = room?.name as string
        if (!roomName) break

        const endedAt     = new Date()
        const createdAt   = room.creation_time
          ? new Date((room.creation_time as number) * 1000)
          : null
        const durationSec = createdAt
          ? Math.floor((endedAt.getTime() - createdAt.getTime()) / 1000)
          : null

        const { error } = await supabase
          .from('calls')
          .update({
            ended_at:         endedAt.toISOString(),
            duration_seconds: durationSec,
            // Ne pas écraser un status déjà 'completed' posé par l'agent
          })
          .eq('livekit_room_name', roomName)
          .in('status', ['in_progress', 'notified', 'scheduled'])

        if (error) {
          console.error('[livekit-webhook] room_finished update error:', error.message)
        } else {
          console.log(`[livekit-webhook] room_finished: ${roomName} — durée ${durationSec}s`)
        }
        break
      }

      // --- Participant a quitté ---
      case 'participant_left': {
        const room        = event.room        as Record<string, unknown>
        const participant = event.participant as Record<string, unknown>
        const roomName    = room?.name        as string
        const identity    = participant?.identity as string

        if (!roomName || !identity) break

        // Ignorer si c'est l'agent qui quitte (géré côté agent service)
        if (identity.startsWith('agent-')) {
          console.log(`[livekit-webhook] Agent ${identity} a quitté ${roomName}`)
          break
        }

        // C'est le bénéficiaire qui a quitté — vérifier si le call est encore actif
        const { data: call } = await supabase
          .from('calls')
          .select('id, status')
          .eq('livekit_room_name', roomName)
          .in('status', ['in_progress', 'notified'])
          .maybeSingle()

        if (!call) break

        console.log(`[livekit-webhook] Bénéficiaire ${identity} a quitté — call ${call.id}`)

        // Mettre à jour le call si pas encore terminé par l'agent
        await supabase
          .from('calls')
          .update({
            ended_at: new Date().toISOString(),
            status:   'completed',
          })
          .eq('id', call.id)
          .in('status', ['in_progress', 'notified'])

        break
      }

      // --- Participant a rejoint (log uniquement) ---
      case 'participant_joined': {
        const participant = event.participant as Record<string, unknown>
        const room        = event.room        as Record<string, unknown>
        console.log(`[livekit-webhook] ${participant?.identity} rejoint ${room?.name}`)

        // Mettre à jour status → 'in_progress' si c'est le bénéficiaire
        const identity = participant?.identity as string
        const roomName = room?.name as string
        if (identity && !identity.startsWith('agent-') && roomName) {
          await supabase
            .from('calls')
            .update({ status: 'in_progress', started_at: new Date().toISOString() })
            .eq('livekit_room_name', roomName)
            .eq('status', 'notified')
        }
        break
      }

      default:
        console.log(`[livekit-webhook] Événement ignoré: ${eventType}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[livekit-webhook] Erreur traitement:', err)
    // Toujours répondre 200 pour éviter les retries LiveKit
    return new Response(JSON.stringify({ received: true, error: String(err) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
