/**
 * Page de simulation d'appel — rejoindre une room LiveKit depuis le navigateur
 * Accès : /call?token=XXX&room=XXX&url=XXX&persona=XXX
 */

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  LiveKitRoom,
  useVoiceAssistant,
  RoomAudioRenderer,
  useRoomContext,
} from '@livekit/components-react'

export function SimulateCallPage() {
  const [params] = useSearchParams()
  const navigate  = useNavigate()

  const token      = params.get('token')    ?? ''
  const serverUrl  = params.get('url')      ?? ''
  const personaName = params.get('persona') ?? 'Marie'

  if (!token || !serverUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <p>Paramètres manquants (token ou url)</p>
      </div>
    )
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect={true}
      audio={true}
      video={false}
      onDisconnected={() => navigate(-1)}
      className="min-h-screen bg-slate-900"
    >
      <RoomAudioRenderer />
      <CallUI personaName={personaName} onHangUp={() => navigate(-1)} />
    </LiveKitRoom>
  )
}

function CallUI({ personaName, onHangUp }: { personaName: string; onHangUp: () => void }) {
  const room = useRoomContext()
  const { state: agentState } = useVoiceAssistant()
  const [duration, setDuration] = useState(0)

  // Chrono
  useEffect(() => {
    const t = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const isSpeaking = agentState === 'speaking'

  const handleHangUp = () => {
    room.disconnect()
    onHangUp()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-slate-900 text-white px-4">

      {/* Avatar animé */}
      <div className="relative flex items-center justify-center">
        {isSpeaking && (
          <>
            <div className="absolute w-40 h-40 rounded-full bg-blue-500/20 animate-ping" />
            <div className="absolute w-52 h-52 rounded-full bg-blue-500/10 animate-pulse" />
          </>
        )}
        <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-2xl">
          <span className="text-5xl">🎙️</span>
        </div>
      </div>

      {/* Nom + statut */}
      <div className="text-center">
        <h1 className="text-3xl font-bold">{personaName}</h1>
        <p className="text-slate-400 mt-1">
          {isSpeaking ? '🗣 En train de parler…' : '👂 En train d\'écouter…'}
        </p>
        <p className="text-slate-500 text-sm mt-2 font-mono">{formatDuration(duration)}</p>
      </div>

      {/* Indicateur micro */}
      <div className="flex items-center gap-2 bg-slate-800 rounded-full px-4 py-2 text-sm text-slate-300">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        Microphone actif
      </div>

      {/* Bouton raccrocher */}
      <button
        onClick={handleHangUp}
        className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 flex items-center justify-center shadow-lg transition-colors"
        title="Raccrocher"
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
          <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
        </svg>
      </button>

      <p className="text-slate-600 text-xs">Simulation MODECT — mode test</p>
    </div>
  )
}
