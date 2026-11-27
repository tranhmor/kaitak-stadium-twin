// Bilingual (English / Simplified Chinese) dictionary and formatters for M5 dashboard.

const VALID_LANGS = new Set(['en', 'zh'])
const VALID_THEMES = new Set(['dark', 'light'])

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

export function saveLang(lang) {
  if (VALID_LANGS.has(lang)) safeStorageSet('kaitak.lang', lang)
}

export function saveTheme(theme) {
  if (VALID_THEMES.has(theme)) safeStorageSet('kaitak.theme', theme)
}

export const STRINGS = {
  en: {
    htmlLang: 'en',
    pageTitle: 'Kai Tak Stadium | Egress Twin',
    loadingModel: 'Loading venue model',
    brandTitle: 'Kai Tak Main Stadium',
    brandSubtitle: 'Concert egress twin',
    sideWest: 'West half',
    sideEast: 'East half',
    scopeZones: (n) => `${n} zones`,
    scopePeople: (n) => `${n.toLocaleString('en-US')} people`,
    statusProvisional: 'Provisional',
    statusConnecting: 'Connecting',
    statusOffline: 'M2 offline, retrying',
    statusReady: 'Ready',
    statusLiveLabel: 'Live',
    statusRunEnded: (status) => `Run ${status}`,
    runStatusMap: { completed: 'completed', stopped: 'stopped', interrupted: 'interrupted', running: 'running' },

    // Toolbar
    toolbarAria: 'Display controls',
    langAria: 'Language',
    themeAria: 'Color theme',
    themeLightTitle: 'Light mode',
    themeDarkTitle: 'Dark mode',

    // Scenario panel
    scenarioTitle: 'Scenario',
    tipScenario: 'Testbed scenario inputs: gate closure, crowd compliance rate, approval mode, simulation speed, and camera outage.',
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

    // View panel
    viewTitle: 'View',
    views: { Overview: 'Overview', Concourse: 'Concourse', Floor: 'Floor', Plan: 'Plan' },
    showShellShort: 'Roof & facade',
    postFxShort: 'Post-FX',
    legendMaxTick: '4 p/m²',
    legDashShort: 'Estimated',
    legGreyShort: 'Stale',
    legDotsShort: 'Dots',
    legBoardShort: 'Signs',
    tipRamp: 'Walking-zone crowd density (0–4 persons/m²). Exceeding Fruin F threshold (2.2 p/m²) triggers guidance.',
    legendDash: 'Dashed outline: zone has no camera; density is estimated from counting lines.',
    legendGrey: 'Grey outline: camera data is over 10 s old and currently estimated.',
    legendDots: 'Crowd dots: sampled from zone counts, not individual person tracking.',
    legendBoard: 'Guidance sign: green shows approved diversion; turns red if pointing at a closed gate.',

    // Guidance & Log panel
    guidanceTitle: 'Guidance',
    tipGuidance: 'M4 proposes display diversions when a 2-min forecast exceeds 2.2 p/m² or a gate closes. Nothing changes until approved.',
    guidanceOff: 'Guidance switched off (baseline).',
    guidanceEmpty: 'No pending proposal.',
    untickTip: 'Untick to leave this display unchanged',
    btnApprove: 'Approve',
    btnReject: 'Reject',
    btnShow: 'Show',
    logTitle: 'Log',
    logEmpty: 'No events yet.',

    // Bottom panels
    chartTitle: 'Highest density in walking zones',
    chartSub: 'persons/m²',
    chartEmpty: 'Awaiting telemetry',
    keyNow: 'Twin estimate',
    keyFc: '2-min forecast',
    keyTruth: 'Testbed truth (evaluation only)',
    keyLim: (limit) => `Limit ${limit}`,
    gatesTitle: 'Gates',
    gatesSub: 'people counted in',
    tipGates: 'Cumulative people counted into each gate during egress. Closed gates are highlighted in red.',
    gateLabel: (ref) => `Gate ${ref}`,
    gateClosedState: 'closed',
    evalTitle: 'Twin vs testbed',
    evalSub: 'evaluation only',
    tipEval: 'Ground truth comes from the testbed for evaluation only — M3 and M4 never read it.\nTarget accuracy: density error ≤ 0.5 persons/m².',
    evalTargetPill: 'Target error ≤ 0.5 p/m²',
    evalErrNow: 'Density error now, mean / max',
    evalNoCamIdle: 'No camera zone est. / true',
    evalNoCam: (zone) => `No camera: ${zone} est. / true`,
    evalCompEst: 'Compliance estimated by twin',
    evalCompTrue: 'Compliance in testbed',
    evalRunErr: 'Run density error, mean / max',
    evalT90: '90% out',
    evalOverLim: (limit) => `Zone-seconds above ${limit}`,

    // KPIs
    kpiClock: 'Egress clock',
    kpiInside: 'People inside',
    kpiOut: 'Out',
    kpiPeak: 'Peak density',
    kpiForecast: 'Forecast +2 min',
    kpiOver: (limit) => `Zones over ${limit}`,
    kpiStale: 'Stale cameras',
    kpiLatency: 'Latency',
    na: 'n/a',

    // Log messages
    logStart: (mode) => `Egress started (${mode})`,
    approvalModeLog: { none: 'no guidance', auto: 'batch approval', manual: 'manual approval' },
    logRunEnd: ({ status, t90, over, limit }) =>
      `Run ${status}, 90% out at ${t90}, ${over} zone-s over ${limit}`,
    logFacility: ({ ref, status }) => `Gate ${ref} ${status}`,
    facilityStatusMap: { closed: 'closed', open: 'open' },
    logGuidance: {
      proposed: ({ version, count, gates }) => `Proposal ${version}: ${count} displays to Gate ${gates}`,
      approved: ({ version, count }) => `Proposal ${version} approved, ${count} displays changed`,
      rejected: ({ version }) => `Proposal ${version} rejected`,
      superseded: ({ version }) => `Proposal ${version} expired undecided`,
    },
    actorMap: {
      'M4': 'M4',
      'duty manager': 'duty manager',
      'manager': 'manager',
      'rule:auto': 'rule:auto',
      'rule:expired': 'rule:expired',
      'venue-ops': 'venue-ops',
    },

    // Hover tooltip
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
    tipPeopleDensity: (count, density) => `${count} people, ${density} p/m²`,
    tipForecast: (density) => `in 2 min: ${density} p/m²`,
    tipStale: (age) => `camera data ${age} s old, estimated`,
    tipMeasured: 'measured',
    tipEstimatedLines: 'no camera, estimated from counting lines',
    tipHasCam: 'camera',
    tipNoCam: 'no camera',

    // 3D sprite labels
    spriteGateOpen: (ref) => `GATE ${ref}`,
    spriteGateClosed: (ref) => `GATE ${ref} CLOSED`,

    // P1 gate controls
    gateBtnClose: 'Close',
    gateBtnReopen: 'Reopen',
    gateLastOpenTip: 'At least one gate must remain open',
    gateRunOnlyTip: 'Start a run to control gates',

    // P2 chart, zone inspector and baseline

    // P3 proposal preview
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
    statusProvisional: '编号待确认',
    statusConnecting: '连接中',
    statusOffline: 'M2 离线，重试中',
    statusReady: '就绪',
    statusLiveLabel: '运行中',
    statusRunEnded: (status) => `运行${status}`,
    runStatusMap: { completed: '已完成', stopped: '已停止', interrupted: '已中断', running: '运行中' },

    // Toolbar
    toolbarAria: '显示设置',
    langAria: '语言切换',
    themeAria: '亮暗主题切换',
    themeLightTitle: '浅色模式',
    themeDarkTitle: '深色模式',

    // Scenario panel
    scenarioTitle: '场景配置',
    tipScenario: '测试台输入参数：设定散场期间关闭的闸口、观众遵从率、审批方式、仿真倍速与摄像头中断事件。',
    gateClosedLabel: '关闭闸口',
    gateNoClosure: '不关闭闸口',
    gateClosesAt: (ref) => `闸口 ${ref} 于 2:00 关闭`,
    complianceLabel: '观众遵从率',
    approvalLabel: '审批模式',
    approvalManual: '值班经理审批',
    approvalAuto: '规则自动审批',
    approvalNone: '无引导（基线）',
    speedLabel: '仿真倍速',
    dropShort: '模拟摄像头中断',
    tipDrop: '3:20 起 C08 与 C10 摄像头中断 2 分钟，用于检验超时回退与无监控分区估计。',
    btnStart: '开始散场',
    btnStop: '停止',

    // View panel
    viewTitle: '视角',
    views: { Overview: '全景', Concourse: '环廊', Floor: '内场', Plan: '俯视' },
    showShellShort: '屋顶与立面',
    postFxShort: '后期画质',
    legendMaxTick: '4 人/m²',
    legDashShort: '无监控',
    legGreyShort: '超时',
    legDotsShort: '人点',
    legBoardShort: '引导牌',
    tipRamp: '通行区人群密度色带（0–4 人/m²），超过 2.2 人/m²（Fruin F 阈值）时触发引导提案。',
    legendDash: '虚线边框：该分区未部署摄像头，人数由周边计数线推算。',
    legendGrey: '灰色边框：摄像头数据已超过 10 秒未更新，当前由模型估计。',
    legendDots: '人群散点：按分区实时人数随机采样呈现，非个体追踪。',
    legendBoard: '引导显示屏：绿色为已批准改导方向；若指向已关闭闸口则变红告警。',

    // Guidance & Log panel
    guidanceTitle: '引导决策',
    tipGuidance: '当 2 分钟预测超过 2.2 人/m² 或闸口关闭时，M4 自动生成引导提案，经值班经理审批后才下发至现场显示屏。',
    guidanceOff: '当前为基线模式（已关闭引导）。',
    guidanceEmpty: '暂无待审批提案。',
    untickTip: '取消勾选以保持该显示屏不变',
    btnApprove: '批准',
    btnReject: '驳回',
    btnShow: '定位',
    logTitle: '运行日志',
    logEmpty: '暂无运行事件。',

    // Bottom panels
    chartTitle: '通行区最高密度',
    chartSub: '人/m²',
    chartEmpty: '等待散场数据',
    keyNow: '孪生估计',
    keyFc: '2 分钟预测',
    keyTruth: '测试台真值（仅评估）',
    keyLim: (limit) => `阈值 ${limit}`,
    gatesTitle: '各闸口通行',
    gatesSub: '累计进入人数',
    tipGates: '散场期间累计进入各闸口的人数统计；已关闭的闸口以红色高亮显示。',
    gateLabel: (ref) => `闸口 ${ref}`,
    gateClosedState: '已关闭',
    evalTitle: '孪生与真值对比',
    evalSub: '仅评估',
    tipEval: '真值来自测试台，仅作精度评估展示，M3 与 M4 均不读取。\n精度目标：密度误差 ≤ 0.5 人/m²。',
    evalTargetPill: '目标误差 ≤ 0.5 人/m²',
    evalErrNow: '当前密度误差（均值 / 最大）',
    evalNoCamIdle: '无监控盲区（估计 / 真值）',
    evalNoCam: (zone) => `无监控 ${zone}（估计 / 真值）`,
    evalCompEst: '孪生估计遵从率',
    evalCompTrue: '测试台真实遵从率',
    evalRunErr: '全程密度误差（均值 / 最大）',
    evalT90: '90% 离场用时',
    evalOverLim: (limit) => `超 ${limit} 分区秒`,

    // KPIs
    kpiClock: '散场计时',
    kpiInside: '馆内人数',
    kpiOut: '已离场',
    kpiPeak: '峰值密度',
    kpiForecast: '+2 分钟预测',
    kpiOver: (limit) => `超 ${limit} 分区`,
    kpiStale: '掉线摄像头',
    kpiLatency: '系统延迟',
    na: '暂无',

    // Log messages
    logStart: (mode) => `开始散场（${mode}）`,
    approvalModeLog: { none: '无引导', auto: '自动审批', manual: '手动审批' },
    logRunEnd: ({ status, t90, over, limit }) =>
      `运行${status}，90% 离场 ${t90}，超 ${limit} 共 ${over} 分区秒`,
    logFacility: ({ ref, status }) => `闸口 ${ref} ${status}`,
    facilityStatusMap: { closed: '已关闭', open: '已开放' },
    logGuidance: {
      proposed: ({ version, count, gates }) => `提案 #${version}：${count} 块屏改导至闸口 ${gates}`,
      approved: ({ version, count }) => `提案 #${version} 已批准，更新 ${count} 块显示屏`,
      rejected: ({ version }) => `提案 #${version} 已驳回`,
      superseded: ({ version }) => `提案 #${version} 超时未决已失效`,
    },
    actorMap: {
      'M4': 'M4',
      'duty manager': '值班经理',
      'manager': '值班经理',
      'rule:auto': '自动规则',
      'rule:expired': '超时规则',
      'venue-ops': '场馆运维',
    },

    // Hover tooltip
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
    tipPeopleDensity: (count, density) => `${count} 人，${density} 人/m²`,
    tipForecast: (density) => `2 分钟后预测：${density} 人/m²`,
    tipStale: (age) => `摄像头数据已超时 ${age} 秒，当前为模型估计`,
    tipMeasured: '摄像头实测',
    tipEstimatedLines: '无摄像头，由计数线推算',
    tipHasCam: '已部署摄像头',
    tipNoCam: '无摄像头',

    // 3D sprite labels
    spriteGateOpen: (ref) => `闸口 ${ref}`,
    spriteGateClosed: (ref) => `闸口 ${ref} 已关闭`,

    // P1 gate controls
    gateBtnClose: '关闭',
    gateBtnReopen: '重开',
    gateLastOpenTip: '至少须保留一个开放闸口',
    gateRunOnlyTip: '运行散场后可控制闸口',

    // P2 chart, zone inspector and baseline

    // P3 proposal preview
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
    plan = `最繁忙闸口当前需 ${planMatch[1]} 分钟清空，执行本方案需 ${planMatch[2]} 分钟（假定遵从率 ${planMatch[3]}）`
  }

  return { why, plan }
}

export function formatApiError(message, lang) {
  if (lang !== 'zh') return message
  if (String(message).includes('this proposal is no longer pending')) return '该提案已不再等待审批'
  return message
}
