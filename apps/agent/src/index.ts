/**
 * MODECT Agent Service
 *
 * Service Node.js qui reçoit les demandes de lancement d'agent depuis
 * l'Edge Function realtime-agent, puis gère le bridge audio
 * LiveKit ↔ OpenAI Realtime API pour toute la durée de l'appel.
 */

import express from 'express'
import { ModectAgent } from './agent.js'

const app  = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

app.use(express.json())

// Healthcheck
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

/**
 * POST /start-agent
 * Lancé en fire-and-forget par l'Edge Function initiate-call (via realtime-agent)
 *
 * Body : {
 *   call_id:              string
 *   room_name:            string
 *   agent_token:          string     — token LiveKit de l'agent
 *   system_prompt:        string
 *   max_duration_minutes: number
 * }
 */
app.post('/start-agent', async (req, res) => {
  const { call_id, room_name, agent_token, system_prompt, max_duration_minutes, model } = req.body

  if (!call_id || !room_name || !agent_token || !system_prompt) {
    res.status(400).json({ error: 'Paramètres manquants' })
    return
  }

  // Répondre immédiatement (l'agent tourne en background)
  res.json({ status: 'started', call_id })

  // Lancer l'agent en async sans bloquer
  const agent = new ModectAgent({
    callId:             call_id,
    roomName:           room_name,
    agentToken:         agent_token,
    systemPrompt:       system_prompt,
    maxDurationMinutes: max_duration_minutes ?? 15,
    model:              model ?? 'gpt-4o-realtime-preview',
    livekitUrl:         process.env.LIVEKIT_URL!,
    openAIKey:          process.env.OPENAI_API_KEY!,
    supabaseUrl:        process.env.SUPABASE_URL!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  })

  agent.run().catch((err) => {
    console.error(`[Agent ${call_id}] Erreur fatale:`, err)
  })
})

app.listen(PORT, () => {
  console.log(`🎙️  MODECT Agent Service démarré sur le port ${PORT}`)
})
