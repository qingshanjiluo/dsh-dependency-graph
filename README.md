# dsh-dependency-graph

> DeepSeek Harness 依赖图分析

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 功能特性

- 📊 **依赖图可视化**: Mermaid/DOT/文本格式
- 🔄 **循环检测**: 发现循环依赖
- 🏝️ **孤儿模块**: 未被导入的模块
- 💥 **影响分析**: 修改模块的影响范围
- 📈 **耦合指标**: 计算 Afferent/Efferent 耦合度

## 📦 安装

```bash
npm install dsh-dependency-graph
```

## 🛠️ 工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `dep_graph` | 构建依赖图 | `path`, `format` |
| `dep_circular` | 检测循环依赖 | `path` |
| `dep_orphans` | 查找孤儿模块 | `path` |
| `dep_impact` | 影响分析 | `module` |
| `dep_coupling` | 耦合度分析 | `path` |
| `dep_package` | 分析 package.json | `path` |

## 📋 命令

- `/dep graph` — 依赖图
- `/dep circular` — 循环检测
- `/dep orphans` — 孤儿模块
- `/dep impact <module>` — 影响分析
- `/dep coupling` — 耦合度

## ⚙️ 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `true` | 启用插件 |
| `maxDepth` | number | `5` | 最大遍历深度 |

## 📄 License

MIT
