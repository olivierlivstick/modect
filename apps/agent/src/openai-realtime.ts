/**
 * Client OpenAI Realtime API
 *
 * Gère la connexion WebSocket avec gpt-4o-realtime-preview,
 * l'injection du system prompt, l'envoi/réception d'audio PCM16,
 * et la collecte des transcriptions.
 *
 * Doc : https://platform.openai.com/docs/guides/realtime
 */

import WebSocket from 'ws'
import { EventEmitter } from 'events'

export interface RealtimeConfig {
  apiKey:       string
  systemPrompt: string
  voice:        string   // alloy | echo | fable | onyx | nova | shimmer
  language:     string   // fr | en | ...
  model:        string   // gpt-4o-realtime-preview | gpt-4o-mini-realtime-preview | ...
}

export interface TranscriptEntry {
  role:      'user' | 'assistant'
  text:      string
  timestamp: string
}

export class OpenAIRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null
  private config: RealtimeConfig
  public transcript: TranscriptEntry[] = []
  private currentAssistantText = ''

  constructor(config: RealtimeConfig) {
    super()
    this.config = config
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.config.model}`

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'OpenAI-Beta':   'realtime=v1',
        },
      })

      this.ws.once('open', () => {
        console.log('[OpenAI Realtime] Connecté')
        this._initSession()
        resolve()
      })

      this.ws.once('error', (err) => reject(err))

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString())
          this._handleEvent(event)
        } catch (e) {
          console.error('[OpenAI Realtime] Parse error:', e)
        }
      })

      this.ws.on('close', (code, reason) => {
        console.log(`[OpenAI Realtime] Déconnecté (${code}): ${reason}`)
        this.emit('disconnected')
      })
    })
  }

  private _initSession() {
    // Configurer la session : system prompt, voix, format audio
    this._send({
      type: 'session.update',
      session: {
        instructions:          this.config.systemPrompt,
        voice:                 this.config.voice,
        input_audio_format:    'pcm16',
        output_audio_format:   'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: {
          type:              'server_vad',
          threshold:         0.5,
          prefix_padding_ms: 200,
          silence_duration_ms: 400,
        },
        modalities: ['text', 'audio'],
        temperature: 0.8,
        max_response_output_tokens: 1024,
      },
    })
  }

  /**
   * Envoyer un chunk audio PCM16 (depuis LiveKit) vers OpenAI
   * @param pcm16 - Buffer PCM16 16kHz mono
   */
  sendAudio(pcm16: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this._send({
      type:  'input_audio_buffer.append',
      audio: pcm16.toString('base64'),
    })
  }

  /**
   * Signaler la fin d'un tour de parole utilisateur
   */
  commitAudio(): void {
    this._send({ type: 'input_audio_buffer.commit' })
    this._send({ type: 'response.create' })
  }

  private _handleEvent(event: Record<string, unknown>) {
    switch (event.type) {

      // Audio généré par l'IA → à publier dans LiveKit
      case 'response.audio.delta': {
        const audio = Buffer.from(event.delta as string, 'base64')
        this.emit('audio', audio)
        break
      }

      // Fin d'un bloc audio IA
      case 'response.audio.done': {
        this.emit('audio_done')
        break
      }

      // Transcription de ce que dit l'utilisateur
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (event.transcript as string)?.trim()
        if (text) {
          const entry: TranscriptEntry = {
            role:      'user',
            text,
            timestamp: new Date().toISOString(),
          }
          this.transcript.push(entry)
          this.emit('transcript', entry)
          console.log(`[User] ${text}`)
        }
        break
      }

      // Transcription de ce que dit l'IA (streaming)
      case 'response.audio_transcript.delta': {
        this.currentAssistantText += (event.delta as string) ?? ''
        break
      }

      // Fin de la réponse texte de l'IA
      case 'response.audio_transcript.done': {
        const text = this.currentAssistantText.trim()
        if (text) {
          const entry: TranscriptEntry = {
            role:      'assistant',
            text,
            timestamp: new Date().toISOString(),
          }
          this.transcript.push(entry)
          this.emit('transcript', entry)
          console.log(`[Agent] ${text}`)
        }
        this.currentAssistantText = ''
        break
      }

      // Erreur OpenAI
      case 'error': {
        console.error('[OpenAI Realtime] Erreur:', event.error)
        this.emit('error', event.error)
        break
      }

      // VAD : début de parole utilisateur (interrompre l'audio IA en cours)
      case 'input_audio_buffer.speech_started': {
        this._send({ type: 'response.cancel' })
        this.emit('speech_started')
        break
      }

      case 'input_audio_buffer.speech_stopped': {
        this.emit('speech_stopped')
        break
      }
    }
  }

  private _send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}
