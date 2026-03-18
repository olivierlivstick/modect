/**
 * ModectAgent
 *
 * Orchestre le bridge audio bidirectionnel :
 *   LiveKit (bénéficiaire) ↔ OpenAI Realtime API (IA)
 *
 * Cycle de vie :
 *   1. Rejoindre la room LiveKit en tant qu'agent
 *   2. Connecter OpenAI Realtime API
 *   3. Abonner aux tracks audio du bénéficiaire → piper vers OpenAI
 *   4. Recevoir l'audio IA depuis OpenAI → publier dans LiveKit
 *   5. À la fin (timeout / déconnexion) : sauvegarder transcript + appeler generate-summary
 */

import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
  AudioSource,
  LocalAudioTrack,
  AudioFrame,
} from '@livekit/rtc-node'
import { createClient } from '@supabase/supabase-js'
import { OpenAIRealtimeClient } from './openai-realtime.js'

export interface AgentConfig {
  callId:             string
  roomName:           string
  agentToken:         string
  systemPrompt:       string
  maxDurationMinutes: number
  livekitUrl:         string
  openAIKey:          string
  supabaseUrl:        string
  supabaseServiceKey: string
}

// Format audio pour OpenAI Realtime API
const SAMPLE_RATE    = 24000  // Hz (OpenAI Realtime attend 24kHz)
const NUM_CHANNELS   = 1      // Mono
const SAMPLES_PER_MS = SAMPLE_RATE / 1000

export class ModectAgent {
  private config:       AgentConfig
  private room:         Room
  private openai:       OpenAIRealtimeClient
  private supabase:     ReturnType<typeof createClient>
  private audioSource:  AudioSource
  private agentTrack:   LocalAudioTrack | null = null
  private startedAt:    Date | null = null
  private endTimer:     NodeJS.Timeout | null = null
  private audioQueue:   Buffer[] = []
  private isPlayingAI   = false

  constructor(config: AgentConfig) {
    this.config   = config
    this.room     = new Room()
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceKey)
    this.openai   = new OpenAIRealtimeClient({
      apiKey:       config.openAIKey,
      systemPrompt: config.systemPrompt,
      voice:        'nova',    // surclassé par le profil bénéficiaire via systemPrompt
      language:     'fr',
    })
    this.audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
  }

  async run(): Promise<void> {
    console.log(`[Agent ${this.config.callId}] Démarrage`)

    try {
      // 1. Connecter OpenAI Realtime
      await this.openai.connect()
      this._setupOpenAIHandlers()

      // 2. Rejoindre la room LiveKit
      await this.room.connect(this.config.livekitUrl, this.config.agentToken)
      console.log(`[Agent ${this.config.callId}] Connecté à la room ${this.config.roomName}`)

      // 3. Publier le track audio de l'agent vers les participants
      this.agentTrack = new LocalAudioTrack(this.audioSource)
      await this.room.localParticipant?.publishTrack(this.agentTrack, {
        name: 'agent-audio',
        source: Track.Source.Microphone,
      })

      // 4. Mettre à jour le call
      this.startedAt = new Date()
      await this.supabase
        .from('calls')
        .update({ status: 'in_progress', started_at: this.startedAt.toISOString() })
        .eq('id', this.config.callId)

      // 5. Brancher les participants déjà présents
      for (const [, participant] of this.room.remoteParticipants) {
        this._handleParticipant(participant)
      }

      // 6. Écouter les nouveaux participants
      this.room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          this._bridgeAudioFromUser(track, participant)
        }
      })

      // 7. Déconnexion du bénéficiaire → fin d'appel
      this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (!participant.identity.startsWith('agent-')) {
          console.log(`[Agent] Bénéficiaire déconnecté: ${participant.identity}`)
          this._endCall('user_left')
        }
      })

      // 8. Timer de durée maximale
      const maxMs = this.config.maxDurationMinutes * 60 * 1000
      this.endTimer = setTimeout(() => {
        console.log(`[Agent ${this.config.callId}] Timeout (${this.config.maxDurationMinutes} min)`)
        this._gracefulGoodbye()
      }, maxMs)

      // Attendre la fin de la room
      await new Promise<void>((resolve) => {
        this.room.on(RoomEvent.Disconnected, () => resolve())
      })

    } catch (err) {
      console.error(`[Agent ${this.config.callId}] Erreur:`, err)
      await this._endCall('error')
    }
  }

  // --- Bridge audio LiveKit → OpenAI ---

  private _handleParticipant(participant: RemoteParticipant) {
    for (const [, publication] of participant.trackPublications) {
      if (publication.track && publication.kind === Track.Kind.Audio) {
        this._bridgeAudioFromUser(publication.track as RemoteTrack, participant)
      }
    }
  }

  private _bridgeAudioFromUser(track: RemoteTrack, participant: RemoteParticipant) {
    if (track.kind !== Track.Kind.Audio) return
    console.log(`[Agent] Bridge audio depuis: ${participant.identity}`)

    const audioStream = track.getAudioStream(SAMPLE_RATE, NUM_CHANNELS)

    // Lire les frames audio et les envoyer à OpenAI
    ;(async () => {
      for await (const frame of audioStream) {
        // frame.data est un Int16Array (PCM16)
        const pcm16 = Buffer.from(frame.data.buffer)
        this.openai.sendAudio(pcm16)
      }
    })().catch((err) => {
      console.error('[Agent] Erreur lecture audio utilisateur:', err)
    })
  }

  // --- Bridge audio OpenAI → LiveKit ---

  private _setupOpenAIHandlers() {
    // Recevoir audio IA et le mettre en queue
    this.openai.on('audio', (chunk: Buffer) => {
      this.audioQueue.push(chunk)
      if (!this.isPlayingAI) this._drainAudioQueue()
    })

    this.openai.on('audio_done', () => {
      this.isPlayingAI = false
    })

    // Interruption si l'utilisateur reprend la parole
    this.openai.on('speech_started', () => {
      this.audioQueue = []
      this.isPlayingAI = false
    })

    this.openai.on('error', (err: unknown) => {
      console.error('[Agent] Erreur OpenAI:', err)
    })

    this.openai.on('disconnected', () => {
      this._endCall('openai_disconnected')
    })
  }

  private async _drainAudioQueue() {
    this.isPlayingAI = true
    while (this.audioQueue.length > 0 && this.isPlayingAI) {
      const chunk = this.audioQueue.shift()!
      await this._publishAudioChunk(chunk)
    }
    this.isPlayingAI = false
  }

  private async _publishAudioChunk(pcm16: Buffer): Promise<void> {
    // Convertir Buffer PCM16 en Int16Array pour AudioFrame
    const samples = new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength / 2)
    const durationMs = Math.floor((samples.length / SAMPLE_RATE) * 1000)

    const frame = new AudioFrame(
      samples,
      SAMPLE_RATE,
      NUM_CHANNELS,
      samples.length,
    )

    await this.audioSource.captureFrame(frame)

    // Petit délai pour suivre le rythme de lecture
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
  }

  // --- Fin d'appel ---

  private async _gracefulGoodbye() {
    // Laisser l'IA conclure naturellement
    // On envoie un message système d'instruction de conclusion
    // puis on attend 30s avant de forcer la fin
    console.log(`[Agent ${this.config.callId}] Conclusion naturelle...`)
    setTimeout(() => this._endCall('timeout'), 30_000)
  }

  private async _endCall(reason: string) {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null }

    console.log(`[Agent ${this.config.callId}] Fin d'appel (${reason})`)

    const endedAt     = new Date()
    const durationSec = this.startedAt
      ? Math.floor((endedAt.getTime() - this.startedAt.getTime()) / 1000)
      : 0

    try {
      // Sauvegarder le transcript
      await this.supabase
        .from('calls')
        .update({
          status:           reason === 'error' ? 'failed' : 'completed',
          ended_at:         endedAt.toISOString(),
          duration_seconds: durationSec,
          transcript:       this.openai.transcript,
        })
        .eq('id', this.config.callId)

      // Déclencher generate-summary si l'appel a eu lieu
      if (reason !== 'error' && this.openai.transcript.length > 0) {
        await this._triggerSummary()
      }
    } catch (err) {
      console.error(`[Agent] Erreur lors de la fin d'appel:`, err)
    } finally {
      this.openai.disconnect()
      try { await this.room.disconnect() } catch (_) { /* ignore */ }
    }
  }

  private async _triggerSummary() {
    const { data: { session } } = await this.supabase.auth.getSession()
    const supabaseUrl = this.config.supabaseUrl

    await fetch(`${supabaseUrl}/functions/v1/generate-summary`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.supabaseServiceKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ call_id: this.config.callId }),
    })
  }
}
