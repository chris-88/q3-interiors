import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { toApiError } from './errors'

export type SessionState = { status: 'loading' } | { status: 'ready'; session: Session | null }

/** The current Supabase session, kept in step with sign-in, sign-out and token refresh. */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  useEffect(() => {
    let active = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState({ status: 'ready', session: data.session })
      })
      .catch(() => {
        if (active) setState({ status: 'ready', session: null })
      })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ status: 'ready', session })
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])
  return state
}

const staffSchema = z.object({
  user_id: z.string(),
  role: z.enum(['admin', 'staff']),
  display_name: z.string(),
})

export type StaffMember = z.infer<typeof staffSchema>

/** The signed-in user's staff row, or null when they are not on the allowlist. */
export function useStaffMember(userId: string | undefined) {
  return useQuery({
    queryKey: ['staff', userId],
    enabled: userId !== undefined,
    queryFn: async (): Promise<StaffMember | null> => {
      const { data, error } = await supabase
        .from('staff')
        .select('user_id, role, display_name')
        .eq('user_id', userId ?? '')
        .maybeSingle()
      if (error) throw toApiError(error)
      return data === null ? null : staffSchema.parse(data)
    },
  })
}

export const signInSchema = z.object({
  email: z.email('Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

export type SignInInput = z.infer<typeof signInSchema>

export function useSignIn() {
  return useMutation({
    mutationFn: async (input: SignInInput) => {
      const { error } = await supabase.auth.signInWithPassword(input)
      if (error) throw toApiError(error)
    },
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw toApiError(error)
    },
    onSettled: () => queryClient.clear(),
  })
}
