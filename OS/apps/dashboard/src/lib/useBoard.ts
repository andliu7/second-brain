import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export type SaveState = 'loading' | 'saved' | 'saving' | 'error'

/**
 * Loads and persists one row of the `boards` table (one JSON blob per
 * user per board_key). Mirrors the save-on-change pattern the original
 * claude.ai artifacts used, just backed by Supabase instead of the
 * artifact publish API.
 */
export function useBoard<T>(userId: string, boardKey: string, emptyState: () => T) {
  const [data, setData] = useState<T | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<T | null>(null)

  useEffect(() => {
    let cancelled = false
    setSaveState('loading')
    supabase
      .from('boards')
      .select('data')
      .eq('user_id', userId)
      .eq('board_key', boardKey)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (cancelled) return
        if (error) {
          console.error(error)
          setSaveState('error')
          setData(emptyState())
          return
        }
        const initial = (row?.data as T | undefined) ?? emptyState()
        latest.current = initial
        setData(initial)
        setSaveState('saved')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, boardKey])

  const persist = useCallback(
    (next: T) => {
      latest.current = next
      setData(next)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      setSaveState('saving')
      saveTimer.current = setTimeout(async () => {
        const { error } = await supabase
          .from('boards')
          .upsert(
            { user_id: userId, board_key: boardKey, data: latest.current },
            { onConflict: 'user_id,board_key' }
          )
        setSaveState(error ? 'error' : 'saved')
        if (error) console.error(error)
      }, 400)
    },
    [userId, boardKey]
  )

  return { data, setData: persist, saveState }
}
