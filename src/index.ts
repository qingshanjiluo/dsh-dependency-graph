/**
 * dsh-dependency-graph — 依赖图分析
 *
 * 功能：
 * 1. 模块依赖可视化
 * 2. 循环检测
 * 3. 孤儿模块
 * 4. 影响分析
 * 5. 耦合度计算
 *
 * 工具：dep_graph, dep_circular, dep_orphans, dep_impact, dep_coupling, dep_package
 * 命令：/dep
 * 配置：enabled
 */
import z from 'zod';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';
import { execSync } from 'node:child_process';

export const name = 'dsh-dependency-graph';

export const inject = ['settings', 'tools', 'commands'] as const;

export const config = z.object({
  enabled: z.boolean().default(true),
  maxDepth: z.number().int().min(1).max(20).default(5),
  ignorePatterns: z.string().default('node_modules,.git,dist,build'),
});

type GraphNode = {
  imports: Set<string>;
  importedBy: Set<string>;
  size: number;
};

type Graph = Map<string, GraphNode>;

type CircularChain = string[];

type CouplingMetrics = {
  module: string;
  afferentCoupling: number;
  efferentCoupling: number;
  instability: number;
};

type PackageAnalysis = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  used: string[];
  unused: string[];
  missing: string[];
};

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
  ],
  javascript: [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  python: [
    /from\s+([^\s]+)\s+import/g,
    /import\s+([^\s;]+)/g,
  ],
  rust: [
    /use\s+([^\s;]+)::/g,
    /mod\s+([^\s;]+);/g,
  ],
  go: [
    /import\s+["']([^"']+)["']/g,
    /import\s*\([\s\S]*?["']([^"']+)["']/g,
  ],
};

function getLangFromExt(filePath: string): string {
  const ext = extname(filePath);
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
  };
  return map[ext] || 'typescript';
}

function parseImports(content: string, lang: string): string[] {
  const patterns = IMPORT_PATTERNS[lang] || IMPORT_PATTERNS.typescript;
  const imports: string[] = [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const specifier = match[1];
      if (specifier && (specifier.startsWith('.') || specifier.startsWith('/'))) {
        imports.push(specifier);
      }
    }
  }
  return imports;
}

function shouldIgnore(filePath: string, patterns: string[]): boolean {
  const parts = filePath.split(/[/\\]/);
  return parts.some((part) => patterns.includes(part));
}

function walkDirectory(dir: string, patterns: string[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (shouldIgnore(fullPath, patterns)) continue;

    if (entry.isDirectory()) {
      results.push(...walkDirectory(fullPath, patterns));
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go'].includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function resolveImport(fromFile: string, importPath: string): string | null {
  const dir = fromFile;
  const candidates = [
    resolve(dir, importPath),
    resolve(dir, importPath + '.ts'),
    resolve(dir, importPath + '.tsx'),
    resolve(dir, importPath + '.js'),
    resolve(dir, importPath + '.jsx'),
    resolve(dir, importPath + '.mjs'),
    resolve(dir, importPath + '.index.ts'),
    resolve(dir, importPath + '.index.js'),
    resolve(dir, importPath, 'index.ts'),
    resolve(dir, importPath, 'index.js'),
    resolve(dir, importPath, 'index.tsx'),
    resolve(dir, importPath, 'index.jsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function buildGraph(dir: string, depth: number, patterns: string[], currentDepth = 0, graph: Graph = new Map(), visited = new Set<string>()): Graph {
  if (currentDepth >= depth) return graph;

  const files = walkDirectory(dir, patterns);
  for (const file of files) {
    if (visited.has(file)) continue;
    visited.add(file);

    const content = readFileSync(file, 'utf-8');
    const lang = getLangFromExt(file);
    const importSpecifiers = parseImports(content, lang);
    const stat = statSync(file);

    if (!graph.has(file)) {
      graph.set(file, { imports: new Set(), importedBy: new Set(), size: stat.size });
    } else {
      graph.get(file)!.size = stat.size;
    }

    for (const spec of importSpecifiers) {
      const resolved = resolveImport(file, spec);
      if (resolved) {
        graph.get(file)!.imports.add(resolved);
        if (!graph.has(resolved)) {
          const resolvedStat = existsSync(resolved) ? statSync(resolved) : { size: 0 };
          graph.set(resolved, { imports: new Set(), importedBy: new Set(), size: resolvedStat.size });
        }
        graph.get(resolved)!.importedBy.add(file);
      }
    }
  }

  return graph;
}

function detectCircularDeps(graph: Graph): CircularChain[] {
  const cycles: CircularChain[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push([...path.slice(cycleStart), node]);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const nodeData = graph.get(node);
    if (nodeData) {
      for (const imp of nodeData.imports) {
        dfs(imp, path);
      }
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node, []);
  }

  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const key = cycle.slice(0, -1).sort().join('->');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findOrphanModules(graph: Graph): string[] {
  const orphans: string[] = [];
  for (const [module, data] of graph) {
    if (data.importedBy.size === 0) {
      const isEntry = module.endsWith('index.ts') || module.endsWith('index.js') || module.endsWith('main.ts') || module.endsWith('main.js');
      if (!isEntry) {
        orphans.push(module);
      }
    }
  }
  return orphans;
}

function calculateCoupling(graph: Graph): CouplingMetrics[] {
  const metrics: CouplingMetrics[] = [];
  for (const [module, data] of graph) {
    const afferent = data.importedBy.size;
    const efferent = data.imports.size;
    const total = afferent + efferent;
    const instability = total > 0 ? efferent / total : 0;
    metrics.push({
      module,
      afferentCoupling: afferent,
      efferentCoupling: efferent,
      instability,
    });
  }
  return metrics.sort((a, b) => b.instability - a.instability);
}

function generateMermaidGraph(graph: Graph): string {
  const lines = ['graph LR'];
  const nodeIds = new Map<string, string>();
  let idCounter = 0;

  for (const node of graph.keys()) {
    nodeIds.set(node, `n${idCounter++}`);
  }

  for (const [node, data] of graph) {
    const id = nodeIds.get(node)!;
    const label = node.split(/[/\\]/).pop() || node;
    lines.push(`  ${id}["${label}"]`);
    for (const imp of data.imports) {
      if (nodeIds.has(imp)) {
        lines.push(`  ${id} --> ${nodeIds.get(imp)}`);
      }
    }
  }

  return lines.join('\n');
}

function generateDotGraph(graph: Graph): string {
  const lines = ['digraph dependencies {', '  rankdir=LR;', '  node [shape=box];'];

  for (const [node, data] of graph) {
    const label = node.split(/[/\\]/).pop() || node;
    const nodeId = `"${node}"`;
    lines.push(`  ${nodeId} [label="${label}"];`);
    for (const imp of data.imports) {
      lines.push(`  ${nodeId} -> "${imp}";`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function generateListGraph(graph: Graph): string {
  const lines: string[] = [];
  for (const [node, data] of graph) {
    const label = node.split(/[/\\]/).pop() || node;
    const imports = Array.from(data.imports).map((i) => i.split(/[/\\]/).pop() || i);
    lines.push(`${label} → ${imports.length > 0 ? imports.join(', ') : '(no imports)'} [size: ${data.size}B]`);
  }
  return lines.join('\n');
}

function findImpactSet(module: string, graph: Graph): Set<string> {
  const affected = new Set<string>();
  const queue = [module];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (affected.has(current)) continue;
    affected.add(current);

    for (const [node, data] of graph) {
      if (data.imports.has(current) && !affected.has(node)) {
        queue.push(node);
      }
    }
  }

  affected.delete(module);
  return affected;
}

function analyzePackageJson(dir: string): PackageAnalysis | null {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const dependencies = pkg.dependencies || {};
  const devDependencies = pkg.devDependencies || {};
  const allDeps = { ...dependencies, ...devDependencies };

  const used: string[] = [];
  const unused: string[] = [];
  const missing: string[] = [];

  const files = walkDirectory(dir, ['node_modules', '.git', 'dist', 'build']);
  const importedPackages = new Set<string>();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const lang = getLangFromExt(file);
    const imports = parseImports(content, lang);
    for (const imp of imports) {
      const pkgName = imp.startsWith('@') ? imp.split('/').slice(0, 2).join('/') : imp.split('/')[0];
      importedPackages.add(pkgName);
    }
  }

  for (const dep of Object.keys(allDeps)) {
    if (importedPackages.has(dep)) {
      used.push(dep);
    } else {
      unused.push(dep);
    }
  }

  for (const imp of importedPackages) {
    if (!allDeps[imp] && !imp.startsWith('.') && !imp.startsWith('/')) {
      missing.push(imp);
    }
  }

  return { dependencies, devDependencies, used, unused, missing };
}

export function apply(settings: any, tools: any, commands: any) {
  const getConfig = () => {
    const raw = settings?.get?.('dsh-dependency-graph') || {};
    return config.parse(raw);
  };

  tools.register({
    name: 'dep_graph',
    description: 'Build dependency graph for a project and visualize it',
    parameters: z.object({
      path: z.string().optional().describe('Project root path'),
      format: z.enum(['mermaid', 'dot', 'list']).default('list').describe('Output format'),
    }),
    execute: async (params: { path?: string; format: string }) => {
      const cfg = getConfig();
      if (!cfg.enabled) return { error: 'Plugin disabled in settings' };

      const dir = params.path || process.cwd();
      if (!existsSync(dir)) return { error: `Path does not exist: ${dir}` };

      const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
      const graph = buildGraph(dir, cfg.maxDepth, patterns);

      switch (params.format) {
        case 'mermaid':
          return { result: generateMermaidGraph(graph) };
        case 'dot':
          return { result: generateDotGraph(graph) };
        case 'list':
        default:
          return { result: generateListGraph(graph) };
      }
    },
  });

  tools.register({
    name: 'dep_circular',
    description: 'Detect circular dependencies in the project',
    parameters: z.object({
      path: z.string().optional().describe('Project root path'),
    }),
    execute: async (params: { path?: string }) => {
      const cfg = getConfig();
      if (!cfg.enabled) return { error: 'Plugin disabled in settings' };

      const dir = params.path || process.cwd();
      if (!existsSync(dir)) return { error: `Path does not exist: ${dir}` };

      const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
      const graph = buildGraph(dir, cfg.maxDepth, patterns);
      const cycles = detectCircularDeps(graph);

      if (cycles.length === 0) {
        return { result: 'No circular dependencies found.' };
      }

      const formatted = cycles.map((cycle, i) => {
        const names = cycle.map((p) => p.split(/[/\\]/).pop() || p);
        return `Cycle ${i + 1}: ${names.join(' → ')}`;
      });

      return { result: formatted.join('\n') };
    },
  });

  tools.register({
    name: 'dep_orphans',
    description: 'Find orphan modules not imported by anything',
    parameters: z.object({
      path: z.string().optional().describe('Project root path'),
    }),
    execute: async (params: { path?: string }) => {
      const cfg = getConfig();
      if (!cfg.enabled) return { error: 'Plugin disabled in settings' };

      const dir = params.path || process.cwd();
      if (!existsSync(dir)) return { error: `Path does not exist: ${dir}` };

      const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
      const graph = buildGraph(dir, cfg.maxDepth, patterns);
      const orphans = findOrphanModules(graph);

      if (orphans.length === 0) {
        return { result: 'No orphan modules found.' };
      }

      const formatted = orphans.map((o) => o.split(/[/\\]/).pop() || o);
      return { result: `Found ${orphans.length} orphan modules:\n${formatted.join('\n')}` };
    },
  });

  tools.register({
    name: 'dep_impact',
    description: 'Analyze the impact of changing a specific module',
    parameters: z.object({
      module: z.string().describe('File path of the module to analyze'),
      path: z.string().optional().describe('Project root path'),
    }),
    execute: async (params: { module: string; path?: string }) => {
      const cfg = getConfig();
      if (!cfg.enabled) return { error: 'Plugin disabled in settings' };

      const dir = params.path || process.cwd();
      if (!existsSync(dir)) return { error: `Path does not exist: ${dir}` };

      const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
      const graph = buildGraph(dir, cfg.maxDepth, patterns);
      const targetModule = resolve(dir, params.module);

      if (!graph.has(targetModule)) {
        return { error: `Module not found in graph: ${params.module}` };
      }

      const affected = findImpactSet(targetModule, graph);

      if (affected.size === 0) {
        return { result: `No modules would be affected by changing ${params.module}` };
      }

      const formatted = Array.from(affected).map((a) => a.split(/[/\\]/).pop() || a);
      return { result: `Changing ${params.module} would affect ${affected.size} modules:\n${formatted.join('\n')}` };
    },
  });

  tools.register({
    name: 'dep_coupling',
    description: 'Calculate coupling metrics for all modules',
    parameters: z.object({
      path: z.string().optional().describe('Project root path'),
    }),
    execute: async (params: { path?: string }) => {
      const cfg = getConfig();
      if (!cfg.enabled) return { error: 'Plugin disabled in settings' };

      const dir = params.path || process.cwd();
      if (!existsSync(dir)) return { error: `Path does not exist: ${dir}` };

      const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
      const graph = buildGraph(dir, cfg.maxDepth, patterns);
      const metrics = calculateCoupling(graph);

      const formatted = metrics.slice(0, 30).map((m) => {
        const name = m.module.split(/[/\\]/).pop() || m.module;
        return `${name} | Afferent: ${m.afferentCoupling} | Efferent: ${m.efferentCoupling} | Instability: ${m.instability.toFixed(2)}`;
      });

      return { result: `Coupling metrics (top 30 by instability):\n${formatted.join('\n')}` };
    },
  });

  tools.register({
    name: 'dep_package',
    description: 'Analyze package.json for outdated, unused, or missing dependencies',
    parameters: z.object({
      path: z.string().optional().describe('Project root path'),
    }),
    execute: async (params: { path?: string }) => {
      const cfg = getConfig();
      if (!cfg.enabled) return { error: 'Plugin disabled in settings' };

      const dir = params.path || process.cwd();
      if (!existsSync(dir)) return { error: `Path does not exist: ${dir}` };

      const analysis = analyzePackageJson(dir);
      if (!analysis) {
        return { error: 'No package.json found in the specified directory' };
      }

      const lines: string[] = [];
      lines.push(`Dependencies: ${Object.keys(analysis.dependencies).length}`);
      lines.push(`Dev Dependencies: ${Object.keys(analysis.devDependencies).length}`);
      lines.push(`Used in code: ${analysis.used.length}`);

      if (analysis.unused.length > 0) {
        lines.push(`\nPossibly unused (${analysis.unused.length}):\n${analysis.unused.join('\n')}`);
      }
      if (analysis.missing.length > 0) {
        lines.push(`\nMissing from package.json (${analysis.missing.length}):\n${analysis.missing.join('\n')}`);
      }

      return { result: lines.join('\n') };
    },
  });

  commands.register({
    name: '/dep',
    description: 'Dependency graph analysis commands',
    usage: '/dep <graph|circular|orphans|impact|coupling> [path] [module]',
    execute: async (args: string) => {
      const cfg = getConfig();
      if (!cfg.enabled) return 'Plugin disabled in settings';

      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0];
      const path = parts[1] || process.cwd();

      switch (subcommand) {
        case 'graph': {
          const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
          const graph = buildGraph(path, cfg.maxDepth, patterns);
          return generateListGraph(graph);
        }
        case 'circular': {
          const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
          const graph = buildGraph(path, cfg.maxDepth, patterns);
          const cycles = detectCircularDeps(graph);
          if (cycles.length === 0) return 'No circular dependencies found.';
          return cycles.map((c, i) => `Cycle ${i + 1}: ${c.map((p) => p.split(/[/\\]/).pop()).join(' → ')}`).join('\n');
        }
        case 'orphans': {
          const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
          const graph = buildGraph(path, cfg.maxDepth, patterns);
          const orphans = findOrphanModules(graph);
          if (orphans.length === 0) return 'No orphan modules found.';
          return `Found ${orphans.length} orphans:\n${orphans.map((o) => o.split(/[/\\]/).pop()).join('\n')}`;
        }
        case 'impact': {
          const module = parts[2];
          if (!module) return 'Usage: /dep impact <path> <module>';
          const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
          const graph = buildGraph(path, cfg.maxDepth, patterns);
          const targetModule = resolve(path, module);
          const affected = findImpactSet(targetModule, graph);
          if (affected.size === 0) return `No modules affected by changing ${module}`;
          return `Changing ${module} affects ${affected.size} modules:\n${Array.from(affected).map((a) => a.split(/[/\\]/).pop()).join('\n')}`;
        }
        case 'coupling': {
          const patterns = cfg.ignorePatterns.split(',').map((p: string) => p.trim());
          const graph = buildGraph(path, cfg.maxDepth, patterns);
          const metrics = calculateCoupling(graph);
          return metrics.slice(0, 20).map((m) => {
            const name = m.module.split(/[/\\]/).pop() || m.module;
            return `${name} | Ce: ${m.afferentCoupling} | Ca: ${m.efferentCoupling} | I: ${m.instability.toFixed(2)}`;
          }).join('\n');
        }
        default:
          return 'Usage: /dep <graph|circular|orphans|impact|coupling> [path] [module]';
      }
    },
  });
}
