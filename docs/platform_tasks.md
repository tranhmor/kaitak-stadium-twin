# 平台线并行任务（P1–P4）

依据：`docs/PRD_and_Research_Framework.md`（M5-02～M5-05）、`docs/execution_plan_v0.2.md`（2.0 原则、2.6、2.7）。分支起点：`main` 上包含本文件的提交。每个任务一个分支、一个 worktree，做完按第 5 节合并检查。

评测线（JuPedSim、TN 1822、PedPy）的任务书是 `docs/phase1_tasks.md`，不在本文件里。

## 0. 任务总表

| 任务 | 分支 | 内容 | PRD | 依赖 | 估时 |
| --- | --- | --- | --- | --- | --- |
| P1 | `twin/P1-gate-controls` | 运行中手动关门、重开门 | M5-02 | 无 | 2–3 h |
| P2 | `twin/P2-chart-inspector` | 点选分区、曲线三种模式、历史基线对照 | M5-03、M5-04 | 无 | 0.5–1 人天 |
| P3 | `twin/P3-proposal-preview` | 待批提案在 3D 里预演 | M5-05 | 无 | 3–4 h |
| P4（可选） | `twin/P4-m1-presets` | M1 南北舞台预设，即原来的 T6 | M1-03 | 无 | 0.5–1 人天 |

P1、P2、P3 改的都是 `m5_dashboard/`，靠第 2 节的预留位置和钩子避免冲突，可以同时做。P4 只改 `m1_venue/`。

还没有分到任何分支的事见第 6 节。

## 1. 所有 agent 都要遵守

**工作位置**：在自己的 worktree 里改动和提交，不要切换分支，不要改 `main`。建 worktree：

```bash
cd KaiTak_Stadium_Twin
git worktree add ../KaiTak_Stadium_Twin-wt/P1 twin/P1-gate-controls
cd ../KaiTak_Stadium_Twin-wt/P1
ln -s ../../KaiTak_Stadium_Twin/.venv .venv
ln -s ../../../KaiTak_Stadium_Twin/m5_dashboard/node_modules m5_dashboard/node_modules
```

两个软链接都已在 `.gitignore` 里，不会被提交。不要往 `.venv` 或 `node_modules` 里装包，缺包时停下来报告。

**本地联调**：不要用 8010 端口，也不要用默认数据库，那是演示用的服务。每个任务用自己的端口和数据库：

| 任务 | 端口 | 数据库 |
| --- | --- | --- |
| P1 | 8011 | `kaitak_twin_p1` |
| P2 | 8012 | `kaitak_twin_p2` |
| P3 | 8013 | `kaitak_twin_p3` |

```bash
cd m5_dashboard && npm run build && cd ..
KAITAK_MONGO_DB=kaitak_twin_p1 KAITAK_API_URL=http://127.0.0.1:8011 \
  .venv/bin/uvicorn m2_service.app:app --port 8011 --log-level warning
cd m5_dashboard && node tools/shot.mjs http://127.0.0.1:8011/ "$TMPDIR/shots-P1"
```

三个设置缺一不可：

- **`KAITAK_MONGO_DB`**：M2 启动时会把它数据库里所有"运行中"的记录改成 interrupted。如果用默认库，会把演示服务正在跑的运行标坏。
- **`KAITAK_API_URL`**：M2 启动的测试台进程按它回报数据。不设的话会发到 8010。
- **`npm run build`**：worktree 里的 M2 读的是 worktree 自己的 `m5_dashboard/dist`，要先构建。

做完关掉 uvicorn，并删掉自己的数据库：

```bash
.venv/bin/python -c "import pymongo; pymongo.MongoClient('mongodb://127.0.0.1:27027').drop_database('kaitak_twin_p1')"
```

**禁止改动**（需要改就停下来报告）：

- `contracts/`、`m2_service/`、`m3_state/`、`m4_guidance/`、`testbed/`、`verification/`、`analysis/`
- `m1_venue/`、`tests/test_presets.py`：只有 P4 能改
- `README.md`、`docs/`：收尾时统一改
- `tests/data/meso_runs_v0.1.csv`：回归参照，只在组里同意改演示数字时才换
- `../Kai_Tak_Peak_Routes.blend`：只读

**提交**：小步提交，提交信息用英文，以任务号开头，例如 `P1: add close and reopen buttons to the gates panel`。

**完成时报告**：

1. 改动的文件清单。
2. 验收命令和实际输出（贴原文）。
3. 没做完的、偏离本文件的地方及原因。
4. 发现的规格或接口问题。不要自己改冻结的文件。

## 2. 共享代码怎么改（避免合并冲突）

`main` 上已经给每个任务留了位置，新代码只往自己的位置里加：

| 文件 | 预留位置 |
| --- | --- |
| `src/main.js` | 文件末尾 `P1 gate controls`、`P2 chart, zone inspector and baseline`、`P3 proposal preview` 三段 |
| `src/overlay.js` | `createOverlay` 里 `centre` 之前的 `P2`、`P3` 两段（放语句）；返回对象里的 `// P2`、`// P3`（放导出的函数） |
| `src/i18n.js` | 中英两份字典末尾各三段 |
| `src/style.css` | 文件末尾三段 |
| `index.html` | 曲线面板标题栏里的 `<!-- P2 chart mode switch -->` |

已有函数分两类。

**各任务独占，可以直接改**：

| 任务 | 只有它能改的函数 |
| --- | --- |
| P1 | `main.js` 的 `renderGates` |
| P2 | `main.js` 的 `drawChart`、`renderEval` |
| P3 | `main.js` 的 `renderPending` |

**共享的，谁都不改，用钩子接入**：

- `main.js`：`onState`、`onRun`、`setStatus`、`setLang`、`setTheme`、`onGuidance`、`connect`、指针事件处理。
  - `hooks.state.push(fn)`：每条状态加进 `series` 之后、各面板重画之前调用，参数是状态。
  - `hooks.run.push(fn)`：运行开始、恢复或结束、面板重画之后调用，参数是 `(run, { fresh, resumed })`。
  - `hooks.appearance.push(fn)`：切换语言或主题之后调用，参数是 `{ lang, theme }`。
- `overlay.js`：`apply`、`applyIdleLook`、`reset`、每帧的 `onFrame` 回调。
  - `apply()` 每来一条状态就把所有分区、轮廓和指示牌的颜色重设一遍。直接改这些材质的颜色，下一条状态就会被冲掉。
  - 要在它们上面叠加样式，用 `applyHooks.push(fn)`，或在外面用 `overlay.onApply(fn)`。参数是状态，空闲时是 `null`。
  - 或者画自己的新物体。
  - 需要动画就自己再调一次 `view.onFrame(fn)`，可以注册多个。

如果确实要改共享函数，先停下来报告，由主线程在 `main` 上加钩子。

## 3. 任务

### P1 运行中手动关门、重开门（M5-02）

**只能改**：`main.js` 的 `renderGates` 和 P1 段；`i18n.js`、`style.css` 的 P1 段。

**做什么**：

1. `GATES` 面板每一行右侧加一个按钮：开着的门显示 `Close / 关闭`，关着的显示 `Reopen / 重开`。
2. 点击调用已有接口 `PUT /api/facilities/{zone_id}`，请求体 `{"status": "closed" | "open", "by": "duty manager"}`。
   - 成功后不用自己改界面。M2 会通过 `/ws` 推送 `facility` 事件，日志已经会显示；下一条状态的 `facilities` 会更新面板。
   - 请求进行中禁用这个按钮，防止连点。
   - 失败时用现有的 `pushLog({ kind: 'error', ... })` 写进日志，不要静默。
3. 按钮只在 `run?.status === 'running'` 时可用。运行结束后，M2 还留着上一次的会话，这时改闸口没有任何作用。
4. **只剩一个开着的门时，禁用它的关闭按钮**，悬停时说明原因。这不只是体验问题：
   - 四个门全关时，`testbed/meso.py` 的 `nearest_gate` 返回 `None`，`gate_idx[None]` 抛 KeyError。
   - 测试台进程会退出，这次运行在 M2 里一直显示"运行中"。
   - M2 接口本身不拦这种请求。
5. `renderGates` 每次都重写面板的 HTML，所以点击事件要在 P1 段里给 `#gates` 绑一次，用事件委托。
6. 中英文、明暗两套主题都要有。

**要知道的行为**（写进演示说明，不用改代码）：

- 关门后：测试台在下一批（≤ 5 s 仿真时间）生效。M4 在下一批出一个"Gate X closed"的提案；如果当时已有待批提案，要等它被批准、驳回或过期后才出，不会丢。
- 重开门后：测试台立即恢复用这个门，**但已经批准的改道不会自动撤回**。M4 只在预测越线或有门新关闭时出提案，指示牌会继续把人引离这个门，直到之后某次预测触发新方案。

**验收**：

- 自己的端口上：`npm run build` 无报错；`node tools/shot.mjs http://127.0.0.1:8011/ ...` 通过。
- 手动走一遍：开一次"Duty manager approves"运行 → 没有待批提案时关 C，日志出现关门事件和关门提案 → 重开 C，C 的计数继续增加 → 依次关到只剩一个门，最后一个的关闭按钮不可用 → 切中英文、明暗主题正常。
- `.venv/bin/python -m pytest -q` 全部通过。

### P2 点选分区、曲线三种模式、历史基线对照（M5-03、M5-04）

**只能改**：`main.js` 的 `drawChart`、`renderEval` 和 P2 段；`overlay.js` 的 P2 两段；`i18n.js`、`style.css` 的 P2 段；`index.html` 的 P2 位置。

**做什么**：

1. **点选分区**：
   - 在 P2 段里给 `#scene` 加 `pointerdown`/`pointerup`，位移小于 5 px 算点击，否则是拖动视角。
   - 点中分区时，用 `overlay.pick` 取分区，`overlay.setFocus` 保持高亮。点空白处取消。
   - 曲线标题栏显示当前选中的分区。
2. **逐区历史**：
   - 用 `hooks.state` 给 `series.at(-1)` 加上 `over`（`kpis.zones_over_now`）和各区的 `[density, forecast_density]`，一次运行约 250 KB。
   - 用 `hooks.run` 在新运行开始时清空。
   - 刷新页面后恢复的运行，`/api/runs/{id}/series` 里没有逐区数据，单区模式只能从恢复那一刻开始画，图上要注明。
3. **曲线三种模式**，开关放在 `index.html` 的 P2 位置：
   - `Peak / 峰值`：现在的曲线，默认。
   - `Over 2.2 / 超限分区数`：`zones_over_now`，恢复的运行也有这个值。
   - `Zone / 单区`：选中分区的密度、2 分钟预测和 2.2 红线。选中分区时自动切过来。
4. **右下角时间刻度被裁成 `10:`**：最后一个刻度右对齐，或加大右侧留白。
5. **历史基线对照**：
   - 用 `GET /api/runs?limit=100` 找基线，条件全部满足才算同一场景：
     - `status === 'completed'`，并且有 `result`；
     - `config.approval === 'none'`；
     - `config.seed`、`config.close_gate`、`config.close_at_s` 与当前运行相同；
     - `config.layout` 相同，旧记录没有这个字段时按 `north_end` 算；
     - 断流设置（`drop_zones`、`drop_from_s`、`drop_to_s`）相同。
   - 找到后，用 `/api/runs/{id}/series` 在峰值或超限模式下叠一条灰色虚线，图例加"基线"。单区模式没有基线数据，不画。
   - 运行结束后，在评估面板加两行：与基线的 T90 差、超 2.2 分区·秒差（数值和百分比）。
   - 没有合适的基线时，显示"无基线"，不报错。
6. 中英文、明暗两套主题都要有。

**要知道的事实**：

- 不引导的基线不受 p 影响。`meso.py` 不管 p 多大都抽同样多的随机数，不引导时是否遵从从来不会被用到。
- 看板发起的运行不带种子（默认 1），关门时间固定 120 s。所以每种"关哪个门 × 舞台 × 断流设置"只需要一次基线。
- 断流不改测试台里的人群，T90 不变；但它改变孪生的估计，所以画出来的曲线会不同。

**演示前准备**：在演示用的数据库里，为每种要演的关门设置先跑一次"No guidance"基线。

**验收**：

- 自己的端口上：构建和截图检查通过。
- 手动走一遍：先跑一次不引导基线，再跑一次引导运行 → 曲线上有基线虚线 → 三种模式能切换 → 点 C10 进入单区模式 → 结束后评估面板有两行差值 → 中英文、明暗主题正常。
- `pytest -q` 全部通过。

### P3 待批提案在 3D 里预演（M5-05）

**只能改**：`main.js` 的 `renderPending` 和 P3 段；`overlay.js` 的 P3 两段；`i18n.js`、`style.css` 的 P3 段。

**做什么**：

1. `overlay.js` P3 段新增并导出 `setPreview(displayIds)`。
   - 给这些显示屏画琥珀色的预览标记（例如外框加 `?→E` 标签），和批准后的绿色 `→E` 区分开。
   - 再把它们服务的看台和内场分区轮廓提亮。
   - `setPreview([])` 清空。
2. 指示牌和分区轮廓的颜色每条状态都会被 `apply()` 重设，所以：
   - 预览标记画成新物体；
   - 分区提亮用 `applyHooks` 在每次 `apply()` 之后重新加上去。
   - 脉动动画用自己的 `view.onFrame`。
3. `renderPending` 显示提案时调用 `setPreview`，只包含已勾选的行；勾选框变化时立即更新；没有待批提案（批准、驳回、过期）时清空。
4. 中英文、明暗两套主题都要有。

**验收**：

- 自己的端口上：构建和截图检查通过。
- 手动走一遍：开一次"Duty manager approves"运行 → 提案出现时 3D 里亮起预览 → 取消勾选一行，对应预览熄灭 → 批准后预览消失、改道的牌变绿 → 再来一个提案时选驳回，预览消失 → 中英文、明暗主题正常。
- `pytest -q` 全部通过。

### P4 M1 南北舞台预设（可选）

规格照 `docs/phase1_tasks.md` 的 T6，分支改为 `twin/P4-m1-presets`，worktree 改为 `../KaiTak_Stadium_Twin-wt/P4`。

有一处与 T6 原文不同：`testbed/meso.py` 已经改从 `venue.out_dir` 读出生点，T6 验收里那条"等 T2"的 `xfail` 不再需要，直接写成正常测试。

## 4. 冲突检查

| 文件 | P1 | P2 | P3 | P4 |
| --- | --- | --- | --- | --- |
| `main.js` 独占函数 | `renderGates` | `drawChart`、`renderEval` | `renderPending` | |
| `main.js`、`i18n.js`、`style.css` 预留段 | P1 段 | P2 段 | P3 段 | |
| `overlay.js` 预留段 | | P2 段 | P3 段 | |
| `index.html` | | P2 位置 | | |
| `m1_venue/`、`tests/test_presets.py` | | | | ✔ |

## 5. 合并顺序和检查

顺序不限，建议 P1 → P2 → P3，P4 随时。每合一个，在 `main` 上跑：

```bash
.venv/bin/python -m pytest -q                                   # 含 3 行回归
cd m5_dashboard && npx vite build --outDir "$TMPDIR/build-main" --emptyOutDir
```

再按第 1 节，用一个单独的端口跑一次截图检查。

要更新演示服务的看板时，才在 `main` 上 `npm run build`。`dist/` 已经存在，不用重启 8010 上的 uvicorn，刷新页面即可。

合入任何改到 `testbed/`、`m3_state/`、`m4_guidance/`、`contracts/` 的东西之前，加跑全量回归（35 行，约 70 s）：

```bash
.venv/bin/python -m pytest -q -m slow tests/test_regression.py
```

## 6. 还没有分到分支的事

| 事项 | 说明 | 依赖 |
| --- | --- | --- |
| 演示倍速下的延迟实测（PRD M2-02） | 演示机上以 10 倍速跑一次完整演示，记录 `latency_p95_ms`、最大 `latency_ms` 和 `processing_ms`。先查清现有两次运行 196 ms 和 6.3 ms 的差别：<br>• 可能的原因：`latency_ms` 是在 M3、M4 跑完之后才记的；M4 每次出方案要比较全部候选，4 个门全开时 1,140 个，关掉 D 后 171 个；不引导的运行完全不跑 M4。<br>• 查法：对照两次运行的 `config.approval`，看延迟最大的那几批是否正好出了提案、`kpis.processing_ms` 是否接近 `latency_ms`。 | 无 |
| 截图刷新和演示清单 | `docs/screenshots/` 换成新界面；写一页演示步骤和兜底录屏 | P1–P3 合入后；12 月 3 日要用 |
| M2 多舞台接口、看板切换舞台（PRD M2-03、M5-06，E2） | 规格见执行方案 2.6.4 | P4，以及执行方案关口 3；可选 |
| M2 后端拦住"关掉最后一个门" | 在 `app.py` 的闸口接口里加检查，返回 422；P1 的按钮保护只管看板 | 无；可选 |
| 评测线 T1、T2（只剩 `crowd.py`）、T3、T4、T5 | 见 `docs/phase1_tasks.md` 开头的状态说明。要么定负责人，要么记为范围调整 | 组里决定 |
