/**
 * Dependency-graph analysis for DeepSeek Harness. Three pure tools operate on
 * caller-supplied directed edges ({from, to} meaning "from imports/depends on
 * to", e.g. built from an import map or a package.json dependencies object):
 * `dep_circular` finds distinct dependency cycles, `dep_orphans` finds declared
 * nodes nothing depends on, and `dep_impact` reports the blast radius of
 * changing one node. The plugin shells out to nothing and reads no files — the
 * model supplies the graph, so every result is deterministic.
 * @module @qingshanjiluo/dsh-dependency-graph
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-dependency-graph'
export const inject = ['tools']

/** Deployment policy for the graph tools. */
export interface Config {
  /**
   * Maximum number of distinct cycles `dep_circular` returns. The scan still
   * counts every cycle it finds, but the reported list is truncated to this
   * budget and flagged with `truncated: true`.
   */
  maxCycles: number
  /**
   * Node names that are allowed to import others without being imported back
   * (application entry points such as `src/main.ts`). `dep_orphans` never
   * lists these as unreferenced.
   */
  entryPoints: string[]
}

/** Schemastery configuration for the dependency-graph tools. */
export const Config: z<Config> = z.object({
  maxCycles: z.number().default(50),
  entryPoints: z.array(z.string()).default([]),
})

/** One directed import edge: source depends on target. */
interface Edge {
  from: string
  to: string
}

/**
 * Build a deduplicated, deterministically ordered adjacency map. Nodes with no
 * outgoing edges still get an (empty) entry so lookups stay total.
 * @param edges - caller-supplied directed edges.
 * @returns adjacency map keyed by node name, targets sorted.
 */
function buildAdjacency(edges: readonly Edge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const { from, to } of edges) {
    if (!adjacency.has(from)) adjacency.set(from, [])
    if (!adjacency.has(to)) adjacency.set(to, [])
    const key = JSON.stringify([from, to])
    if (seen.has(key)) continue
    seen.add(key)
    adjacency.get(from)!.push(to)
  }
  for (const targets of adjacency.values()) targets.sort()
  return adjacency
}

/**
 * Rotate a cycle body so its lexicographically smallest node leads, giving a
 * stable canonical form independent of where the DFS entered the cycle.
 * @param body - cycle node sequence without the repeated head.
 * @returns the rotated sequence and its canonical key.
 */
function canonicalCycle(body: readonly string[]): { rotated: string[]; key: string } {
  let min = 0
  for (let i = 1; i < body.length; i++) {
    if ((body[i] ?? '') < (body[min] ?? '')) min = i
  }
  const rotated = [...body.slice(min), ...body.slice(0, min)]
  return { rotated, key: JSON.stringify(rotated) }
}

/**
 * Enumerate distinct directed cycles via an iterative colored DFS; every back
 * edge yields one fundamental cycle, deduplicated by canonical rotation.
 * @param adjacency - deduplicated adjacency from {@link buildAdjacency}.
 * @returns closed cycle paths (head repeated at the tail), sorted by length
 * then lexicographically, for deterministic output.
 */
function findCycles(adjacency: ReadonlyMap<string, readonly string[]>): string[][] {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const node of adjacency.keys()) color.set(node, WHITE)
  const found = new Map<string, string[]>()
  for (const root of [...adjacency.keys()].sort()) {
    if (color.get(root) !== WHITE) continue
    color.set(root, GRAY)
    const path: string[] = [root]
    const stack: { node: string; index: number }[] = [{ node: root, index: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const targets = adjacency.get(frame.node) ?? []
      if (frame.index < targets.length) {
        const next = targets[frame.index++]!
        const state = color.get(next)
        if (state === GRAY) {
          const body = path.slice(path.indexOf(next))
          const { rotated, key } = canonicalCycle(body)
          if (!found.has(key)) found.set(key, [...rotated, rotated[0]!])
        } else if (state === WHITE) {
          color.set(next, GRAY)
          path.push(next)
          stack.push({ node: next, index: 0 })
        }
      } else {
        stack.pop()
        path.pop()
        color.set(frame.node, BLACK)
      }
    }
  }
  return [...found.values()].sort(
    (a, b) => a.length - b.length || JSON.stringify(a).localeCompare(JSON.stringify(b)),
  )
}

/**
 * Transitive closure over one adjacency map via BFS, excluding the start node
 * itself so cycles through it never double-report or loop.
 * @param adjacency - directed adjacency map.
 * @param start - node to expand from.
 * @returns sorted direct neighbors and sorted transitive reachables.
 */
function closure(
  adjacency: ReadonlyMap<string, readonly string[]>,
  start: string,
): { direct: string[]; transitive: string[] } {
  const direct = [...(adjacency.get(start) ?? [])].filter(n => n !== start)
  const seen = new Set<string>()
  const queue: string[] = [...direct]
  while (queue.length > 0) {
    const node = queue.shift()!
    for (const next of adjacency.get(node) ?? []) {
      if (next === start || seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return { direct: direct.sort(), transitive: [...seen].sort() }
}

/**
 * Invert a directed adjacency map (swap dependents and dependencies).
 * @param adjacency - forward adjacency map.
 * @returns reverse adjacency map with sorted target lists.
 */
function reverseAdjacency(adjacency: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const reversed = new Map<string, string[]>()
  for (const node of adjacency.keys()) if (!reversed.has(node)) reversed.set(node, [])
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (!reversed.has(to)) reversed.set(to, [])
      reversed.get(to)!.push(from)
    }
  }
  for (const sources of reversed.values()) sources.sort()
  return reversed
}

const EDGE_ITEMS = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    from: { type: 'string' as const, required: true as const, description: 'Node that imports or depends on the target.' },
    to: { type: 'string' as const, required: true as const, description: 'Node being imported or depended upon.' },
  },
}

const EDGES_DESCRIPTION =
  'Directed edges as {from,to} pairs, where "from" imports/depends on "to". Build them from an import map or a package.json dependencies object (each key imports each of its values).'

/**
 * Register the dependency-graph tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's explicit graph-analysis policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'dep_circular',
    description:
      'Find circular dependencies in a directed import graph. Pass every edge as {from,to} ' +
      'pairs ("from" imports "to"). Returns each distinct cycle as a closed node path ' +
      '(first node repeated at the end), up to the configured maxCycles budget.',
    parameters: {
      edges: { type: 'array', required: true, description: EDGES_DESCRIPTION, items: EDGE_ITEMS },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cyclic: { type: 'boolean', required: true, description: 'Whether the graph contains at least one cycle.' },
          found: { type: 'integer', required: true, description: 'Total number of distinct cycles found before truncation.' },
          truncated: { type: 'boolean', required: true, description: 'Whether more cycles existed than maxCycles allowed to report.' },
          cycles: {
            type: 'array',
            required: true,
            description: 'Distinct cycles, shortest first; each path closes with a repeat of its first node.',
            items: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.cyclic
          ? `${value.found} cycle(s) found${value.truncated ? ` (showing first ${value.cycles.length})` : ''}:\n`
            + value.cycles.map(c => `- ${c.join(' -> ')}`).join('\n')
          : 'No circular dependencies.',
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const cycles = findCycles(buildAdjacency(args.edges))
      const limited = cycles.slice(0, Math.max(0, Math.floor(config.maxCycles)))
      return Promise.resolve({
        cyclic: cycles.length > 0,
        found: cycles.length,
        truncated: limited.length < cycles.length,
        cycles: limited,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dep_orphans',
    description:
      'Find declared nodes nothing depends on. Pass nodes (the names you want checked, e.g. ' +
      'package names from a package.json dependencies object or source files) and every graph ' +
      'edge as {from,to} pairs ("from" imports "to"). Orphans appear in no edge at all; ' +
      'unreferenced nodes import others but are never imported themselves (configured entry ' +
      'points are exempt).',
    parameters: {
      nodes: {
        type: 'array',
        required: true,
        description: 'Declared node names to check, for example dependency package names.',
        items: { type: 'string' },
      },
      edges: { type: 'array', required: true, description: EDGES_DESCRIPTION, items: EDGE_ITEMS },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          declared: { type: 'integer', required: true, description: 'Number of distinct declared nodes examined.' },
          orphans: {
            type: 'array',
            required: true,
            description: 'Declared nodes that appear in no edge at all, sorted.',
            items: { type: 'string' },
          },
          unreferenced: {
            type: 'array',
            required: true,
            description: 'Declared nodes that import others but nothing imports them, sorted.',
            items: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.orphans.length === 0 && value.unreferenced.length === 0
          ? `${value.declared} node(s) declared, none orphaned.`
          : [
              `${value.declared} node(s) declared:`,
              value.orphans.length > 0 ? `- orphaned (in no edge): ${value.orphans.join(', ')}` : '',
              value.unreferenced.length > 0 ? `- unreferenced (never imported): ${value.unreferenced.join(', ')}` : '',
            ].filter(line => line.length > 0).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const declared = [...new Set(args.nodes)]
      const sources = new Set<string>()
      const targets = new Set<string>()
      for (const { from, to } of args.edges) {
        sources.add(from)
        targets.add(to)
      }
      const entryPoints = new Set(config.entryPoints)
      return Promise.resolve({
        declared: declared.length,
        orphans: declared.filter(n => !sources.has(n) && !targets.has(n)).sort(),
        unreferenced: declared
          .filter(n => sources.has(n) && !targets.has(n) && !entryPoints.has(n))
          .sort(),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dep_impact',
    description:
      'Compute the blast radius of changing one node in a directed import graph. Pass the node ' +
      'name and every edge as {from,to} pairs ("from" imports "to"). Dependents are nodes that ' +
      'transitively import the target (they break or need retesting); dependencies are nodes ' +
      'the target transitively imports.',
    parameters: {
      node: { type: 'string', required: true, description: 'Node whose change impact is being measured.' },
      edges: { type: 'array', required: true, description: EDGES_DESCRIPTION, items: EDGE_ITEMS },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          node: { type: 'string', required: true, description: 'The analyzed node.' },
          found: { type: 'boolean', required: true, description: 'Whether the node appears in at least one edge.' },
          impacted: { type: 'integer', required: true, description: 'Total distinct nodes that transitively depend on it.' },
          directDependents: { type: 'array', required: true, description: 'Nodes importing it directly, sorted.', items: { type: 'string' } },
          transitiveDependents: { type: 'array', required: true, description: 'Nodes importing it transitively, sorted.', items: { type: 'string' } },
          directDependencies: { type: 'array', required: true, description: 'Nodes it imports directly, sorted.', items: { type: 'string' } },
          transitiveDependencies: { type: 'array', required: true, description: 'Nodes it imports transitively, sorted.', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.found
          ? [
              `Changing ${value.node} impacts ${value.impacted} dependent node(s).`,
              value.directDependents.length > 0 ? `- direct dependents: ${value.directDependents.join(', ')}` : '',
              value.transitiveDependents.length > 0 ? `- transitive dependents: ${value.transitiveDependents.join(', ')}` : '',
              value.directDependencies.length > 0 ? `- direct dependencies: ${value.directDependencies.join(', ')}` : '',
              value.transitiveDependencies.length > 0 ? `- transitive dependencies: ${value.transitiveDependencies.join(', ')}` : '',
            ].filter(line => line.length > 0).join('\n')
          : `${value.node} appears in no edge; nothing to analyze.`,
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const adjacency = buildAdjacency(args.edges)
      const found = adjacency.has(args.node)
      if (!found) {
        return Promise.resolve({
          node: args.node,
          found: false,
          impacted: 0,
          directDependents: [],
          transitiveDependents: [],
          directDependencies: [],
          transitiveDependencies: [],
        })
      }
      const down = closure(adjacency, args.node)
      const up = closure(reverseAdjacency(adjacency), args.node)
      return Promise.resolve({
        node: args.node,
        found: true,
        impacted: up.direct.length + up.transitive.length,
        directDependents: up.direct,
        transitiveDependents: up.transitive,
        directDependencies: down.direct,
        transitiveDependencies: down.transitive,
      })
    },
  }))
}
