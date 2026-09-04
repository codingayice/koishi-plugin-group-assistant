# 更新日志

## 2.0.0 - 2026-09-04

### 行为治理

- 使用 GCRA（通用信元速率算法）重构单人刷屏检测，以统一的理论到达时间同时识别瞬时连发和持续高频发送。
- 刷屏状态按群聊和用户隔离，防止跨群消息相互影响。
- 处罚后进入冷却期，避免同一轮刷屏被连续重复处置。
- 审计证据增加允许速率、突发余量、虚拟欠账、超限容差和违规节点，便于管理员复盘。
- 调整宽松、均衡和严格预设，使刷屏策略直接对应每分钟允许消息数、突发余量与处罚冷却时间。

### 工程质量

- 补充 GCRA 瞬时刷屏、慢速刷屏、状态隔离、策略重置和处罚冷却测试。
- 测试构建显式排除 Koishi 运行时依赖，允许直接验证生产治理链路。

### 升级注意事项

- 本版本移除了旧版滑动窗口和令牌桶配置。升级后请使用 `floodRatePerMinute`、`floodBurstAllowance` 与 `floodCooldownSeconds` 配置刷屏检测。
- 原有的 `burstDetectionEnabled`、`burstLimit`、`burstWindowSeconds`、`sustainedRateEnabled`、`sustainedBucketCapacity`、`sustainedRefillPerMinute` 与 `sustainedCostPerMessage` 不再生效。

## 1.3.0 - 2026-09-01

- 内容检测统一升级为七分类：不违规、普通广告、黑产广告、谩骂引战、低俗色情、博彩、欺诈。
- AI 复核改为输出七分类结果，并由分类结果统一推导是否违规。
- 本地模型证据改为显示模型分类、分类置信度和总违规概率。
- 违规处罚模板支持“疑似分类内容”提示，普通广告提示用户仔细甄别。
- 补充七分类模型、模型自动发现路径和配套子插件内置模型分发说明。

### 升级注意事项

- 旧版六分类模型以及 `normal/spam` 二分类模型不再兼容。
- 模型文件不在主体插件 npm 包中，随 `koishi-plugin-group-assistant-model-onnx` 一起发布。
