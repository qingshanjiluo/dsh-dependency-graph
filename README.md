# dsh-dependency-graph

> DeepSeek Harness 依赖图分析插件

## 功能

- 📊 **依赖图可视化**: Mermaid/DOT/文本格式
- 🔄 **循环检测**: 发现循环依赖
- 🏝️ **孤儿模块**: 未被导入的模块
- 💥 **影响分析**: 修改模块的影响范围
- 📈 **耦合指标**: 计算 Afferent/Efferent 耦合度

## 工具

| 工具名 | 说明 |
|--------|------|
| `dep_graph` | 构建依赖图 |
| `dep_circular` | 检测循环依赖 |
| `dep_orphans` | 查找孤儿模块 |
| `dep_impact` | 影响分析 |
| `dep_coupling` | 耦合度分析 |
| `dep_package` | 分析 package.json |

## License

MIT
