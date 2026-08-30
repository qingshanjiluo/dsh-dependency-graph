import React from 'react';

export const inject = ['settingsScope', 'slots', 'locale'] as const;

const en = {
  'depGraph.title': 'Dependency Graph',
  'depGraph.enabled': 'Enable dependency graph plugin',
  'depGraph.maxDepth': 'Max walk depth',
  'depGraph.description': 'Analyzes project dependencies, detects circular deps, orphans, and coupling metrics.',
};

const zh = {
  'depGraph.title': '依赖图谱',
  'depGraph.enabled': '启用依赖图谱插件',
  'depGraph.maxDepth': '最大遍历深度',
  'depGraph.description': '分析项目依赖关系，检测循环依赖、孤立模块和耦合指标。',
};

export function apply(ctx: any) {
  const { settingsScope, locale } = ctx;

  if (locale?.register) {
    locale.register('en', en);
    locale.register('zh', zh);
  }

  if (settingsScope?.registerCard) {
    settingsScope.registerCard('dsh-dependency-graph', function DepGraphCard() {
      const [enabled, setEnabled] = React.useState<boolean>(
        settingsScope.get('dsh-dependency-graph')?.enabled ?? true
      );
      const [maxDepth, setMaxDepth] = React.useState<number>(
        settingsScope.get('dsh-dependency-graph')?.maxDepth ?? 5
      );

      React.useEffect(() => {
        settingsScope.set('dsh-dependency-graph', { enabled, maxDepth });
      }, [enabled, maxDepth]);

      return React.createElement(
        'div',
        { style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column' } },
            React.createElement('span', { style: { fontWeight: 600, fontSize: '14px' } }, 'Dependency Graph'),
            React.createElement('span', { style: { fontSize: '12px', color: '#888', marginTop: '2px' } }, 'Analyze project module dependencies')
          ),
          React.createElement(
            'label',
            { style: { position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' } },
            React.createElement('input', {
              type: 'checkbox',
              checked: enabled,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked),
              style: { opacity: 0, width: 0, height: 0 },
            }),
            React.createElement(
              'span',
              {
                style: {
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: enabled ? '#3b82f6' : '#555',
                  borderRadius: '12px',
                  transition: 'background-color 0.2s',
                },
              },
              React.createElement('span', {
                style: {
                  position: 'absolute',
                  left: enabled ? '22px' : '2px',
                  top: '2px',
                  width: '20px',
                  height: '20px',
                  backgroundColor: '#fff',
                  borderRadius: '50%',
                  transition: 'left 0.2s',
                },
              })
            )
          )
        ),
        React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          React.createElement('label', { style: { fontSize: '13px', color: '#aaa' } }, 'Max Depth'),
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement('input', {
              type: 'range',
              min: 1,
              max: 20,
              value: maxDepth,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMaxDepth(parseInt(e.target.value, 10)),
              style: { flex: 1, accentColor: '#3b82f6' },
            }),
            React.createElement(
              'span',
              { style: { minWidth: '24px', textAlign: 'right', fontSize: '13px', fontWeight: 600 } },
              String(maxDepth)
            )
          )
        ),
        React.createElement(
          'p',
          { style: { fontSize: '12px', color: '#666', margin: 0, lineHeight: '1.5' } },
          'Detects circular dependencies, orphan modules, coupling metrics, and can generate Mermaid/DOT visualizations.'
        )
      );
    });
  }
}
