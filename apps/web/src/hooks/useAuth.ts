import { useEffect, useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@modect/shared'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: true,
  })

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    return data as Profile | null
  }, [])

  useEffect(() => {
    // Timeout de sécurité : force loading=false après 5s
    const timeout = setTimeout(() => {
      setState((prev) => prev.loading ? { ...prev, loading: false } : prev)
    }, 5000)

    // Récupérer la session initiale
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(timeout)
      const profile = session?.user ? await fetchProfile(session.user.id) : null
      setState({ session, user: session?.user ?? null, profile, loading: false })
    })

    // Écouter les changements d'auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const profile = session?.user ? await fetchProfile(session.user.id) : null
        setState({ session, user: session?.user ?? null, profile, loading: false })
      }
    )

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return { ...state, signOut }
}
