/**
 * Génération de tokens LiveKit via JWT (Web Crypto API — compatible Deno)
 * Doc : https://docs.livekit.io/realtime/concepts/authentication/
 */

// Encode base64url (sans padding)
function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function signHS256(payload: object, secret: string): Promise<string> {
  const header  = { alg: 'HS256', typ: 'JWT' }
  const enc     = new TextEncoder()

  const headerB64  = base64url(enc.encode(JSON.stringify(header)).buffer)
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)).buffer)
  const sigInput   = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sigInput))
  return `${sigInput}.${base64url(sig)}`
}

export interface LiveKitGrants {
  roomCreate?: boolean
  roomJoin?:   boolean
  room?:       string
  canPublish?: boolean
  canSubscribe?: boolean
  canPublishData?: boolean
  hidden?: boolean
  recorder?: boolean
}

export async function generateLiveKitToken(
  apiKey: string,
  apiSecret: string,
  identity: string,
  grants: LiveKitGrants,
  ttlSeconds = 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: apiKey,
    sub: identity,
    iat: now,
    exp: now + ttlSeconds,
    nbf: now,
    video: grants,
  }
  return signHS256(payload, apiSecret)
}

export interface CreateRoomOptions {
  name: string
  emptyTimeout?: number      // secondes avant destruction si vide (défaut : 300)
  maxParticipants?: number
  metadata?: string
}

/**
 * Crée une room LiveKit via l'API REST Twirp
 */
export async function createLiveKitRoom(
  livekitUrl: string,
  apiKey: string,
  apiSecret: string,
  options: CreateRoomOptions,
): Promise<{ sid: string; name: string }> {
  // Token admin avec roomCreate
  const token = await generateLiveKitToken(apiKey, apiSecret, 'server', {
    roomCreate: true,
  }, 300)

  // Convertir wss:// → https://
  const httpUrl = livekitUrl.replace(/^wss?:\/\//, 'https://')

  const res = await fetch(`${httpUrl}/twirp/livekit.RoomService/CreateRoom`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name:              options.name,
      empty_timeout:     options.emptyTimeout ?? 300,
      max_participants:  options.maxParticipants ?? 2,
      metadata:          options.metadata ?? '',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LiveKit CreateRoom failed: ${res.status} ${text}`)
  }

  const data = await res.json()
  return { sid: data.sid, name: data.name }
}
