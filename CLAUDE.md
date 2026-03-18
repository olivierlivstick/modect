# MODECT — Guide Claude Code

## Contexte
SaaS de compagnon conversationnel IA pour personnes âgées/isolées.
- **Aidant** (caregiver) : dashboard web, crée les bénéficiaires, configure les sessions, lit les rapports
- **Bénéficiaire** : reçoit des appels vocaux IA sur l'app mobile Expo

## Stack technique
| Composant | Technologie |
|-----------|------------|
| Dashboard web | React 18 + Vite + TypeScript + TailwindCSS |
| App mobile | Expo (React Native) |
| Base de données | Supabase (PostgreSQL + RLS + Auth) |
| Edge Functions | Supabase (Deno) |
| Voix temps réel | LiveKit Cloud + OpenAI Realtime API (gpt-4o-realtime-preview) |
| Agent Node.js | `apps/agent/` — Express + `@livekit/rtc-node` + `openai` |
| Emails | Resend |
| Déploiement web | Netlify |
| Déploiement agent | Railway (Docker) |

## Structure monorepo
```
modect/
├── apps/
│   ├── web/          # Dashboard aidant (React + Vite)
│   ├── mobile/       # App bénéficiaire (Expo)
│   └── agent/        # Service Node.js LiveKit ↔ OpenAI
├── supabase/
│   ├── migrations/   # 7 migrations SQL
│   └── functions/    # 5 Edge Functions Deno
└── packages/
    └── shared/       # Types TypeScript partagés
```

## Base de données (tables principales)
- `profiles` — extension de auth.users (trigger `handle_new_user`)
- `beneficiaries` — profil bénéficiaire + config IA
- `session_schedules` — planification récurrente (jours + heure)
- `calls` — historique des appels + transcript + rapport
- `conversation_memory` — mémoire long-terme par bénéficiaire

## Architecture critique : pourquoi apps/agent existe
`@livekit/rtc-node` est un addon natif Rust/Node.js — **impossible à faire tourner dans Deno Edge Functions**. L'Edge Function `realtime-agent` délègue donc en fire-and-forget au service Node.js Railway via `AGENT_SERVICE_URL`.

## Variables d'environnement

### apps/web (.env)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=      # clé publique anon
VITE_APP_URL=
```

### Supabase Edge Functions Secrets
```
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=
OPENAI_API_KEY=
RESEND_API_KEY=
FROM_EMAIL=
AGENT_SERVICE_URL=           # URL Railway
```

### apps/agent (Railway Variables)
```
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Déploiement
- **Netlify** : lit `netlify.toml` à la racine (base = `apps/web`)
- **Railway** : lit `railway.toml` à la racine, Dockerfile = `apps/agent/Dockerfile`
- **Supabase** : `supabase link --project-ref XXX` puis `supabase functions deploy`
- **pg_cron** : cron toutes les minutes → appelle `schedule-calls` via `pg_net`

## Bugs connus et fixes appliqués
- `handle_new_user()` trigger : doit avoir `SET search_path = public` sinon "relation profiles does not exist"
- `formatDate()` dans utils.ts : `dateStyle` incompatible avec options individuelles (`weekday`, `hour`...) — utiliser `options ?? { dateStyle: 'long' }`
- `@modect/shared` dans le web : résolu via alias Vite + paths TypeScript dans tsconfig
- Build Netlify : utiliser `vite build` sans `tsc` (types Supabase incomplets génèrent des `never`)
- `@livekit/rtc-node` dans agent.ts : utiliser `TrackKind.KIND_AUDIO`, `AudioStream`, pas `Track.Kind` ni `track.getAudioStream()`

## Identité visuelle
- **Couleurs** : `#2D6A9F` (bleu confiance) + `#F4A261` (orange chaleur)
- **Polices** : Playfair Display (titres) + Source Sans 3 (corps)
- **Baseline** : "La présence qui réchauffe"
- **Accessibilité mobile** : police ≥ 18px, boutons ≥ 72px, pas de gestes complexes

## Commandes utiles
```bash
# Dev web
cd apps/web && npm run dev

# Dev agent
cd apps/agent && npm run dev

# Déployer les fonctions Supabase
supabase functions deploy schedule-calls
supabase functions deploy initiate-call
supabase functions deploy realtime-agent
supabase functions deploy generate-summary
supabase functions deploy livekit-webhook

# Push migrations
supabase db push
```
