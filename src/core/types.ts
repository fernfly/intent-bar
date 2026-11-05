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

/** The body the bar sends to `POST /api/p/<public_id>/corrections`: the call the user ran, against the inference it corrects. */
export interface CorrectionRequest {
  log_ref: string
  call: Call
}

/**
 * How the bar talks to Fernfly. The default posts to the project's public
 * endpoints or to the host's proxy. Tests and demos pass their own. A
 * failure with `reason: 'rate_limited'` or `'quota_exceeded'` gets its own
 * notice, and anything else reads as "unavailable".
 */
export interface Transport {
  infer(request: InferRequest): Promise<InferResponse>
  /** Sends a correction. A transport without it sends none. */
  correct?(request: CorrectionRequest): Promise<void>
}

/** A page the bar can jump to with instant search, without a model call. */
export interface BarPage {
  label: string
  href: string
}

/** What a tool does. `filter` and `navigate` run at once; `action`, the default, confirms first. */
export type ToolKind = 'filter' | 'navigate' | 'action'

/** `match` picks what the call applies to, and its chip is tinted. `set` is what the call will change, and its chip is outlined. */
export type ArgRole = 'match' | 'set'

/** A workspace value a lookup found, such as a person, a project or a cycle. */
export interface LookupOption {
  id: string
  label: string
  /** A second line that tells two matches apart, such as an email. */
  detail?: string
}

/** How the bar labels and edits one argument of a tool. */
export interface ArgConfig {
  label?: string
  /** Defaults to `match`. */
  role?: ArgRole
  /** Workspace data: the model returns the user's words, and `values[entity]` resolves them. */
  entity?: string
  /** A fixed vocabulary, offered as a list when the chip is edited. */
  enum?: readonly string[]
  /** How enum values read on a chip, such as `{ in_progress: 'in progress' }`. */
  optionLabels?: Readonly<Record<string, string>>
  /** What an edited value is converted to. Defaults to the type of the model's value, or text. */
  type?: 'string' | 'number' | 'integer' | 'boolean'
}

/** The host's context, read when the bar needs it. `current` resolves the reserved token `current` per entity. */
export interface HostContext {
  current?: Readonly<Record<string, LookupOption>>
  [key: string]: unknown
}

/** Arguments after lookups: an entity argument holds its option's `id`, or `null` for `none`. */
export type ResolvedArgs = Record<string, unknown>

/** What `preview` and `run` receive beside the resolved arguments. */
export interface HandlerContext {
  /** The call in model space, edits included. */
  call: Call
  /** The arguments before lookups: the user's words. */
  raw: Record<string, unknown>
  utterance: string
  context: HostContext
}

/** What `run` receives: the handler context plus a way to report progress on a long run. */
export interface RunContext extends HandlerContext {
  progress(done: number, total?: number): void
}

/** What `run` may return. `undo` puts an Undo button on the notice that follows. */
export interface RunResult {
  message?: string
  undo?: () => unknown
}

/** A second thing the parsed call can lead to, such as "Email all 51". It always confirms. */
export interface PreviewAction {
  label: string
  summary?: string
  undoable?: boolean
  run(ctx: RunContext): RunResult | void | Promise<RunResult | void>
}

/** What `preview` returns: what the call would touch, before anything runs. */
export interface Preview {
  count?: number
  /** One line, such as "Move 12 work items to Priya". The confirm step's title. */
  summary?: string
  /** A few rows of what the call would touch. */
  sample?: readonly string[]
  undoable?: boolean
  /** The run button's label. Defaults to "Run". */
  confirmLabel?: string
  actions?: readonly PreviewAction[]
}

/** How the bar presents and runs one tool. */
export interface ToolConfig {
  /** Defaults to `action`, which confirms. */
  kind?: ToolKind
  label?: string
  /** Sentences shown on the empty bar. */
  examples?: readonly string[]
  args?: Readonly<Record<string, ArgConfig>>
  /** `false` skips confirm for an action, but only when the preview count is 1 or less. */
  confirm?: boolean
  /** What the call would touch. Returning nothing means no preview. */
  preview?(args: ResolvedArgs, ctx: HandlerContext): Preview | undefined | Promise<Preview | undefined>
  run?(args: ResolvedArgs, ctx: RunContext): RunResult | void | Promise<RunResult | void>
}

/**
 * Finds workspace values for the user's words. One match resolves, several
 * ask the user to choose, none blocks the run. `null` declines the lookup,
 * and the words pass through for the host to handle.
 */
export type ValueResolver = (
  query: string,
  ctx: { context: HostContext },
) => readonly LookupOption[] | null | undefined | Promise<readonly LookupOption[] | null | undefined>
