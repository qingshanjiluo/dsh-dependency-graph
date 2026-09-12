# dsh-dependency-graph

Dependency-graph analysis for DeepSeek Harness: circular-dependency detection, orphan (unused) lookups, and change-impact analysis over caller-supplied import graphs. Pure graph algorithms — the model supplies edges (`{from,to}` pairs, e.g. from an import map or a package.json `dependencies` object); the plugin runs no subprocesses, reads no files, and touches no network.

## Install

```bash
npx -y @deepseek-ai/dsh plugin --profile web add @qingshanjiluo/dsh-dependency-graph
```

## Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `dep_circular` | `edges: {from,to}[]` | `cyclic`, `found`, `truncated`, `cycles` — distinct cycles as closed node paths, shortest first, capped by `maxCycles` |
| `dep_orphans` | `nodes: string[]`, `edges: {from,to}[]` | `declared`, `orphans` (nodes in no edge at all), `unreferenced` (import others but are never imported; entry points exempt) |
| `dep_impact` | `node: string`, `edges: {from,to}[]` | `found`, `impacted`, direct/transitive dependents and dependencies (upstream = breaks, downstream = used) |

Edge convention: `{from: "a", to: "b"}` means **a imports/depends on b**. For a package.json `dependencies` object, emit one edge per (package name → each of its dependencies).

## Configuration

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `maxCycles` | number | `50` | Cycle-report budget for `dep_circular` (extra cycles are counted but truncated) |
| `entryPoints` | string[] | `[]` | Nodes allowed to import without being imported back (e.g. `src/main.ts`) |

## Development

```bash
npm install --no-audit --no-fund
npx tsc --noEmit
npm run build
npx vitest run
node scripts/load-smoke.mjs
```

## License

MIT
