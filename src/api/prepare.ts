import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { call } from './booking'

/**
 * "Help us prepare (optional)" after booking, through the public-booking function with the
 * booking's management token. Photos go up one at a time as base64 JPEG (already resized and
 * re-encoded in this browser); the function checks and strips them again before storing.
 */

const prepareStateSchema = z.object({
  window: z.object({
    open: z.boolean(),
    reason: z.enum(['no_booking', 'started']).nullable(),
    mode: z.enum(['phone', 'on_site']).nullable(),
  }),
  answers: z.record(z.string(), z.string()),
  access_notes: z.string().nullable(),
  marketing_opt_in: z.boolean(),
  max_photos: z.number().int(),
  photos: z.array(z.object({ id: z.string(), thumb: z.string(), added_at: z.string() })),
})
export type PrepareState = z.infer<typeof prepareStateSchema>

export type PreparePatch = {
  budget?: string
  timing?: string
  access_notes?: string
  marketing_opt_in?: boolean
}

export function usePrepare(token: string) {
  return useQuery({
    queryKey: ['booking', token, 'prepare'],
    queryFn: () => call({ action: 'prepare', token }, prepareStateSchema),
  })
}

export function useSavePrepare(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (details: PreparePatch) =>
      call({ action: 'save_prepare', token, details }, z.object({ status: z.literal('saved') })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', token, 'prepare'] }),
    retry: false,
  })
}

async function toBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(',') + 1)
}

/** One photo; `key` stays the same across retries so a retry is the same photo. */
export async function uploadPhoto(
  token: string,
  input: { key: string; photo: Blob; thumb: Blob },
): Promise<string> {
  const result = await call(
    {
      action: 'add_photo',
      token,
      key: input.key,
      photo: await toBase64(input.photo),
      thumb: await toBase64(input.thumb),
    },
    z.object({ status: z.literal('added'), id: z.string() }),
  )
  return result.id
}

export function useUploadPhoto(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { key: string; photo: Blob; thumb: Blob }) => uploadPhoto(token, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', token, 'prepare'] }),
    retry: false,
  })
}

export function useRemovePhoto(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (photoId: string) =>
      call(
        { action: 'remove_photo', token, photoId },
        z.object({ status: z.enum(['removed', 'not_found']) }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', token, 'prepare'] }),
    retry: false,
  })
}
