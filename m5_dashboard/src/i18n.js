// Bilingual (English / Simplified Chinese) dictionary and formatters for M5 dashboard.

const VALID_LANGS = new Set(['en', 'zh'])
const VALID_THEMES = new Set(['dark', 'light'])
const VALID_MODES = new Set(['ops', 'sim'])

function safeStorageGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

export function getInitialLang() {
  const param = new URLSearchParams(location.search).get('lang')
  if (VALID_LANGS.has(param)) return param
  const saved = safeStorageGet('kaitak.lang')
  if (VALID_LANGS.has(saved)) return saved
  return 'en'
}

export function getInitialTheme() {
  const param = new URLSearchParams(location.search).get('theme')
  if (VALID_THEMES.has(param)) return param
  const saved = safeStorageGet('kaitak.theme')
  if (VALID_THEMES.has(saved)) return saved
  return 'dark'
}

export function getInitialMode() {
  const param = new URLSearchParams(location.search).get('mode')
  if (VALID_MODES.has(param)) return param
  const saved = safeStorageGet('kaitak.mode')
  if (VALID_MODES.has(saved)) return saved
  return 'ops'
}

export function saveLang(lang) {
  if (VALID_LANGS.has(lang)) safeStorageSet('kaitak.lang', lang)
}

export function saveTheme(theme) {
  if (VALID_THEMES.has(theme)) safeStorageSet('kaitak.theme', theme)
}

export function saveMode(mode) {
  if (VALID_MODES.has(mode)) safeStorageSet('kaitak.mode', mode)
}

export const STRINGS = {
  en: {
    htmlLang: 'en',
    pageTitle: 'Kai Tak Stadium | Egress Twin',
    loadingModel: 'Loading venue model',
    brandTitle: 'Kai Tak Stadium',
    brandSubtitle: 'Concert egress twin',
    sideWest: 'West half',
    sideEast: 'East half',
    scopeZones: (n) => `${n} zones`,
    scopePeople: (n) => `${n.toLocaleString('en-US')} cap.`,
    statusProvisional: 'Provisional',
    statusConnecting: 'Connecting',
    statusOffline: 'M2 offline',
    statusReady: 'Standby',
    statusLiveLabel: 'Live',
    statusRunEnded: (status) => `${status}`,
    runStatusMap: { completed: 'Completed', stopped: 'Stopped', interrupted: 'Interrupted', running: 'Live' },

    // Mode & Toolbar
    modeAria: 'Workspace mode',
    modeOps: 'Ops',
    modeSim: 'Testbed',
    opsPill: 'Live Twin',
    simPill: 'Testbed Injector',
    tipOpsRail: 'Real-time operational overview built solely from anonymous 5 s zone counts and counting-line flows. Switch to Testbed to configure synthetic runs or inspect ground-truth error.',
    simBanner: 'External testbed proxy feeding /api/readings every 5 s. Twin estimation and guidance never access ground truth.',
    btnReturnOps: 'Switch to live Ops view →',
    btnOpenSim: 'Open Testbed →',
    collapseLeft: 'Collapse panel',
    expandLeft: 'Expand panel',
    toolbarAria: 'Display controls',
    langAria: 'Language',
    themeAria: 'Color theme',
    themeLightTitle: 'Light mode',
    themeDarkTitle: 'Dark mode',

    // Feed card & Operations left rail
    feedIdleTitle: 'Sensor API standby',
    feedIdleDesc: 'Awaiting 5 s anonymous counts on /api/readings, or launch the external testbed.',
    feedLiveTitle: '5 s live feed',
    feedLiveProxy: (speed) => `Testbed · ${speed}×`,
    feedLiveExternal: 'External sensors',
    feedEndedTitle: (status) => `Session ${status.toLowerCase()}`,
    feedEndedDesc: 'Review post-egress outcomes below or start a new run in Testbed.',
    hotspotsTitle: 'Hotspots',
    hotspotsSub: 'click to inspect',
    hotspotsIdle: 'Click any zone in 3D to pin its density curve. Live hotspots rank here once telemetry starts.',
    hotspotsNone: 'All walking zones currently clear.',
    distTitle: 'Crowd in venue',
    distSeating: 'Stands',
    distFloor: 'Floor',
    distWalking: 'Concourse',

    // Scenario panel (Testbed mode)
    scenarioTitle: 'Testbed Scenario',
    tipScenario: 'External testbed inputs: scheduled gate closure, spectator compliance rate, approval mode, playback speed, and camera outage injection.',
    gateClosedLabel: 'Gate closure',
    gateNoClosure: 'No closure',
    gateClosesAt: (ref) => `Gate ${ref} closes at 2:00`,
    complianceLabel: 'Crowd compliance',
    approvalLabel: 'Approval',
    approvalManual: 'Duty manager approves',
    approvalAuto: 'Batch rule approves',
    approvalNone: 'No guidance (baseline)',
    speedLabel: 'Speed',
    dropShort: 'Camera outage',
    tipDrop: 'Drops cameras C08 and C10 at 3:20 for 2 min to test stale-data fallback and blind-zone estimation.',
    btnStart: 'Start egress',
    btnStop: 'Stop',

    // View & Legend
    viewTitle: 'View',
    views: { Overview: 'Overview', Concourse: 'Concourse', Floor: 'Floor', Plan: 'Plan' },
    showShellShort: 'Shell',
    postFxShort: 'FX',
    legendMaxTick: '4 p/m²',
    legDashShort: 'Estimated',
    legGreyShort: 'Stale',
    legPreviewShort: 'Preview',
    legDotsShort: 'Dots',
    legBoardShort: 'Signs',
    tipRamp: 'Walking-zone crowd density (0–4 persons/m²). Exceeding Fruin F threshold (2.2 p/m²) triggers guidance.',
    legendDash: 'Dashed outline: zone has no camera; density is estimated from counting lines.',
    legendGrey: 'Grey outline: camera data is over 10 s old and currently estimated.',
    legendPreview: 'Amber frame & ?→X tag: pending guidance proposal previewed in 3D before approval.',
    legendDots: 'Crowd dots: sampled from zone counts, not individual person tracking.',
    legendBoard: 'Guidance sign: green shows approved diversion; turns red if pointing at a closed gate. Hover a sign to preview its message.',

    // Guidance & Log panel
    guidanceTitle: 'Guidance',
    tipGuidance: 'M4 proposes display diversions when a 2-min forecast exceeds 2.2 p/m² or a gate closes. Nothing changes until approved.',
    guidanceOff: 'Guidance switched off (baseline).',
    guidanceEmpty: 'No pending proposal — monitoring forecasts.',
    untickTip: 'Untick to leave this display unchanged',
    btnApprove: 'Approve',
    btnReject: 'Reject',
    btnShow: 'Locate',
    logTitle: 'Audit log',
    logEmpty: 'No events yet.',
    logCount: (n) => `${n}`,

    // Bottom panels
    chartTitle: 'Peak walking density',
    chartSub: 'persons/m²',
    chartEmpty: 'Awaiting telemetry',
    keyNow: 'Twin estimate',
    keyFc: '2-min forecast',
    keyTruth: 'Testbed truth (eval)',
    keyLim: (limit) => `Limit ${limit}`,
    gatesTitle: 'Gates',
    gatesSub: 'flow & total in',
    tipGates: 'Real-time gate throughput (p/s vs 4.16 p/s design capacity), cumulative arrivals, and live close/reopen control.',
    gateLabel: (ref) => `Gate ${ref}`,
    gateClosedState: 'closed',
    gateRate: (r) => `${r.toFixed(1)}/s`,

    // Bottom-right card: Ops mode vs Sim mode
    opsEvalTitle: 'Guidance loop',
    opsEvalSub: 'live feedback',
    tipOpsLoop: 'Operational closed-loop state derived strictly from anonymous sensors: online compliance inferred from counting lines, active diversions, sensor health, and egress outcome.',
    opsCompLabel: 'Inferred compliance',
    opsCompWait: 'Awaiting first diversion flow',
    opsCompSub: 'Inferred online from counting lines',
    opsSigns: 'Active signs',
    opsSensors: 'Cameras online',
    opsApproved: 'Plans approved',
    opsT90Live: 'Cleared',
    opsOutcomeT90: '90% out (T90)',
    opsOutcomeOver: (limit) => `Over ${limit} (zone·s)`,

    evalTitle: 'Twin vs testbed',
    evalSub: 'evaluation only',
    tipEval: 'Ground truth comes from the testbed for evaluation only — M3 and M4 never read it.\nTarget accuracy: density error ≤ 0.5 persons/m².',
    evalTargetPill: 'Target ≤ 0.50 p/m²',
    evalMeterLabel: 'Max density error',
    evalPass: 'PASS',
    evalFail: 'OVER',
    evalAwait: 'Awaiting truth',
    evalErrNow: 'Error mean / max',
    evalNoCamIdle: 'Blind zone est / true',
    evalNoCam: (zone) => `Blind ${zone} est / true`,
    evalCompEst: 'Compliance est / true',
    evalCompEstOnly: 'Est. compliance',
    evalCompTrue: 'True compliance',
    evalRunErr: 'Run error mean / max',
    evalT90: '90% out',
    evalOverLim: (limit) => `Zone·s > ${limit}`,

    // Top HUD KPIs
    kpiClock: 'Clock',
    kpiInside: 'inside',
    kpiOut: 'out',
    kpiPeak: 'Peak',
    kpiForecast: '+2 min',
    kpiOver: (limit) => `>${limit}`,
    kpiCamsOk: (n) => `${n}/${n} cam`,
    kpiCamsStale: (stale, total) => `${stale}/${total} stale`,
    kpiLatency: 'Latency',
    na: '—',

    // Log messages
    logStart: (mode) => `Egress started (${mode})`,
    approvalModeLog: { none: 'no guidance', auto: 'batch approval', manual: 'manual approval' },
    logRunEnd: ({ status, t90, over, limit }) =>
      `${status} · T90 ${t90} · ${over} zone-s > ${limit}`,
    logFacility: ({ ref, status }) => `Gate ${ref} ${status}`,
    facilityStatusMap: { closed: 'closed', open: 'open' },
    logGuidance: {
      proposed: ({ version, count, gates }) => `Proposal #${version}: ${count} signs → Gate ${gates}`,
      approved: ({ version, count }) => `Proposal #${version} approved (${count} signs)`,
      rejected: ({ version }) => `Proposal #${version} rejected`,
      superseded: ({ version }) => `Proposal #${version} expired`,
    },
    actorMap: {
      'M4': 'M4',
      'duty manager': 'duty manager',
      'manager': 'manager',
      'rule:auto': 'auto rule',
      'rule:expired': 'expired',
      'venue-ops': 'venue ops',
    },

    // Hover tooltips (zone & 3D guidance sign)
    zoneTypes: {
      concourse: 'concourse',
      floor: 'floor',
      gate: 'gate',
      portal: 'portal',
      seating: 'seating',
      tunnel: 'tunnel',
    },
    tipSeats: (n) => `${n} seats`,
    tipNotSold: 'not sold (behind stage)',
    tipPeopleDensity: (count, density) => `${count} people · ${density} p/m²`,
    tipForecast: (density) => `2-min forecast: ${density} p/m²`,
    tipStale: (age) => `camera stale ${age} s · estimated`,
    tipMeasured: 'camera measured',
    tipEstimatedLines: 'blind zone · estimated from lines',
    tipHasCam: 'camera monitored',
    tipNoCam: 'no camera (line estimated)',
    tipSignTag: 'guidance sign',
    tipSignServes: (z) => `Serves ${z}`,
    tipSignApproved: (ref) => `EXIT VIA GATE ${ref} →`,
    tipSignWrong: (ref) => `GATE ${ref} CLOSED — UPDATE`,
    tipSignPreview: (ref) => `PROPOSED: GATE ${ref} →`,
    tipSignDefault: (ref) => `Default route: Gate ${ref}`,
    tipSignIdle: 'Default signage (no active diversion)',

    // 3D sprite labels
    spriteGateOpen: (ref) => `GATE ${ref}`,
    spriteGateClosed: (ref) => `GATE ${ref} CLOSED`,

    // P1 gate controls
    gateBtnClose: 'Close',
    gateBtnReopen: 'Reopen',
    gateLastOpenTip: 'At least one gate must remain open',
    gateRunOnlyTip: 'Available while a session is live',

    // P2 chart, zone inspector and baseline
    chartModePeak: 'Peak',
    chartModeOver: (limit) => `>${limit}`,
    chartModeZone: 'Zone',
    chartModeAria: 'Chart mode',
    chartTitleOver: (limit) => `Walking zones > ${limit}`,
    chartSubOver: 'zones',
    chartTitleZone: (zone) => `Zone ${zone}`,
    chartZoneHint: 'Click a zone in 3D or in Hotspots to plot it',
    chartZoneResumed: (t) => `Zone history starts at ${t} (page reloaded)`,
    zoneStale: 'stale',
    zoneClear: 'Clear selection (Esc)',
    baselineLabel: 'Baseline',
    baselineNone: 'No baseline',
    baselineTip: 'Latest finished no-guidance run with the same seed, gate closure, closing time, stage layout and camera outage, read from MongoDB',
    keyBase: 'No-guidance baseline',
    evalVsBase: 'vs baseline',

    // P3 proposal preview
    previewActive: (selected, total) => `3D preview · ${selected}/${total} signs`,
    previewNone: '3D preview · none selected',

    // Stage layout (M1 presets, E2)
    layoutLabel: 'Stage layout',
    layoutTip: 'Switch while no run is live. South end mirrors the stage, blocked seats and floor seats north-south (hypothetical scenario).',
    statusHypothetical: 'Hypothetical',
  },

  zh: {
    htmlLang: 'zh-CN',
    pageTitle: '启德主场馆 | 散场数字孪生',
    loadingModel: '正在加载场馆模型',
    brandTitle: '启德主场馆',
    brandSubtitle: '演唱会散场数字孪生',
    sideWest: '西半区',
    sideEast: '东半区',
    scopeZones: (n) => `${n} 分区`,
    scopePeople: (n) => `${n.toLocaleString('zh-CN')} 人`,
    statusProvisional: '待确认',
    statusConnecting: '连接中',
    statusOffline: 'M2 离线',
    statusReady: '待机',
    statusLiveLabel: '运行中',
    statusRunEnded: (status) => `${status}`,
    runStatusMap: { completed: '已完成', stopped: '已停止', interrupted: '已中断', running: '运行中' },

    // Mode & Toolbar
    modeAria: '工作区模式',
    modeOps: '运营',
    modeSim: '仿真',
    opsPill: '实时孪生',
    simPill: '外部测试台',
    tipOpsRail: '纯运营指挥视角：全部态势与决策仅基于每 5 秒匿名分区计数与过线流率，不含仿真参数或真值。切至「仿真」可配置外部测试台或校验精度。',
    simBanner: '外部测试台代理每 5 秒向 /api/readings 注入模拟计数；孪生估计与决策算法绝不读取真值。',
    btnReturnOps: '切至实时运营视图 →',
    btnOpenSim: '打开外部测试台 →',
    collapseLeft: '收起侧栏',
    expandLeft: '展开侧栏',
    toolbarAria: '显示设置',
    langAria: '语言切换',
    themeAria: '亮暗主题切换',
    themeLightTitle: '浅色模式',
    themeDarkTitle: '深色模式',

    // Feed card & Operations left rail
    feedIdleTitle: '传感接口待机中',
    feedIdleDesc: '等待 /api/readings 实时 5 秒匿名计数流入，或切至外部测试台启动演示。',
    feedLiveTitle: '5 秒遥测接入',
    feedLiveProxy: (speed) => `测试台 · ${speed}×`,
    feedLiveExternal: '外部传感流',
    feedEndedTitle: (status) => `本次散场${status}`,
    feedEndedDesc: '可在下方查看散场效能与基线对比，或切至测试台发起新一轮运行。',
    hotspotsTitle: '拥堵热点排行',
    hotspotsSub: '点击定位检视',
    hotspotsIdle: '可直接点击 3D 场馆任意分区查看曲线；数据流入后此处自动按实时/预测密度排序。',
    hotspotsNone: '当前所有通行区均畅通。',
    distTitle: '馆内人群分布',
    distSeating: '看台',
    distFloor: '内场',
    distWalking: '环廊与通道',

    // Scenario panel (Testbed mode)
    scenarioTitle: '测试台场景配置',
    tipScenario: '外部测试台输入参数：设定定时关闭闸口、观众真实遵从率、审批方式、仿真倍速与摄像头中断注入。',
    gateClosedLabel: '定时关闭闸口',
    gateNoClosure: '不关闭闸口',
    gateClosesAt: (ref) => `闸口 ${ref} 于 2:00 关闭`,
    complianceLabel: '观众真实遵从率',
    approvalLabel: '审批模式',
    approvalManual: '值班经理审批',
    approvalAuto: '规则自动审批',
    approvalNone: '无引导（基线）',
    speedLabel: '仿真倍速',
    dropShort: '模拟摄像头中断',
    tipDrop: '3:20 起 C08 与 C10 摄像头中断 2 分钟，用于检验超时回退与无监控分区估计。',
    btnStart: '开始散场',
    btnStop: '停止',

    // View & Legend
    viewTitle: '视角',
    views: { Overview: '全景', Concourse: '环廊', Floor: '内场', Plan: '俯视' },
    showShellShort: '外立面',
    postFxShort: '画质',
    legendMaxTick: '4 人/m²',
    legDashShort: '无监控',
    legGreyShort: '超时',
    legPreviewShort: '预演',
    legDotsShort: '人点',
    legBoardShort: '引导牌',
    tipRamp: '通行区人群密度色带（0–4 人/m²），超过 2.2 人/m²（Fruin F 阈值）时触发引导提案。',
    legendDash: '虚线边框：该分区未部署摄像头，人数由周边计数线推算。',
    legendGrey: '灰色边框：摄像头数据已超过 10 秒未更新，当前由模型估计。',
    legendPreview: '琥珀色外框与 ?→X 标签：待审批提案在 3D 中的空间预演。',
    legendDots: '人群散点：按分区实时人数随机采样呈现，非个体追踪。',
    legendBoard: '引导显示屏：绿色为已批准改导方向；若指向已关闭闸口则变红告警。悬停牌面可预览播报内容。',

    // Guidance & Log panel
    guidanceTitle: '引导决策',
    tipGuidance: '当 2 分钟预测超过 2.2 人/m² 或闸口关闭时，M4 自动生成引导提案，经值班经理审批后才下发至现场显示屏。',
    guidanceOff: '当前为基线模式（已关闭引导）。',
    guidanceEmpty: '暂无待审批提案，持续监测预测趋势。',
    untickTip: '取消勾选以保持该显示屏不变',
    btnApprove: '批准',
    btnReject: '驳回',
    btnShow: '定位',
    logTitle: '运行日志',
    logEmpty: '暂无运行事件。',
    logCount: (n) => `${n} 条`,

    // Bottom panels
    chartTitle: '通行区峰值密度',
    chartSub: '人/m²',
    chartEmpty: '等待散场数据',
    keyNow: '孪生估计',
    keyFc: '2 分钟预测',
    keyTruth: '测试台真值（仅评估）',
    keyLim: (limit) => `阈值 ${limit}`,
    gatesTitle: '各闸口通行',
    gatesSub: '实时流率与累计',
    tipGates: '展示各闸口实时通过流率（相对 4.16 人/秒设计上限）、累计进入人数及运行中手动关/开控制。',
    gateLabel: (ref) => `闸口 ${ref}`,
    gateClosedState: '已关闭',
    gateRate: (r) => `${r.toFixed(1)}/s`,

    // Bottom-right card: Ops mode vs Sim mode
    opsEvalTitle: '闭环与引导状态',
    opsEvalSub: '在线反馈',
    tipOpsLoop: '纯运营闭环状态（不依赖测试台真值）：基于下游计数线在线反推的观众遵从率、当前生效引导牌、传感在线率与散场效能。',
    opsCompLabel: '在线估计遵从率',
    opsCompWait: '待首次改道后由计数线反推',
    opsCompSub: '由下游过线流量实时最小二乘反推',
    opsSigns: '生效引导牌',
    opsSensors: '传感在线',
    opsApproved: '已批方案',
    opsT90Live: '已离场',
    opsOutcomeT90: '90% 离场 (T90)',
    opsOutcomeOver: (limit) => `超 ${limit} 分区秒`,

    evalTitle: '孪生精度评估',
    evalSub: '仅测试台评估',
    tipEval: '真值来自外部测试台，仅作精度验证展示，M3 与 M4 均不读取。\n精度目标：密度误差 ≤ 0.5 人/m²。',
    evalTargetPill: '目标 ≤ 0.50 人/m²',
    evalMeterLabel: '最大密度误差',
    evalPass: '达标',
    evalFail: '超限',
    evalAwait: '等待真值包',
    evalErrNow: '当前误差（均 / 最大）',
    evalNoCamIdle: '盲区（估计 / 真值）',
    evalNoCam: (zone) => `盲区 ${zone}（估 / 真）`,
    evalCompEst: '遵从率（估 / 真）',
    evalCompEstOnly: '估计遵从率',
    evalCompTrue: '真实遵从率',
    evalRunErr: '全程误差（均 / 最大）',
    evalT90: '90% 离场',
    evalOverLim: (limit) => `超 ${limit} 分区秒`,

    // Top HUD KPIs
    kpiClock: '计时',
    kpiInside: '在馆',
    kpiOut: '已离场',
    kpiPeak: '峰值',
    kpiForecast: '+2分',
    kpiOver: (limit) => `>${limit}`,
    kpiCamsOk: (n) => `${n}/${n} 在线`,
    kpiCamsStale: (stale, total) => `${stale}/${total} 掉线`,
    kpiLatency: '延迟',
    na: '—',

    // Log messages
    logStart: (mode) => `开始散场（${mode}）`,
    approvalModeLog: { none: '无引导', auto: '自动审批', manual: '手动审批' },
    logRunEnd: ({ status, t90, over, limit }) =>
      `${status} · T90 ${t90} · 超 ${limit} 共 ${over} 分区秒`,
    logFacility: ({ ref, status }) => `闸口 ${ref} ${status}`,
    facilityStatusMap: { closed: '已关闭', open: '已开放' },
    logGuidance: {
      proposed: ({ version, count, gates }) => `提案 #${version}：${count} 块屏 → 闸口 ${gates}`,
      approved: ({ version, count }) => `提案 #${version} 已批准（${count} 块屏）`,
      rejected: ({ version }) => `提案 #${version} 已驳回`,
      superseded: ({ version }) => `提案 #${version} 超时失效`,
    },
    actorMap: {
      'M4': 'M4',
      'duty manager': '值班经理',
      'manager': '值班经理',
      'rule:auto': '自动规则',
      'rule:expired': '超时规则',
      'venue-ops': '场馆运维',
    },

    // Hover tooltips
    zoneTypes: {
      concourse: '环廊',
      floor: '内场',
      gate: '闸口',
      portal: '通道口',
      seating: '看台',
      tunnel: '内场通道',
    },
    tipSeats: (n) => `${n} 座`,
    tipNotSold: '舞台后未售票',
    tipPeopleDensity: (count, density) => `${count} 人 · ${density} 人/m²`,
    tipForecast: (density) => `2 分钟预测：${density} 人/m²`,
    tipStale: (age) => `摄像头已超时 ${age} 秒 · 模型推估`,
    tipMeasured: '摄像头实测',
    tipEstimatedLines: '无摄像头 · 计数线推算',
    tipHasCam: '已部署摄像头',
    tipNoCam: '无摄像头（计数线推算）',
    tipSignTag: '导视显示屏',
    tipSignServes: (z) => `服务分区 ${z}`,
    tipSignApproved: (ref) => `请改道至 ${ref} 闸口 →`,
    tipSignWrong: (ref) => `闸口 ${ref} 已关闭 · 需重算`,
    tipSignPreview: (ref) => `预演方案：改道至 ${ref} 闸口 →`,
    tipSignDefault: (ref) => `默认方向：闸口 ${ref}`,
    tipSignIdle: '默认导视（当前未改道）',

    // 3D sprite labels
    spriteGateOpen: (ref) => `闸口 ${ref}`,
    spriteGateClosed: (ref) => `闸口 ${ref} 已关闭`,

    // P1 gate controls
    gateBtnClose: '关闭',
    gateBtnReopen: '重开',
    gateLastOpenTip: '至少须保留一个开放闸口',
    gateRunOnlyTip: '运行中可控制闸口',

    // P2 chart, zone inspector and baseline
    chartModePeak: '峰值',
    chartModeOver: (limit) => `>${limit}`,
    chartModeZone: '单区',
    chartModeAria: '曲线模式',
    chartTitleOver: (limit) => `超 ${limit} 的通行分区数`,
    chartSubOver: '个',
    chartTitleZone: (zone) => `分区 ${zone}`,
    chartZoneHint: '点击 3D 分区或左侧热点排行可锁定曲线',
    chartZoneResumed: (t) => `页面刷新过，单区曲线从 ${t} 开始`,
    zoneStale: '断流',
    zoneClear: '取消选择（Esc）',
    baselineLabel: '基线',
    baselineNone: '无基线',
    baselineTip: '取 MongoDB 中最近一次已完成的无引导运行，要求种子、关门设置、关门时间、舞台构型和断流设置都相同',
    keyBase: '无引导基线',
    evalVsBase: '较基线',

    // P3 proposal preview
    previewActive: (selected, total) => `3D 预演 · ${selected}/${total} 块屏`,
    previewNone: '3D 预演 · 未勾选',

    // 舞台构型（M1 预设，E2）
    layoutLabel: '舞台构型',
    layoutTip: '未运行时可切换。南端：舞台、被舞台挡住的座位和内场座椅按南北方向镜像（假设场景）。',
    statusHypothetical: '假设场景',
  },
}

export function formatProposalReason(reason, lang) {
  const [whyRaw = '', planRaw = ''] = String(reason ?? '').split('; ')
  if (lang !== 'zh') return { why: whyRaw, plan: planRaw }

  let why = whyRaw
  const gateMatch = whyRaw.match(/^Gate\s+([A-Z0-9-]+)\s+closed$/i)
  const fcMatch = whyRaw.match(/^(\S+)\s+forecast\s+([0-9.]+)\s+persons\/m²\s+in\s+2\s+min\s+\(limit\s+([0-9.]+)\)$/i)
  if (gateMatch) {
    why = `闸口 ${gateMatch[1]} 已关闭`
  } else if (fcMatch) {
    why = `${fcMatch[1]} 预计 2 分钟后达 ${fcMatch[2]} 人/m²（阈值 ${fcMatch[3]}）`
  }

  let plan = planRaw
  const planMatch = planRaw.match(
    /^busiest gate clears in\s+([0-9.]+)\s+min now,\s+([0-9.]+)\s+min with this plan\s+\(assumed compliance\s+([0-9.]+)\)$/i,
  )
  if (planMatch) {
    plan = `最忙闸口当前需 ${planMatch[1]} 分钟清空，执行后 ${planMatch[2]} 分钟（假定遵从率 ${planMatch[3]}）`
  }

  return { why, plan }
}

export function formatApiError(message, lang) {
  if (lang !== 'zh') return message
  if (String(message).includes('this proposal is no longer pending')) return '该提案已不再等待审批'
  return message
}
