import React from 'react';
import { createSettingsCard } from '@deepseek-ai/dsh-settings';

export default createSettingsCard({
  title: 'dependency-graph',
  description: '依赖图分析',
  config: [
    { key: 'enabled', type: 'boolean', label: '启用插件', default: true },
    { key: 'maxDepth', type: 'number', label: '最大遍历深度', default: 5 },
  ],
});
