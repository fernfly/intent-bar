/** One tool call in model space: a tool name and its flat arguments. */
export interface Call {
  name: string
  arguments: Record<string, unknown>
}

/** The body the bar sends to `POST /api/p/<public_id>/infer`. */
export interface InferRequest {
  utterance: string
  meta?: Record<string, unknown>
}

/** What `POST /api/p/<public_id>/infer` answers. */
export interface InferResponse {
  calls: Call[]
  latency_ms?: number
  log_ref?: string
  out_of_scope?: boolean
  reply?: string
  needs_fallback?: boolean
}

/** Sends one inference request. Replaceable so tests and demos need no network. */
export type Transport = (request: InferRequest) => Promise<InferResponse>

/** A page the bar can jump to with instant search, without a model call. */
export interface BarPage {
  label: string
  href: string
}

/** How the bar labels and edits one argument of a tool. */
export interface ArgConfig {
  label?: string
  enum?: readonly string[]
}

/** How the bar presents one tool. */
export interface ToolConfig {
  label?: string
  args?: Record<string, ArgConfig>
}
