# Kai Tak Stadium 室内数字孪生

- 以 `docs/UGOD6100F_Technical_Roadmap_KaiTak_v7.5.pdf` 中已提交的 v7.5 定稿为实施基线。项目覆盖启德主场馆五层的演唱会散场监测与引导。
- M1–M5 构成孪生平台。JuPedSim 是独立测试台，通过 M2 上报模拟计数并接收已审批的引导。测试台真值和个体遵从信息用于评估。
- 室内 M2 使用独立的 MongoDB 数据库、数据结构、FastAPI 应用和 WebSocket 接口。
- `Community_Accessibility_DT`（原目录名 `KaiTak_DT`）是历史社区道路封闭与可达性项目。其业务代码、库表、API、界面、测试结果和旧路线图只用于明确提出的历史参考。
- v7.5 指定的既有 OSM 场馆底图可作为静态素材单独引入，并记录来源。正式室内区域和设施 ID 以组长交付的模型清单为准。临时样例与待确认字段须标明状态。
