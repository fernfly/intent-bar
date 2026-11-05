import { entitiesOf, eventValues, withEvents } from '../core/events'
import type { ToolConfig, ValueResolver } from '../core/types'
import type { IntentBarProps } from '../react/IntentBar'

/** The options `init()` takes: the React props, minus open state, which `open()` and `close()` drive. */
export type InitOptions = Omit<IntentBarProps, 'open' | 'defaultOpen' | 'onOpenChange'>

/**
 * The options with events standing in for every function the host didn't
 * pass: each tool's `preview` and `run`, a tool `tools` doesn't list, and
 * the lookup for each entity the tools name.
 */
export function withEventFallbacks(options: InitOptions, target: EventTarget): InitOptions {
  const tools = Object.fromEntries(Object.entries(options.tools ?? {}).map(([name, tool]) => [name, withEvents(name, tool, target)]))
  const values: Record<string, ValueResolver> = { ...options.values }
  for (const entity of entitiesOf(options.tools)) values[entity] ??= eventValues(entity, target)
  const unlisted = new Map<string, ToolConfig>()
  const fallbackTool = (name: string): ToolConfig => {
    let tool = unlisted.get(name)
    if (!tool) {
      tool = withEvents(name, options.fallbackTool?.(name), target)
      unlisted.set(name, tool)
    }
    return tool
  }
  return { ...options, tools, values, fallbackTool }
}

/**
 * Reads `init()` options from the bar's own script tag, for an install with
 * no JavaScript of the host's: `data-project` or `data-endpoint`, plus
 * `data-app-name`, `data-hotkey` (`false` for none), `data-hotkey-takeover`,
 * `data-attach` and `data-launcher`. Null when the tag names neither a
 * project nor an endpoint.
 */
export function optionsFromScript(script: Element | null): InitOptions | null {
  const data = (script as HTMLElement | null)?.dataset
  if (!data || (!data.project && !data.endpoint)) return null
  const flag = (value: string | undefined) => value !== undefined && value !== 'false'
  const keys = data.hotkey ?? 'mod+k'
  return {
    project: data.project,
    endpoint: data.endpoint,
    appName: data.appName,
    hotkey: keys === 'false' ? false : flag(data.hotkeyTakeover) ? { keys, takeOver: true } : keys,
    attach: data.attach,
    launcher: flag(data.launcher),
  }
}
