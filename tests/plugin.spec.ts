import { describe, expect, it } from 'vitest'
import { apply, Config, inject, name } from '../src/index.ts'

interface RegisteredTool {
  name: string
  execute(args: never, exec: never): Promise<unknown>
}

interface MountConfig {
  maxCycles: number
  entryPoints: string[]
}

const DEFAULTS: MountConfig = { maxCycles: 50, entryPoints: [] }

function mountPlugin(config: MountConfig = DEFAULTS): RegisteredTool[] {
  const registered: RegisteredTool[] = []
  const ctx = { tools: { register: (def: RegisteredTool) => registered.push(def) } }
  // The plugin only reads ctx.tools; a partial stub is the real registrant surface it touches.
  apply(ctx as never, config as never)
  return registered
}

function tool(toolName: string, config: MountConfig = DEFAULTS): RegisteredTool {
  const found = mountPlugin(config).find(t => t.name === toolName)
  if (!found) throw new Error(`tool ${toolName} not registered`)
  return found
}

interface CircularResult {
  cyclic: boolean
  found: number
  truncated: boolean
  cycles: string[][]
}

interface OrphansResult {
  declared: number
  orphans: string[]
  unreferenced: string[]
}

interface ImpactResult {
  node: string
  found: boolean
  impacted: number
  directDependents: string[]
  transitiveDependents: string[]
  directDependencies: string[]
  transitiveDependencies: string[]
}

describe('dsh-dependency-graph plugin contract', () => {
  it('exports the loader plugin face', () => {
    expect(name).toBe('dsh-dependency-graph')
    expect(inject).toEqual(['tools'])
    expect(typeof apply).toBe('function')
    expect(Config).toBeInstanceOf(Object)
  })

  it('registers the three documented tools and their schemas compile', () => {
    const tools = mountPlugin()
    expect(tools.map(t => t.name).sort()).toEqual(['dep_circular', 'dep_impact', 'dep_orphans'])
  })
})

describe('dep_circular', () => {
  it('reports an acyclic chain as cycle-free', async () => {
    const result = await tool('dep_circular').execute({
      edges: [{ from: 'app', to: 'util' }, { from: 'util', to: 'core' }],
    } as never, {} as never) as CircularResult
    expect(result).toMatchObject({ cyclic: false, found: 0, truncated: false, cycles: [] })
  })

  it('finds a three-node cycle, canonically rotated and closed', async () => {
    const result = await tool('dep_circular').execute({
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
    } as never, {} as never) as CircularResult
    expect(result.cyclic).toBe(true)
    expect(result.found).toBe(1)
    expect(result.cycles).toEqual([['a', 'b', 'c', 'a']])
  })

  it('detects self-loops and deduplicates repeated identical edges', async () => {
    const result = await tool('dep_circular').execute({
      edges: [
        { from: 'x', to: 'x' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'a', to: 'b' },
      ],
    } as never, {} as never) as CircularResult
    expect(result.found).toBe(2)
    expect(result.cycles).toEqual([['x', 'x'], ['a', 'b', 'a']])
  })

  it('honors the maxCycles budget and flags truncation', async () => {
    const edges = [
      { from: 'a', to: 'b' }, { from: 'b', to: 'a' },
      { from: 'c', to: 'd' }, { from: 'd', to: 'c' },
      { from: 'e', to: 'f' }, { from: 'f', to: 'e' },
    ]
    const result = await tool('dep_circular', { ...DEFAULTS, maxCycles: 2 }).execute({
      edges,
    } as never, {} as never) as CircularResult
    expect(result.found).toBe(3)
    expect(result.truncated).toBe(true)
    expect(result.cycles).toEqual([['a', 'b', 'a'], ['c', 'd', 'c']])
  })

  it('rejects malformed edge arguments at the schema boundary', async () => {
    await expect(
      tool('dep_circular').execute({ edges: [{ from: 'a' }] } as never, {} as never),
    ).rejects.toThrow()
  })
})

describe('dep_orphans', () => {
  it('separates orphans from unreferenced importers', async () => {
    const result = await tool('dep_orphans').execute({
      nodes: ['a', 'b', 'c', 'd'],
      edges: [{ from: 'a', to: 'b' }],
    } as never, {} as never) as OrphansResult
    expect(result.declared).toBe(4)
    expect(result.orphans).toEqual(['c', 'd'])
    expect(result.unreferenced).toEqual(['a'])
  })

  it('exempts configured entry points from the unreferenced list', async () => {
    const result = await tool('dep_orphans', { ...DEFAULTS, entryPoints: ['a'] }).execute({
      nodes: ['a', 'b'],
      edges: [{ from: 'a', to: 'b' }],
    } as never, {} as never) as OrphansResult
    expect(result.orphans).toEqual([])
    expect(result.unreferenced).toEqual([])
  })

  it('treats every declared node as an orphan when the graph has no edges', async () => {
    const result = await tool('dep_orphans').execute({
      nodes: ['left-pad', 'lodash'],
      edges: [],
    } as never, {} as never) as OrphansResult
    expect(result.orphans).toEqual(['left-pad', 'lodash'])
    expect(result.unreferenced).toEqual([])
  })

  it('counts declared nodes distinctly', async () => {
    const result = await tool('dep_orphans').execute({
      nodes: ['a', 'a'],
      edges: [],
    } as never, {} as never) as OrphansResult
    expect(result.declared).toBe(1)
    expect(result.orphans).toEqual(['a'])
  })
})

describe('dep_impact', () => {
  it('walks dependents upstream through a chain', async () => {
    const result = await tool('dep_impact').execute({
      node: 'a',
      edges: [{ from: 'b', to: 'a' }, { from: 'c', to: 'b' }],
    } as never, {} as never) as ImpactResult
    expect(result.found).toBe(true)
    expect(result.directDependents).toEqual(['b'])
    expect(result.transitiveDependents).toEqual(['c'])
    expect(result.impacted).toBe(2)
    expect(result.directDependencies).toEqual([])
    expect(result.transitiveDependencies).toEqual([])
  })

  it('terminates on cycles and excludes the analyzed node from its own impact set', async () => {
    const result = await tool('dep_impact').execute({
      node: 'a',
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
    } as never, {} as never) as ImpactResult
    expect(result.directDependents).toEqual(['c'])
    expect(result.transitiveDependents).toEqual(['b'])
    expect(result.directDependencies).toEqual(['b'])
    expect(result.transitiveDependencies).toEqual(['c'])
    expect(result.impacted).toBe(2)
    expect(result.directDependents).not.toContain('a')
    expect(result.transitiveDependents).not.toContain('a')
  })

  it('reports an unknown node as nothing to analyze', async () => {
    const result = await tool('dep_impact').execute({
      node: 'ghost',
      edges: [{ from: 'a', to: 'b' }],
    } as never, {} as never) as ImpactResult
    expect(result).toMatchObject({ found: false, impacted: 0, directDependents: [] })
  })

  it('ignores a self-loop while counting real dependents', async () => {
    const result = await tool('dep_impact').execute({
      node: 'x',
      edges: [{ from: 'x', to: 'x' }, { from: 'y', to: 'x' }],
    } as never, {} as never) as ImpactResult
    expect(result.directDependents).toEqual(['y'])
    expect(result.transitiveDependents).toEqual([])
    expect(result.directDependencies).toEqual([])
    expect(result.impacted).toBe(1)
  })
})
