# 第一阶段并行任务（T1–T6）

依据：`docs/execution_plan_v0.2.md`。分支起点：`main` 上的 T0 提交。每个任务一个分支、一个 agent，做完由主线程按第 4 节的顺序合并检查。

## 状态（2026-11-27）

- `phase1/T1`–`T6` 的分支和 worktree 已删除，删除前都没有提交和改动。
- T2 的回归部分已在 `main` 上完成：
  - `tests/test_regression.py` 已建好，参照冻结在 `tests/data/meso_runs_v0.1.csv`（与 `testbed/results/runs.csv` 相同）。
  - `testbed/meso.py` 已改从 `venue.out_dir` 读出生点。
  - T2 只剩 `crowd.py`，即第 4–6 步。
- T6 移到平台线，分支 `twin/P4-m1-presets`。规格仍以本文件的 T6 为准，差别见 `docs/platform_tasks.md` 的 P4。
- 评测线 T1、T2（`crowd.py`）、T3、T4、T5 目前没有负责人。它们对应执行方案里标"必须"的 S0、A、B。组里要么定负责人和日期，要么记为对 v7.5 的范围调整。重新开工时按本文件建分支 `phase1/<任务号>-<名称>`。

## 0. 开工前已完成（T0，在 `main` 上）

| 项 | 文件 | 内容 |
| --- | --- | --- |
| 契约 v0.2 | `contracts/schemas.py` | `CONTRACT_VERSION = "0.2"`；`RunControl` 新增 `testbed`、`layout`、`record_trajectory`、`scale`，都带默认值 |
| 预设目录 | `contracts/venue.py` | `DEFAULT_LAYOUT`、`preset_dir(layout)`、`list_presets()`；`Venue.out_dir` |
| JuPedSim 参数 | `testbed/jps_params.yaml`、`testbed/jps_config.py` | 模型参数照抄 JuPedSim 1.4.2 默认值；`gate_clear_width_m: null`，等 B2 标定后填写。`jps_config.py` 不导入 jupedsim |
| 测试台环境 | `requirements-testbed.txt`、本机 `.venv312` | Python 3.12.14、JuPedSim 1.4.2、PedPy 1.5.1，与 `.venv`（3.10）并存 |
| 测试配置 | `pytest.ini` | `pytest -q` 只跑 `tests/`，默认跳过 `slow` 标记的测试 |
| 契约测试 | `tests/test_contracts.py` | 新字段默认值、`preset_dir`、参数文件与 JuPedSim 默认值一致（只在 `.venv312` 下运行，3.10 下跳过） |
| `.gitignore` | | `.venv`、`.venv310`、`.venv312`（不带斜杠，worktree 里的软链接也能忽略）、`testbed/results/traj/` |

T0 的验收结果：`.venv` 下 11 项通过、1 项跳过；`.venv312` 下 12 项通过；简化模型重跑 `runs.csv` 的 2 行，逐字段相同；在临时目录里重跑 `build_layout.py`，6 个 GeoJSON/JSON 和 `spawn.json`、`seats.bin` 逐字节相同，只有 `venue_manifest.json` 的 `built_at` 和 `qa_report.md` 的时间戳不同。

## 1. 所有 agent 都要遵守

**工作位置**：每个任务一个 worktree，路径 `../KaiTak_Stadium_Twin-wt/<任务号>`，分支 `phase1/<任务号>-<名称>`。只在自己的 worktree 里改动和提交，不要切换分支，不要改 `main`。

**Python 环境**：worktree 里有 `.venv` 和 `.venv312` 的软链接，指向主仓库的环境。不要往环境里安装或升级任何包；缺包时停下来报告。
- 原型和简化模型：`.venv/bin/python`（3.10）
- JuPedSim、PedPy、验证：`.venv312/bin/python`（3.12）

**先读**：`AGENTS.md`；`docs/execution_plan_v0.2.md` 的 2.0 原则，以及各任务指定的章节。

**禁止改动**（任何任务都不能改，需要改就停下来报告）：
- `m3_state/`、`m4_guidance/`、`m2_service/`、`contracts/`
- `testbed/jps_params.yaml`、`testbed/jps_config.py`
- `testbed/results/runs.csv`、`summary.json`、`summary.png`
- `m1_venue/out/` 里已提交的文件（只有 T6 在比对通过后可以改）
- `README.md`、`docs/`（收尾时统一改）
- `../Kai_Tak_Peak_Routes.blend`（只读）

**提交**：小步提交，提交信息用英文，以任务号开头，例如 `T2: add meso regression baseline`。

**完成时报告**：
1. 改动的文件清单。
2. 验收命令和**实际输出**（贴原文，不要只写"通过"）。
3. 没做完的、偏离方案的地方，以及原因。
4. 发现的方案问题。发现方案写错了，不要自己改方案，写在报告里。

## 2. 任务

| 任务 | 分支 | 名称 | 环境 | 依赖 | 估时 |
| --- | --- | --- | --- | --- | --- |
| T1 | `phase1/T1-env-check` | 测试台环境核对 | 两个都用 | 无 | 0.5 h |
| T2 | `phase1/T2-crowd-regression` | 回归基线和 `crowd.py` | `.venv` | 无 | 2–3 h |
| T3 | `phase1/T3-runner-cli` | runner 和 experiment 加参数 | `.venv` | 无（合并在 T2 之后） | 1–2 h |
| T4 | `phase1/T4-jps-geometry` | JuPedSim 几何和自检 | `.venv312` | 无 | 3–4 h |
| T5 | `phase1/T5-tn1822-rigs` | TN 1822 房间类台架 | `.venv312` | 无 | 4–6 h |
| T6 | `phase1/T6-m1-presets` | M1 舞台预设 | `.venv` | 无 | 0.5–1 人天 |

### T1 测试台环境核对

**目的**：确认 `.venv312` 能复现，并给其他人一份可照做的安装说明。

**只能改**：新建 `testbed/ENV.md`（环境说明，收尾时并入 README）。`requirements-testbed.txt` 有问题时可以改。

**做什么**：
1. 在临时目录（`$TMPDIR`，不要放在仓库里）按 `requirements-testbed.txt` 开头的命令从零新建一个环境，记下每一步的输出和用时。
2. 在新环境里跑 `python -m pytest -q`，应为 12 项通过。
3. 导入检查：`jupedsim`、`pedpy`、`shapely`、`numpy`、`pandas` 的版本；`jupedsim.Simulation`、`SqliteTrajectoryWriter`、`Simulation.switch_agent_journey`、`Simulation.removed_agents` 存在；PedPy 的 `compute_individual_voronoi_polygons`、`compute_density_profile`、`compute_classic_density`、`compute_individual_speed`、`compute_mean_speed_per_frame`、`compute_n_t`、`compute_flow` 存在。
4. 记下环境总大小，确认没有装上 PySide6 和 VTK。
5. 把 `uv pip freeze` 的结果写进 `testbed/ENV.md`。
6. 删除临时环境。

**验收**：`testbed/ENV.md` 里有从零安装的步骤、每一步的实际输出摘要、pytest 结果、版本表和 freeze 清单。

### T2 回归基线和 `crowd.py`

**目的**：两个测试台共用同一份人群；重构前后简化模型的结果逐字段相同。

**先读**：方案 2.1 的"回归基线"和"`testbed/crowd.py`"、1.1 的 A3。

**只能改**：新建 `tests/data/meso_runs_v0.1.csv`、`tests/test_regression.py`、`testbed/crowd.py`；修改 `testbed/meso.py`。

**做什么**（顺序不能换）：
1. 把 `testbed/results/runs.csv` 复制为 `tests/data/meso_runs_v0.1.csv`。
2. 写 `tests/test_regression.py`：
   - 快速测试（不加标记）：重跑 3 行（`open-no-guidance`、`closed-no-guidance`、`closed-guided-p0.50`，种子 1），按 CSV 的每一列逐字段比较。`None` 对应 CSV 里的空字符串。调用方式照 `testbed/experiment.py` 的 `one()`。
   - 全量测试（`@pytest.mark.slow`）：重跑全部 35 行并逐字段比较，不写任何文件。
3. **在没改代码之前**跑一遍，两个测试都通过，提交。
4. 新建 `testbed/crowd.py`：`V_FREE = 1.34`、`ROW_SPEED = 0.6`；`draw(venue, rng, p_follow, premove_median_s=75.0)` 返回 `zone, xy, factor, premove, follower`。抽样顺序和对象必须与现在 `MesoTestbed.__init__` 完全相同：先 `normal(1.0, 0.15)` 截断到 0.6–1.4，再 `lognormal`，再 `random`。`spawn.json` 从 `venue.out_dir` 读，不用 `M1_OUT`。
5. `meso.py` 改用 `crowd.draw`。`V_FREE` 从 `crowd` 导入，`weidmann()` 不动；`ready` 里的 `0.6` 改用 `ROW_SPEED`。`MesoTestbed` 的参数、属性名和行为都不变。
6. 再跑一遍，两个测试都通过。

**验收**：
- `.venv/bin/python -m pytest -q` 全部通过。
- `.venv/bin/python -m pytest -q -m slow tests/test_regression.py` 通过（35 行）。
- 报告里写明第 3 步和第 6 步各自的输出。

### T3 runner 和 experiment 加参数

**目的**：让 runner 能按 `RunControl` 选测试台和舞台预设，批量实验能指定种子、输出目录和并行数。

**先读**：方案 2.1 的"`testbed/runner.py`"和"`testbed/experiment.py`"。

**只能改**：`testbed/runner.py`、`testbed/experiment.py`、`testbed/run.py`；新建 `tests/test_runner_cli.py`。

**做什么**：
1. `runner.py`：
   - 新增 `make_testbed(cfg, venue)`：`cfg.testbed == "meso"` 时返回 `MesoTestbed(seed=cfg.seed, p_follow=cfg.p_follow, venue=venue)`；`"jupedsim"` 时抛 `NotImplementedError("JuPedSim testbed lands in phase 2 (testbed/jps.py)")`。`scale` 不等于 1 且测试台是 meso 时抛 `ValueError`。
   - `SOURCE` 改成按测试台取值：`testbed:meso` 或 `testbed:jupedsim`。
   - `venue` 缺省时用 `Venue(preset_dir(cfg.layout))`。
   - summary 里加 `testbed` 和 `layout` 两个键。`runs.csv` 的列由 `experiment.py` 的 `keys` 决定，新键不会进 CSV，回归不受影响。
2. `experiment.py`：
   - 加参数 `--testbed {meso,jupedsim}`（默认 meso）、`--layout`（默认 north_end）、`--out`（默认 `testbed/results`，jupedsim 时默认 `testbed/results/jupedsim`）、`--seeds`（如 `1,2,3`，默认 1–5）、`--jobs`（默认 1，大于 1 时用 `multiprocessing` 的 `spawn` 上下文按运行并行）。`--quick` 保留，等于 `--seeds 1`。
   - 并行时结果按"种子、组"的原顺序排序后再写文件，保证与串行输出相同。
   - 只写到 `--out` 指定的目录。**默认参数下的输出必须与现在完全相同。**
3. `run.py`：保持现有行为；`venue` 按 `cfg.layout` 取。

**验收**：
- `.venv/bin/python -m pytest -q` 全部通过。
- `tests/test_runner_cli.py`：`make_testbed` 对 jupedsim 抛 `NotImplementedError`；summary 里有 `testbed` 和 `layout`；`--jobs 2 --seeds 1 --out <tmp>` 与 `--jobs 1 --seeds 1 --out <tmp2>` 生成的 `runs.csv` 相同。
- 手动跑一次：`.venv/bin/python -m testbed.experiment --seeds 1 --out $TMPDIR/t3`，生成的 `runs.csv` 与 `testbed/results/runs.csv` 中种子 1 的 7 行逐字段相同。
- 不能覆盖 `testbed/results/` 下的文件。

**和 T2 的关系**：T3 不改 `meso.py`，T2 不改 `runner.py` 和 `experiment.py`，两者不冲突。合并时先合 T2。

### T4 JuPedSim 几何和自检（A1）

**目的**：把 M1 的可步行面变成 JuPedSim 能用的几何，并在出任何仿真数字之前，确认几何本身没有问题。

**先读**：方案 2.2.1、2.2.2、2.2.5，以及 0.2 第 5、6 条和附录 A 的"不依赖仿真的核对"。

**只能改**：新建 `testbed/jps_geometry.py`、`tests/test_jps_geometry.py`、`testbed/results/jps_geometry_check.md`。

**接口**：

```python
def load(venue, params, gate_clear_width_m) -> Geometry
# Geometry 至少包括：
#   walkable: shapely Polygon      清理后、加了门墩的可步行面
#   exits: dict[gate_id, Polygon]  4 个 exit:* 多边形
#   zones: dict[zone_id, Polygon]  51 个分区多边形
#   zone_tree: shapely.STRtree     按点查分区
#   spawn: dict[zone_id, ndarray]  挪离墙之后的出生点
#   gate_cells: dict[gate_id, list[zone_id]]   实际挨着闸口的环廊格（距离 < 0.3 m）
def build_simulation(geom, params, dt_s=None, trajectory_writer=None)
#   -> (jps.Simulation, journeys: dict[gate_id, int], stages: dict[gate_id, int])
def self_check(venue, params, gate_clear_width_m) -> dict    # 每项检查的名称、结果、数值
```

- `gate_clear_width_m` 由调用方传入。参数文件里的值现在是 `null`，测试和自检用 3.2 m 和 4.9 m 两个宽度各跑一遍。
- 门墩的位置和厚度从 `params` 读（`door_offset_m`、`door_thickness_m`）。
- 不做 `jps.py` 的步进、入场、引导和看门狗，那是第二阶段的工作。

**自检**（方案 2.2.2，全部写进 `jps_geometry_check.md`，包括数值）：
1. 清理后的可步行面是 1 个合法多边形、1 个洞（约 2,742 m²）；与 M1 的面积差只来自门墩。
2. 9,899 个出生点都在可步行面内；离墙不足 0.25 m 的挪到 0.26 m（预期约 25 个），记录挪动的个数和最大距离；座位最小间距 ≥ 0.4 m。
3. 每个有人的分区都能用 `jps.RoutingEngine(walkable).compute_waypoints` 走到 4 个出口。
4. 可步行面往里收 1.2 m 仍然连通。
5. `gate_cells` 的结果，预期为 F: C03，E: C05，D: C08 和 C09，C: C10。
6. 门墩完全落在 8 m 宽的闸口分区内，分区多边形不变。
7. `build_simulation` 能建出 Simulation；在每个分区放 1 个人，`iterate` 200 步不报错。

**验收**：
- `.venv312/bin/python -m pytest -q tests/test_jps_geometry.py` 通过。
- `.venv312/bin/python -m testbed.jps_geometry` 生成 `testbed/results/jps_geometry_check.md`，7 项全部通过。
- 在 `.venv`（3.10）下跑 `pytest -q`，`test_jps_geometry.py` 要用 `pytest.importorskip("jupedsim")` 跳过，不能报错。

### T5 TN 1822 房间类台架（B1 的一部分）

**目的**：在不依赖场馆和 `jps.py` 的前提下，先把 TN 1822 里和场馆无关的测试做出来。

**先读**：方案 2.3.1、2.3.3，以及 1.1 的 A2、A12、A13。

**只能改**：新建 `verification/__init__.py`、`verification/rigs.py`、`verification/test_tn1822.py`、`verification/run.py`、`verification/results/`。

**范围**：

| 测试 | 这一阶段做不做 |
| --- | --- |
| 2.1 走廊速度（0° 和 45°） | 做 |
| 2.3 拐角 | 做 |
| 2.4 人群特征（1.34 × N(1.0, 0.15)，截断 0.80–1.88 m/s） | 做。要等 T2 的 `crowd.py`，先在 rig 里按同一公式抽样，合并后改成调用 `crowd.draw` |
| 2.8 对向流（0、10、50、100 人） | 做 |
| 5.1 拥堵（改造版：末端换成更窄的出口） | 做 |
| 5.2 最大流量（dt 0.05 s 和 0.01 s） | 做 |
| IMO Test 9（1,000 人，4 个出口，再关掉 2 个） | 做 |
| 1.1 准备离场时间 | 先写成 `skip`，要等第二阶段的 `jps.py` 入场逻辑 |
| 3.1 出口分配、4.1 出口关闭 | 先写成 `skip`，要等 `jps.py` |

**规则**：
- 所有参数从 `testbed.jps_config.load_params()` 读，`dt_s` 只有 5.2 可以另外传 0.01。**不能调任何参数让测试通过。** 测试不通过就如实记下，写在报告里。
- 通过标准照方案 2.3.3 的表。每个测试的几何尺寸照 TN 1822 原文；改造过的（5.1）在结果里注明"改造版"和改了什么。
- `verification/run.py` 生成 `verification/results/tn1822.md`（每项一行：测试、几何、标准、实测值、通过与否、用时）和图（N–t 曲线、5.2 的流量）。
- 跑得久的测试加 `@pytest.mark.slow`。

**验收**：
- `.venv312/bin/python -m pytest -q verification` 能跑完。不通过的项也要能跑完，结果写进报告。
- `.venv312/bin/python -m verification.run` 生成 `tn1822.md` 和图。
- 报告里贴出 `tn1822.md` 的表。

### T6 M1 舞台预设（E1-m）

**目的**：M1 能生成 `north_end`（现状）和 `south_end`（镜像）两套产物，而且 `north_end` 和现在逐字节相同。

**先读**：方案 1.2 的 B3、B5、B6、B7，2.6.1、2.6.2。

**只能改**：`m1_venue/build_layout.py`、`m1_venue/config.yaml`；新建 `m1_venue/out/presets/south_end/`、`tests/test_presets.py`。比对通过后可以更新 `m1_venue/out/venue_manifest.json` 和 `qa_report.md`（因为清单会多出 `stage` 和 `pitch_centre` 字段）。

**做什么**：
1. **先建基准。** 用现在的 `build_layout.py` 在临时目录生成一份产物，作为对照。做法：`git archive HEAD m1_venue | tar -x -C $TMPDIR/m1base`，然后在那里运行。注意 `build_layout.py` 读写的都是相对它自己的 `out/`。
2. 把顶层代码包成 `build(preset_id, out_dir)`，命令行加 `--preset`、`--all-presets`、`--out`。不带参数时行为和现在相同（生成 `north_end` 到 `m1_venue/out/`）。
3. `config.yaml` 加 `default_preset` 和 `stage_presets`（方案 2.6.1 的写法）。`assumed.stage_side` 保留不动。
4. `mode: mirror` 只改三处：售票掩码、`stage_block`、`floor_seats` 的 y，都关于 `pitch_centre` 的 y 取镜像。`pitch_centre` 是 `Concert floor` 包围盒的中心，约 (189.98, −195.19)。`CX, CY` 不动。
5. 清单加 `frame.pitch_centre` 和 `stage`（`preset_id`、`mode`、`status`、`label_en`、`label_zh`、`obstacles`、`recommended_close_gate`）。`recommended_close_gate` 按 2.6.2 的规则计算。
6. 非默认预设写到 `m1_venue/out/presets/<id>/`，只写 `venue_manifest.json`、`zones.geojson`、`lines.geojson`、`displays.geojson`、`graph.json`、`walkable.geojson`、`spawn.json`、`qa_report.md`、`preview.png`。**不复制 `venue_lite.glb`、`seats.bin`、`geometry_ref.json`。**
7. **先输出到临时目录比对，再写回仓库。**

**验收**：
- `north_end` 输出与第 1 步的基准相比：6 个 GeoJSON/JSON、`spawn.json`、`seats.bin`、`venue_lite.glb` 逐字节相同；`venue_manifest.json` 只多出 `frame.pitch_centre`、`stage` 两处，`built_at` 不同，其余逐键相同（写一个比较脚本，结果贴进报告）。
- `south_end`：下层 3,874 席，S12–S15 关闭，S11 剩 314 席，内场 6,100 席，合计 9,974；QA 0 失败；`recommended_close_gate` 有值。数字和方案不一致时，**以构建结果为准，并在报告里说明差别**，不要为了凑数字改规则。
- `tests/test_presets.py`：两个预设的分区 ID、线 ID、显示屏 ID 集合相同；`Venue(preset_dir("south_end"))` 能加载；用 `.venv` 跑一次简化模型（`south_end`，全开无引导，种子 1），全部离场。这个测试要等 T3 合入后才能经由 `RunControl.layout` 跑，现在直接构造 `MesoTestbed(venue=Venue(preset_dir("south_end")))`。注意 T2 合入之前，`meso.py` 还从 `M1_OUT` 读 `spawn.json`，人数会不对，所以这一条先标 `xfail`，并注明"等 T2"。
- `.venv/bin/python -m pytest -q` 全部通过。

## 3. 冲突检查

| 文件或目录 | T1 | T2 | T3 | T4 | T5 | T6 |
| --- | --- | --- | --- | --- | --- | --- |
| `requirements-testbed.txt`、`testbed/ENV.md` | ✔ | | | | | |
| `testbed/meso.py`、`testbed/crowd.py`、`tests/test_regression.py`、`tests/data/` | | ✔ | | | | |
| `testbed/runner.py`、`experiment.py`、`run.py`、`tests/test_runner_cli.py` | | | ✔ | | | |
| `testbed/jps_geometry.py`、`tests/test_jps_geometry.py`、`testbed/results/jps_geometry_check.md` | | | | ✔ | | |
| `verification/` | | | | | ✔ | |
| `m1_venue/`、`tests/test_presets.py` | | | | | | ✔ |

没有两个任务改同一个文件。

**读写依赖**：
- T2、T4 读 `m1_venue/out/`，T6 会改其中的 `venue_manifest.json`。T6 只新增字段，不改原有键，所以 T2、T4 不受影响。合并后由主线程复核。
- T5 的 2.4 暂时自己抽样，T2 合入后改成调用 `crowd.draw`。这一步放到第二阶段。

## 4. 合并顺序和关口 1 检查

```text
T1 → T2 → T3 → T6 → T4 → T5
```

每合一个，在 `main` 上跑：

```bash
.venv/bin/python -m pytest -q
.venv312/bin/python -m pytest -q
```

全部合完后再跑：

```bash
.venv/bin/python -m pytest -q -m slow tests/test_regression.py     # 35 行逐字段相同
.venv/bin/python -m testbed.experiment --seeds 1 --out $TMPDIR/gate1
.venv/bin/python m1_venue/build_layout.py --all-presets --out $TMPDIR/gate1-m1
.venv312/bin/python -m testbed.jps_geometry
.venv312/bin/python -m verification.run
```

T6 合入后，把 `test_presets.py` 里那条 `xfail` 改成正常测试。

都通过就算过了关口 1，可以开始第二阶段：`jps.py`（A2、A3）、闸口标定（B2）、舞台朝向实验（E1-x）。
