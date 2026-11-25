# Kai Tak Main Stadium · 散场数字孪生原型（v0.1）

基线：`docs/UGOD6100F_Technical_Roadmap_KaiTak_v7.5.pdf`（课程文件，不随仓库公开）。本原型在缩小的范围内跑通 M1–M5 闭环，所有场馆 ID 和下面列出的参数都是 **provisional（待组长确认）**。

## 范围

- 场馆西半边：下层看台 15 区、内场西半 3 区、2/F 环廊 12 格、15 个通道口、2 条内场通道、Gate F/E/D/C。共 51 个分区、9,899 人。
- 演示事件：散场 120 秒时关闭 Gate D。
- 没做的：其余四层和东半边、JuPedSim 测试台（目前用 `testbed/meso.py` 分区级模型顶替，接口相同）。

扩大范围只改 `m1_venue/config.yaml` 再重跑 `build_layout.py`；其他模块只读 `m1_venue/out/venue_manifest.json`。

## 启动

```bash
cd KaiTak_Stadium_Twin
docker compose up -d                                  # MongoDB，端口 27027
.venv/bin/uvicorn m2_service.app:app --port 8010      # M2，同时提供看板
open http://127.0.0.1:8010/
```

首次安装：`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`，`cd m5_dashboard && npm install && npm run build`。
改了看板代码要重新 `npm run build`；`m5_dashboard/dist` 是新建的话还要重启 uvicorn。

看板里选好场景，点 **Start egress**。审批选 “Duty manager approves” 时，右侧出现提案后点 Approve / Reject，取消勾选某一行可以让那块显示屏保持不变。

## 模块

| 目录 | 内容 |
| --- | --- |
| `m1_venue/` | `export_blend.py`（Blender 导出几何，只读 `.blend`）、`build_layout.py`（生成分区、计数线、显示屏、图、可步行面和 QA 报告）、`config.yaml`（范围和假设值）、`out/`（产物） |
| `contracts/` | `schemas.py` 数据契约 v0.1，`venue.py` 各模块共用的 M1 读取器 |
| `m2_service/` | FastAPI + MongoDB + WebSocket；`core.py` 把 M3、M4 串成一个会话，服务和离线实验共用 |
| `m3_state/` | 分区人数估计（流量守恒 + 逐区修正）和 2 分钟预测 |
| `m4_guidance/` | 引导提案、审批、遵从率估计 |
| `m5_dashboard/` | Three.js 看板（Vite 构建） |
| `testbed/` | 测试台、场景运行器、批量实验，结果在 `results/` |
| `tests/` | `.venv/bin/python -m pytest -q` |

重建 M1（约 90 秒）：

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b ../Kai_Tak_Peak_Routes.blend --python m1_venue/export_blend.py -- m1_venue/out
.venv/bin/python m1_venue/build_layout.py
```

## 检查

```bash
.venv/bin/python -m pytest -q                 # 8 项：M1 一致性、契约拒收、密度误差、引导效果、审批、摄像头掉线、遵从率
.venv/bin/python -m testbed.experiment        # 5 个种子 × 7 组，要几分钟，写入 testbed/results/
cd m5_dashboard && npm run check              # 无头 Chrome 截图自检，需要 M2 在运行
```

`npm run check` 会在页面报错、画面全黑、或镜头扫过时出现黑帧的情况下失败。带场景的用法见 `m5_dashboard/tools/shot.mjs` 开头。

## 实验结果（5 个种子，Gate D 在 120 秒关闭）

| 组 | T90（秒） | 超 2.2 人/m² 的分区·秒 | 遵从率 估计 / 真值 |
| --- | --- | --- | --- |
| 全开，无引导 | 1152 | 1631 | |
| 关 D，无引导 | 1282 | 1891 | |
| 关 D，引导 p=0.20 | 1076 | 1459 | 0.21 / 0.20 |
| 关 D，引导 p=0.35 | 955 | 1208 | 0.36 / 0.35 |
| 关 D，引导 p=0.50 | 874 | 1079 | 0.51 / 0.50 |
| 关 D，引导 p=0.65 | 876 | 806 | 0.65 / 0.65 |
| 关 D，引导 p=0.80 | 837 | 922 | 0.78 / 0.80 |

- 标准 (a) 密度误差 ≤ 0.5：35 次运行中最大 0.19 人/m²；无监控分区最大 0.07。
- 标准 (b)：每个 p、每个种子的 T90 和超阈值时长都低于同种子的无引导组。
- 标准 (c)：最低有效 p 为 0.2（扫描范围的下限，没有测更低的值）。

明细在 `testbed/results/runs.csv`、`summary.json`、`summary.png`。

## 读这些数字时要知道的

- **峰值密度没有降下来。** 所有组的峰值都到 4.0 人/m²，这是模型设的拥堵上限。内场通道 T02 和环廊 C10 在全开无引导时就超阈值，引导缩短的是超阈值的时长，不是峰值。
- **超阈值时长不随 p 单调下降。** p=0.8 比 p=0.65 差（922 对 806），其中种子 2 到 1160。原因没有查。
- **测试台不是 JuPedSim。** 它是分区级模型，没有个体间的避让，也没有校准过。
- **预测技能是上限。** M3 的前推和测试台用同一条速度–密度公式（Weidmann 1993）。
- **遵从率估计在批准得晚时偏低。** 批量实验里估计和真值最多差 0.03；但手动审批拖到 100 秒以后才批（被引导的人少于约 700）时，估计值比真值低 0.04–0.07（只试了种子 1、p=0.5）。
- **预测会漏报。** 35 次运行合计，真正超阈值的分区时刻有 83% 提前 2 分钟报出，报出的里面 13% 是误报。
- **几何是假设的。** 环廊宽度、闸口宽度、通道口、内场通道位置都不在 `.blend` 里，见下表。`.blend` 自述 “No surveyed indoor or emergency circulation model”。

## 假设值（`m1_venue/config.yaml`，全部列在 `m1_venue/out/qa_report.md`）

| 参数 | 值 | 依据 |
| --- | --- | --- |
| 环廊宽度 | 17 m | `.blend` 里 East concourse 内景的宽度 |
| 通道口宽度 | 3 m | 假设，`.blend` 没有通道口 |
| 闸口宽度 / 进深 | 8 m / 12 m | 假设，OSM 只有闸口点 |
| 闸口有效通过比例 | 0.4 | 假设 |
| 比流量 | 1.3 人/(m·s) | SFPE 手册量级，出处待补 |
| 拥堵密度 | 4.0 人/m² | 假设 |
| 内场通道 | 宽 5 m，在 128° 和 232° | 假设，`.blend` 没有内场通道 |
| 无监控环廊格 | C03、C06、C09、C12 | 假设 |
| 舞台后不售票 | S01–S04 | 按 `.blend` 舞台位置推断 |

## 待组长确认

1. 这个范围（西半边、下层看台 + 内场）是否接受。
2. 舞台朝向：`.blend` 在北端，路线图文字写南端，目前按 `.blend`。
3. 闸口位置：取 OSM 点沿射线落到模型外立面，偏差 F 6.7 m、E 1.9 m、D 1.4 m、C 3.5 m。
4. 正式的分区和设施 ID 清单（manifest 里预留了 `official_sections`）。
5. 官方座位图和各区座位数；目前按 `.blend` 的座椅实例数。

## 数据来源

- 几何：`../Kai_Tak_Peak_Routes.blend`（只读，QA 报告里记了 sha256）。
- 坐标原点和闸口点：`Community_Accessibility_DT` 的 `origin_fit.json` 和 OSM 底图，EPSG:2326，`x = E − 838186.926`，`y = N − 820553.488`。
- 看板截图：`docs/screenshots/`。
