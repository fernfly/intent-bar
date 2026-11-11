import { useCallback, useEffect, useRef, useState } from 'react'
import type { CorrectionRequest, RunResult, Transport } from '../core/types'
import { messageOf } from './hooks'

/** One run handed from the bar to the host. The bar closes as it starts, and the toast follows it. */
export interface RunRequest {
  /** What is running, shown while it runs. */
  label: string
  /** Filters and navigation: no "Done" unless the host says something. */
  quiet: boolean
  run(progress: (done: number, total?: number) => void): Promise<RunResult | void>
  /** Sent once the run succeeds, when the user changed the model's call. */
  correction: CorrectionRequest | null
}

type ToastState =
  | { id: number; kind: 'running'; label: string; quiet: boolean; done?: number; total?: number }
  | { id: number; kind: 'done'; message?: string; undo?: () => unknown; corrected: boolean }
  | { id: number; kind: 'failed'; message: string }

/** How long a finished toast stays, in milliseconds. */
const TOAST_MS = { done: 6000, failed: 9000 } as const

/**
 * Runs calls and tracks the one toast that reports on them. A new run
 * replaces the toast of an older one. A correction is sent only after its
 * run succeeds, and the toast says so only once the server has stored it.
 */
export function useRunner(transport: Transport) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const seq = useRef(0)
  const latestTransport = useRef(transport)
  latestTransport.current = transport

  const update = useCallback((id: number, next: (t: ToastState) => ToastState) => {
    setToast((t) => (t && t.id === id ? next(t) : t))
  }, [])

  const track = useCallback(
    async (label: string, work: (progress: (done: number, total?: number) => void) => Promise<RunResult | void>, quiet: boolean) => {
      const id = ++seq.current
      setToast({ id, kind: 'running', label, quiet })
      try {
        const result = await work((done, total) => update(id, (t) => (t.kind === 'running' ? { ...t, done, total } : t)))
        const message = result?.message ?? (quiet ? undefined : 'Done')
        update(id, () => ({ id, kind: 'done', message, undo: result?.undo, corrected: false }))
        return { id, ok: true as const, result }
      } catch (err) {
        const message = (err as Error | null)?.name === 'NotConnectedError' ? messageOf(err) : `Couldn't finish: ${messageOf(err)}`
        update(id, () => ({ id, kind: 'failed', message }))
        return { id, ok: false as const, result: undefined }
      }
    },
    [update],
  )

  /** Runs a request, then sends its correction. Resolves with the run's result, or nothing when the run failed. */
  const start = useCallback(
    async (request: RunRequest): Promise<RunResult | void> => {
      const { id, ok, result } = await track(request.label, request.run, request.quiet)
      const send = latestTransport.current.correct
      if (ok && request.correction && send) {
        send(request.correction).then(
          () => update(id, (t) => (t.kind === 'done' ? { ...t, corrected: true } : t)),
          () => {},
        )
      }
      return result
    },
    [track, update],
  )

  const undo = useCallback(() => {
    if (toast?.kind !== 'done' || !toast.undo) return
    const fn = toast.undo
    track('Undoing', async () => {
      await fn()
      return { message: 'Undone' }
    }, false)
  }, [toast, track])

  const dismiss = useCallback(() => setToast(null), [])
  return { toast, start, undo, dismiss }
}

interface ToastProps {
  toast: ToastState
  onUndo: () => void
  onDismiss: () => void
}

/** The notice under the page while a run goes and after it ends. */
export function Toast({ toast, onUndo, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast.kind === 'running') return
    const timer = setTimeout(onDismiss, TOAST_MS[toast.kind])
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  if (toast.kind === 'running' && toast.quiet && toast.total === undefined) return null
  if (toast.kind === 'done' && !toast.message && !toast.undo && !toast.corrected) return null
  return (
    <div className="toast" role="status" data-kind={toast.kind}>
      {toast.kind === 'running' && (
        <>
          <span>{toast.label}</span>
          {toast.total !== undefined && (
            <>
              <progress max={toast.total} value={toast.done ?? 0} />
              <span className="toast-count">
                {toast.done ?? 0} of {toast.total}
              </span>
            </>
          )}
        </>
      )}
      {toast.kind === 'done' && (
        <>
          {toast.message && <span>{toast.message}</span>}
          {toast.corrected && <span className="toast-note">Saved as a correction for review</span>}
          {toast.undo && (
            <button type="button" onClick={onUndo}>
              Undo
            </button>
          )}
        </>
      )}
      {toast.kind === 'failed' && <span>{toast.message}</span>}
    </div>
  )
}
