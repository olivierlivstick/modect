import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import { Button } from '@/components/ui/Button'
import { Label } from '@/components/ui/Label'
import { Textarea } from '@/components/ui/Textarea'

const MODELS = [
  { id: 'gpt-4o-realtime-preview',              label: 'GPT-4o Realtime — dernière version (recommandé)' },
  { id: 'gpt-4o-realtime-preview-2024-12-17',   label: 'GPT-4o Realtime — décembre 2024' },
  { id: 'gpt-4o-mini-realtime-preview',          label: 'GPT-4o Mini Realtime — rapide & économique' },
  { id: 'gpt-4o-mini-realtime-preview-2024-12-17', label: 'GPT-4o Mini Realtime — décembre 2024' },
]

export function SetupPage() {
  const { profile, user } = useAuth()
  const { updateProfile, loading } = useProfile()

  const [model, setModel] = useState(profile?.agent_model ?? 'gpt-4o-realtime-preview')
  const [extraPrompt, setExtraPrompt] = useState(profile?.agent_extra_prompt ?? '')
  const [success, setSuccess] = useState(false)

  const handleSave = async () => {
    if (!user) return
    const ok = await updateProfile(user.id, {
      agent_model: model,
      agent_extra_prompt: extraPrompt.trim() || null,
    })
    if (ok) {
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="font-title text-3xl font-bold text-slate-800 mb-1">Setup IA</h1>
      <p className="text-slate-500 mb-8">Configurez le modèle et les instructions globales de l'agent</p>

      <div className="space-y-6">
        {/* Modèle */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="font-semibold text-slate-700 mb-1">Modèle OpenAI Realtime</h2>
          <p className="text-sm text-slate-400 mb-4">
            Chaque modèle a des caractéristiques différentes en termes de qualité, latence et coût.
          </p>
          <Label htmlFor="model">Modèle</Label>
          <select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 font-body text-base text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-2">
            Modèle actuel enregistré : <span className="font-mono">{profile?.agent_model ?? 'gpt-4o-realtime-preview'}</span>
          </p>
        </div>

        {/* Prompt supplémentaire */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="font-semibold text-slate-700 mb-1">Instructions supplémentaires</h2>
          <p className="text-sm text-slate-400 mb-4">
            Ces instructions sont ajoutées au prompt de chaque appel, avant le profil du bénéficiaire.
            Utilisez-les pour tester des comportements, ajuster le ton, ou définir des règles globales.
          </p>
          <Label htmlFor="extra_prompt">Instructions (optionnel)</Label>
          <Textarea
            id="extra_prompt"
            value={extraPrompt}
            onChange={(e) => setExtraPrompt(e.target.value)}
            placeholder="Ex : Réponds toujours de manière très courte. Pose une question à la fin de chaque réponse. Ne mentionne jamais les nouvelles ou la politique."
            rows={6}
            className="mt-1 font-mono text-sm"
          />
          <p className="text-xs text-slate-400 mt-2">{extraPrompt.length} caractères</p>
        </div>

        {success && (
          <p className="text-sm text-green-600 bg-green-50 rounded-xl px-4 py-3">
            ✓ Configuration enregistrée — active dès le prochain appel
          </p>
        )}

        <Button onClick={handleSave} loading={loading}>
          Enregistrer
        </Button>
      </div>
    </div>
  )
}
