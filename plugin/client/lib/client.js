/**
 * dsh-pet-bridge-ui — 浏览器半边（DSH Web 设置面板 · 唯一控制台）
 *
 * 注册方式：Cordis client plugin，`ctx.slots.register({ name: 'settings.section', ... })`
 * 把「大肥鱼联动」挂进设置左侧导航；组件通过同源 POST `<channel>/<endpoint>` 与
 * Host 半边（lib/index.js）通信（官方 /api wire 协议同构信封）。
 *
 * 本文件是 `window.__ModuleLoader__.load()` 工厂格式（DSH client bundle 契约），
 * 不是普通 ESM；`require` 由模块系统提供（react 属于平台基线模块）。无需构建步骤。
 */
window.__ModuleLoader__.load({
  id: 'dsh-pet-bridge-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const CHANNEL = '/pet-bridge-ui'
    const REFRESH_MS = 5000
    const ACTIVITY_META = {
      quiet: { label: '安静', desc: '少说话，间隔 ≥45s，几乎不动作' },
      normal: { label: '正常', desc: '日常节奏，间隔 ≥17s，偶尔小动作' },
      lively: { label: '活泼', desc: '话多一点，间隔 ≥10s，动作更频繁' }
    }
    const MODE_META = [
      { value: 'wander', label: '散步' },
      { value: 'follow', label: '跟随' }
    ]
    const LINE_FREQ_META = [
      { value: '安静', label: '安静' },
      { value: '正常', label: '正常' },
      { value: '话多', label: '话多' },
      { value: '话痨', label: '话痨' }
    ]
    const SIZE_PRESETS = [
      { label: '迷你', value: 0.27 },
      { label: '特小', value: 0.36 },
      { label: '小', value: 0.54 },
      { label: '中', value: 0.72 },
      { label: '大', value: 0.9 }
    ]
    const LAYER_META = [
      { value: 'top', label: '置顶' },
      { value: 'normal', label: '普通' },
      { value: 'bottom', label: '置底' }
    ]
    const BUBBLE_STYLE_META = [
      { value: 'auto', label: '自动' },
      { value: 'light', label: '亮色' },
      { value: 'dark', label: '暗色' }
    ]
    const DOUBLE_CLICK_META = [
      { value: 'balance', label: '看一眼余额' },
      { value: 'weather', label: '看一眼天气' },
      { value: 'music', label: '看一眼在放什么' },
      { value: 'lines', label: '说一句台词' }
    ]
    /** task-36 快捷查看按钮（对齐旧右键菜单项）。 */
    const PET_ACTION_META = [
      { name: 'balance', label: '查看余额', hint: '气泡 5 秒' },
      { name: 'weather', label: '查看天气', hint: '当前城市' },
      { name: 'music', label: '在看什么', hint: '当前播放' },
      { name: 'summary', label: '今日汇总', hint: '小票最近 4 行' },
      { name: 'show', label: '显示', hint: '叫出来' },
      { name: 'hide', label: '隐藏', hint: '收起来' },
      { name: 'snapInto', label: '回到屏幕内', hint: '防跑出屏幕' },
      { name: 'recover', label: '救急恢复', hint: '回屏内+显示+置前' }
    ]
    const KIND_LABEL = {
      turnStart: '开工',
      turnEnd: '收工',
      turnEndBad: '安慰',
      approval: '等待确认',
      report: '报账',
      morning: '早安',
      sleep: '深夜',
      selfTalk: '独白',
      inner: '内心'
    }
    const ACTION_LABEL = {
      'restart-pet': '重启桌宠',
      'start-pet': '启动桌宠',
      'stop-pet': '停止桌宠',
      'enable-autostart': '开启开机自启',
      'disable-autostart': '关闭开机自启',
      'quit-pet': '退出桌宠'
    }
    /** task-44 状态色调（与样式主题一致的语义色）。 @type {Record<string,string>} */
    const TONE_COLOR = {
      ok: '#3fb950',
      busy: '#6ea8ff',
      warn: '#d29922',
      err: '#e5534b',
      dim: '#9aa0a6'
    }

    const PENDING_LABEL = {
      enabled: '总开关',
      activity: '活跃度',
      quietHours: '免打扰时段',
      budgetPerDayYuan: '每日上限',
      'pet.bubbleMs': '气泡停留时长',
      'pet.city': '城市',
      'pet.musicLink': '音乐联动',
      'pet.soundOn': '音效开关',
      'pet.skin': '皮肤',
      'pet.layer': '层级',
      'pet.bubbleStyle': '气泡风格',
      'pet.topmost': '置顶',
      'pet.snap': '贴边吸附',
      'pet.volume': '音量',
      'pet.quietMinutes': '静音时长',
      'pet.doubleClick': '双击行为'
    }

    const S = {
      wrap: {
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontSize: 13,
        lineHeight: 1.6,
        maxWidth: 800
      },
      header: { display: 'flex', flexDirection: 'column', gap: 2 },
      h1: { fontSize: 16, fontWeight: 600, margin: 0 },
      hint: { fontSize: 12, opacity: 0.6, margin: 0 },
      card: {
        border: '1px solid rgba(128,128,128,.28)',
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      },
      cardHead: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap'
      },
      cardTitle: { fontSize: 13, fontWeight: 600, margin: 0 },
      row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
      grow: { flex: '1 1 220px', minWidth: 0 },
      block: { minWidth: 0 },
      grid2: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 10
      },
      statusGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 8
      },
      statBox: {
        border: '1px solid rgba(128,128,128,.22)',
        borderRadius: 6,
        padding: '7px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0
      },
      statLabel: { fontSize: 11, opacity: 0.55 },
      statValue: {
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 6
      },
      statDetail: {
        fontSize: 11,
        opacity: 0.5,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      },
      dotOn: { color: '#3fb950' },
      dotOff: { color: '#e5534b' },
      dotUnknown: { color: '#d29922' },
      badge: {
        fontSize: 11,
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid rgba(90,150,255,.5)',
        color: '#6ea8ff',
        whiteSpace: 'nowrap'
      },
      badgeWarn: {
        fontSize: 11,
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid rgba(210,153,34,.5)',
        color: '#d29922',
        whiteSpace: 'nowrap'
      },
      field: {
        background: 'transparent',
        color: 'inherit',
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 13,
        minWidth: 0,
        boxSizing: 'border-box',
        width: '100%',
        colorScheme: 'dark'
      },
      label: { fontSize: 11, opacity: 0.55, display: 'block', marginBottom: 2 },
      btn: {
        background: 'transparent',
        color: 'inherit',
        border: '1px solid rgba(128,128,128,.4)',
        borderRadius: 6,
        padding: '5px 12px',
        fontSize: 13,
        cursor: 'pointer',
        lineHeight: 1.5
      },
      btnPrimary: {
        background: 'rgba(90,150,255,.16)',
        borderColor: 'rgba(90,150,255,.5)'
      },
      btnDanger: { borderColor: 'rgba(229,83,75,.55)', color: '#e5534b' },
      btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
      seg: {
        display: 'flex',
        gap: 0,
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: 7,
        overflow: 'hidden',
        width: 'fit-content'
      },
      segItem: {
        background: 'transparent',
        color: 'inherit',
        border: 'none',
        borderRight: '1px solid rgba(128,128,128,.25)',
        padding: '6px 14px',
        fontSize: 13,
        cursor: 'pointer',
        lineHeight: 1.4
      },
      segItemLast: { borderRight: 'none' },
      segActive: { background: 'rgba(90,150,255,.22)', fontWeight: 600 },
      chip: {
        background: 'transparent',
        color: 'inherit',
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        cursor: 'pointer',
        lineHeight: 1.5
      },
      chipActive: {
        background: 'rgba(90,150,255,.18)',
        borderColor: 'rgba(90,150,255,.5)'
      },
      toggle: {
        border: '1px solid rgba(128,128,128,.4)',
        borderRadius: 999,
        padding: '3px 14px',
        fontSize: 12,
        cursor: 'pointer',
        lineHeight: 1.6,
        background: 'transparent',
        color: 'inherit'
      },
      toggleOn: {
        background: 'rgba(63,185,80,.18)',
        borderColor: 'rgba(63,185,80,.55)',
        color: '#3fb950'
      },
      ok: { fontSize: 12, color: '#3fb950', margin: 0 },
      err: {
        fontSize: 12,
        color: '#e5534b',
        whiteSpace: 'pre-wrap',
        margin: 0
      },
      warn: {
        fontSize: 12,
        color: '#d29922',
        margin: 0,
        whiteSpace: 'pre-wrap'
      },
      mono: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        opacity: 0.5,
        wordBreak: 'break-all',
        margin: 0
      },
      list: {
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        margin: 0,
        padding: 0,
        listStyle: 'none'
      },
      listItem: {
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        borderBottom: '1px solid rgba(128,128,128,.12)',
        paddingBottom: 4
      },
      listTime: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        opacity: 0.5,
        flex: '0 0 auto'
      },
      listKind: { fontSize: 11, opacity: 0.75, flex: '0 0 auto', minWidth: 56 },
      listText: { fontSize: 12, flex: '1 1 auto', minWidth: 0 },
      progressTrack: {
        height: 6,
        borderRadius: 3,
        background: 'rgba(128,128,128,.2)',
        overflow: 'hidden',
        width: '100%'
      },
      progressBar: { height: '100%', borderRadius: 3, transition: 'width .3s' },
      stateHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap'
      },
      stateDot: { fontSize: 22, lineHeight: 1 },
      stateName: { fontSize: 18, fontWeight: 700, lineHeight: 1.2 },
      stateDisconnected: {
        fontSize: 12,
        color: '#e5534b',
        margin: 0,
        fontWeight: 600
      },
      sessionGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        marginBottom: 2
      },
      sessionGroupHead: {
        fontSize: 11,
        opacity: 0.55,
        letterSpacing: '.02em',
        marginTop: 2
      },
      sessionRow: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        flexWrap: 'wrap',
        border: '1px solid rgba(128,128,128,.18)',
        borderRadius: 6,
        padding: '5px 8px'
      },
      sessionRowCurrent: {
        borderColor: 'rgba(90,150,255,.55)',
        background: 'rgba(90,150,255,.10)'
      },
      sessionDot: { fontSize: 12, lineHeight: 1 },
      sessionTitle: { fontSize: 13, fontWeight: 600, minWidth: 0 },
      sessionMeta: { fontSize: 11, opacity: 0.62 },
      sessionId: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 10,
        opacity: 0.38
      },
      sessionBadge: {
        fontSize: 10,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid rgba(90,150,255,.6)',
        color: '#6ea8ff',
        lineHeight: 1.6
      },
      sessionBadgeBg: {
        fontSize: 10,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid rgba(128,128,128,.35)',
        color: '#9aa0a6',
        lineHeight: 1.6
      },
      img: {
        maxWidth: '100%',
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,.3)',
        display: 'block'
      },
      pre: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.5,
        background: 'rgba(128,128,128,.1)',
        border: '1px solid rgba(128,128,128,.25)',
        borderRadius: 6,
        padding: 8,
        maxHeight: 240,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        margin: 0
      },
      slider: { width: '100%', accentColor: '#5a96ff', colorScheme: 'dark' },
      sliderRow: { display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 },
      sliderVal: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        opacity: 0.8,
        minWidth: 64,
        textAlign: 'right'
      }
    }

    /** 同源 POST，官方 wire 信封；返回 handler 的 data。 */
    /**
     * 通过同源 POST 调用 Host 半边（官方 wire 信封）。
     * @param {string} endpoint 端点名（`state.get` / `config.set` / `pet.action` / …）
     * @param {object} [payload] 业务负载
     * @returns {Promise<any>} handler 返回的 `data`
     * @throws {Error} HTTP 失败、信封异常、或 handler 返回 `{ok:false}` 时抛出带中文 message 的错误
     */
    async function call(endpoint, payload) {
      const rpcId = 'pbu-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      const res = await fetch(CHANNEL + '/' + endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ rpcId, method: endpoint, payload })
      })
      if (!res.ok) throw new Error('HTTP ' + res.status + '（路由未注册或鉴权失败）')
      const body = await res.json()
      if (!body || body.type !== 'server-response') throw new Error('响应格式异常')
      const result = body.result
      if (!result) throw new Error('空响应')
      if (result.ok === false) throw new Error(result.error && result.error.message ? result.error.message : '调用失败')
      return result.data
    }

    /** ISO 时间 → 本地「HH:MM:SS MM/DD」。 @param {string|null|undefined} iso @returns {string} */
    function fmtTime(iso) {
      if (!iso) return '—'
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return '—'
      return (
        d.toLocaleTimeString('zh-CN', { hour12: false }) +
        ' ' +
        d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
      )
    }
    function fmtMoney(n) {
      const v = Number(n)
      if (!Number.isFinite(v)) return '¥0'
      return '¥' + (v >= 0.01 ? v.toFixed(2) : v.toFixed(4))
    }

    /**
     * 毫秒时长 → 人类可读（`3.2s` / `1m 05s` / `2h 03m`）。
     * @param {number|null|undefined} ms
     * @returns {string}
     */
    function fmtDuration(ms) {
      const v = Number(ms)
      if (!Number.isFinite(v) || v < 0) return '—'
      if (v < 1000) return Math.round(v) + 'ms'
      const s = v / 1000
      if (s < 60) return s.toFixed(1) + 's'
      const m = Math.floor(s / 60)
      const rs = Math.round(s % 60)
      if (m < 60) return m + 'm ' + String(rs).padStart(2, '0') + 's'
      return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'
    }

    /**
     * 距今毫秒 → 「刚刚 / x 秒前 / x 分钟前 / x 小时前」。
     * @param {number|null|undefined} ms
     * @returns {string}
     */
    function fmtAge(ms) {
      const v = Number(ms)
      if (!Number.isFinite(v)) return '—'
      if (v < 2000) return '刚刚'
      if (v < 60000) return Math.round(v / 1000) + ' 秒前'
      if (v < 3600000) return Math.round(v / 60000) + ' 分钟前'
      return Math.round(v / 3600000) + ' 小时前'
    }
    function pct(n) {
      const v = Number(n)
      return Number.isFinite(v) ? Math.round(v * 100) + '%' : '—'
    }

    /** 状态圆点：在线绿 / 离线红 / 未知黄。 @param {{on?: boolean, unknown?: boolean}} props */
    function Dot({ on, unknown }) {
      return h('span', { style: unknown ? S.dotUnknown : on ? S.dotOn : S.dotOff }, '●')
    }
    /** 状态小卡：标签 + 圆点 + 值 + 细节（面板状态区统一用）。 @param {{label: string, on?: boolean, unknown?: boolean, value: any, detail?: string}} props */
    function Stat({ label, on, unknown, value, detail }) {
      return h(
        'div',
        { style: S.statBox },
        h('span', { style: S.statLabel }, label),
        h('span', { style: S.statValue }, h(Dot, { on, unknown }), value),
        detail ? h('span', { style: S.statDetail, title: detail }, detail) : null
      )
    }
    /** 分区卡片：标题 + 右上角操作区。 @param {{title: string, right?: any, children?: any}} props */
    function Card({ title, right, children }) {
      return h(
        'section',
        { style: S.card },
        h('div', { style: S.cardHead }, h('h2', { style: S.cardTitle }, title), right ? h('span', null, right) : null),
        children
      )
    }
    /** 分段选择器（活跃度/模式/语录频率等）。 @param {{value: string, options: Array<{value:string,label:string}>, onChange: (v:string)=>void, disabled?: boolean}} props */
    function Segmented({ value, options, onChange, disabled }) {
      return h(
        'div',
        { style: S.seg },
        options.map((opt, i) =>
          h(
            'button',
            {
              key: opt.value,
              type: 'button',
              style: Object.assign(
                {},
                S.segItem,
                i === options.length - 1 ? S.segItemLast : null,
                value === opt.value ? S.segActive : null,
                disabled ? S.btnDisabled : null
              ),
              disabled,
              onClick: () => onChange(opt.value)
            },
            opt.label
          )
        )
      )
    }
    /** 开关（pill 按钮）。 @param {{value: boolean, onChange: (v:boolean)=>void, disabled?: boolean, onLabel?: string, offLabel?: string}} props */
    function Toggle({ value, onChange, disabled, onLabel, offLabel }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': value ? 'true' : 'false',
          style: Object.assign({}, S.toggle, value ? S.toggleOn : null, disabled ? S.btnDisabled : null),
          disabled,
          onClick: () => onChange(!value)
        },
        value ? onLabel || '开' : offLabel || '关'
      )
    }

    /** 构造设置页 Panel 组件（供 ctx.slots.register 使用）。 @returns {Function} Panel 组件 */
    function makeSection() {
      /** 大肥鱼联动设置面板（唯一控制台）：实时状态/运行状态/基础设置/快捷查看/应急/日志/测试。 @returns {any} React 元素 */
      function Panel() {
        const [state, setState] = React.useState(null)
        const [form, setForm] = React.useState(defaultForm())
        const [busy, setBusy] = React.useState('')
        const [msg, setMsg] = React.useState(null)
        const [shot, setShot] = React.useState(null)
        const [testLine, setTestLine] = React.useState('')
        const [logs, setLogs] = React.useState(null)
        const [showRollback, setShowRollback] = React.useState(false)
        /** 主页「今日数据卡」是否默认展开费用估算（存 localStorage；默认关）。 */
        const [showCostDefault, setShowCostDefault] = React.useState(() => {
          try {
            return window.localStorage.getItem('pet-bridge-ui.showCost') === '1'
          } catch {
            return false
          }
        })
        const setShowCostPref = (value) => {
          setShowCostDefault(value)
          try {
            window.localStorage.setItem('pet-bridge-ui.showCost', value ? '1' : '0')
          } catch {
            /* 隐私模式等场景忽略 */
          }
        }
        const dirtyRef = React.useRef(false)
        const aliveRef = React.useRef(true)
        const formRef = React.useRef(form)
        formRef.current = form

        function defaultForm() {
          return {
            enabled: true,
            activity: 'normal',
            quietHours: '23:30-08:00',
            budgetPerDayYuan: '1.0',
            size: 0.36,
            opacity: 1.0,
            mode: 'wander',
            lineFreq: '正常',
            passthrough: false,
            locked: false,
            topmost: true,
            snap: true,
            layer: 'top',
            bubbleStyle: 'auto',
            skin: '大肥鱼',
            quietMinutes: '30',
            bubbleSec: '5',
            city: '',
            musicLink: true,
            doubleClick: 'balance',
            autoStart: false,
            guardsMax: '60',
            guardsNoRepeat: true,
            modeSilent: '30',
            modeFocus: '50',
            modeAutoResume: true
          }
        }

        const syncForm = (data) => {
          if (!data || dirtyRef.current) return
          const cfg = data.saved || data.config || {}
          const pet = Object.assign({}, data.petSettings || {}, (data.saved && data.saved.pet) || {})
          setForm({
            enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : true,
            activity: ACTIVITY_META[cfg.activity] ? cfg.activity : 'normal',
            quietHours: Array.isArray(cfg.quietHours) ? cfg.quietHours.join(', ') : '23:30-08:00',
            budgetPerDayYuan: String(
              typeof cfg.budgetPerDayYuan === 'number'
                ? cfg.budgetPerDayYuan
                : cfg.llm && typeof cfg.llm.budgetPerDayYuan === 'number'
                  ? cfg.llm.budgetPerDayYuan
                  : 1.0
            ),
            size: typeof pet.size === 'number' ? pet.size : 0.36,
            opacity: typeof pet.opacity === 'number' ? pet.opacity : 1.0,
            mode: MODE_META.some((m) => m.value === pet.mode) ? pet.mode : 'wander',
            lineFreq: LINE_FREQ_META.some((m) => m.value === pet.lineFreq) ? pet.lineFreq : '正常',
            passthrough: typeof pet.passthrough === 'boolean' ? pet.passthrough : false,
            locked: typeof pet.locked === 'boolean' ? pet.locked : false,
            topmost: typeof pet.topmost === 'boolean' ? pet.topmost : true,
            snap: typeof pet.snap === 'boolean' ? pet.snap : true,
            layer: LAYER_META.some((m) => m.value === pet.layer) ? pet.layer : 'top',
            bubbleStyle: BUBBLE_STYLE_META.some((m) => m.value === pet.bubbleStyle) ? pet.bubbleStyle : 'auto',
            skin: typeof pet.skin === 'string' && pet.skin ? pet.skin : '大肥鱼',
            quietMinutes: String(typeof pet.quietMinutes === 'number' ? pet.quietMinutes : 30),
            bubbleSec: String(typeof pet.bubbleMs === 'number' ? Math.round(pet.bubbleMs / 1000) : 5),
            city: typeof pet.city === 'string' ? pet.city : '',
            musicLink: typeof pet.musicLink === 'boolean' ? pet.musicLink : true,
            doubleClick: DOUBLE_CLICK_META.some(
              (m) => m.value === ((data.petOptions && data.petOptions.doubleClick) || pet.doubleClick)
            )
              ? (data.petOptions && data.petOptions.doubleClick) || pet.doubleClick
              : 'balance',
            autoStart:
              typeof pet.autoStart === 'boolean'
                ? pet.autoStart
                : data.petOptions && typeof data.petOptions.autoStart === 'boolean'
                  ? data.petOptions.autoStart
                  : false,
            guardsMax: String((data.guards && data.guards.maxActionsPerHour) || 60),
            guardsNoRepeat:
              data.guards && typeof data.guards.noActionOnSameState === 'boolean'
                ? data.guards.noActionOnSameState
                : true,
            modeSilent: String((data.modeSettings && data.modeSettings.silentMinutes) || 30),
            modeFocus: String((data.modeSettings && data.modeSettings.focusMinutes) || 50),
            modeAutoResume:
              data.modeSettings && typeof data.modeSettings.autoResume === 'boolean'
                ? data.modeSettings.autoResume
                : true
          })
        }

        const refresh = React.useCallback(async (showBusy) => {
          if (showBusy) setBusy('load')
          try {
            const data = await call('state.get')
            if (!aliveRef.current) return
            setState(data)
            syncForm(data)
            if (msg && msg.kind === 'err') setMsg(null)
          } catch (error) {
            if (aliveRef.current) setMsg({ kind: 'err', text: '读取状态失败：' + error.message })
          } finally {
            if (aliveRef.current && showBusy) setBusy('')
          }
        }, [])

        React.useEffect(() => {
          aliveRef.current = true
          refresh(false)
          const timer = setInterval(() => refresh(false), REFRESH_MS)
          return () => {
            aliveRef.current = false
            clearInterval(timer)
          }
        }, [])

        const touch = (patch) => {
          dirtyRef.current = true
          setForm(Object.assign({}, formRef.current, patch))
        }

        const save = async () => {
          setBusy('save')
          setMsg(null)
          try {
            const ranges = form.quietHours
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
            const data = await call('config.set', {
              enabled: form.enabled,
              activity: form.activity,
              quietHours: ranges,
              budgetPerDayYuan: Number(form.budgetPerDayYuan),
              guards: {
                maxActionsPerHour: Number(form.guardsMax),
                noActionOnSameState: form.guardsNoRepeat
              },
              mode: {
                silentMinutes: Number(form.modeSilent),
                focusMinutes: Number(form.modeFocus),
                autoResume: form.modeAutoResume
              },
              pet: {
                size: Number(form.size),
                opacity: Number(form.opacity),
                mode: form.mode,
                lineFreq: form.lineFreq,
                passthrough: form.passthrough,
                locked: form.locked,
                topmost: form.topmost,
                snap: form.snap,
                layer: form.layer,
                bubbleStyle: form.bubbleStyle,
                skin: form.skin,
                quietMinutes: Number(form.quietMinutes),
                bubbleMs: Math.max(1000, Math.min(30000, Math.round(Number(form.bubbleSec) * 1000))),
                city: form.city,
                musicLink: form.musicLink,
                soundOn: false,
                doubleClick: form.doubleClick,
                autoStart: form.autoStart
              }
            })
            // 开机自启：服务端就绪后改走 ui-action（v20：enable/disable-autostart）
            try {
              if (
                actionReady('autoStart') &&
                petOptions &&
                typeof petOptions.autoStart === 'boolean' &&
                form.autoStart !== petOptions.autoStart
              ) {
                await call('action.request', {
                  name: form.autoStart ? 'enable-autostart' : 'disable-autostart'
                })
              }
            } catch (autoStartError) {
              // 自启队列失败不回滚已保存配置（面板会显示 pending）
            }
            dirtyRef.current = false
            setMsg({ kind: 'ok', text: '已保存 · ' + (data.note || '') })
            if (data.state) {
              setState(data.state)
              syncForm(data.state)
            }
          } catch (error) {
            setMsg({ kind: 'err', text: '保存失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        const runTest = async (kind) => {
          setBusy('test:' + kind)
          setMsg(null)
          if (kind !== 'screenshot') setShot(null)
          try {
            if (kind === 'say') {
              const text = testLine.trim()
              const data = await call('test.say', text ? { text } : {})
              setMsg({ kind: 'ok', text: '已让桌宠说一句：' + data.line })
            } else if (kind === 'jump') {
              await call('test.jump')
              setMsg({ kind: 'ok', text: '已发送动作：跳一下' })
            } else {
              const data = await call('test.screenshot')
              setShot(data)
              setMsg({
                kind: 'ok',
                text: '截图完成 ' + Math.round(data.bytes / 1024) + ' KB（未写日志）'
              })
            }
          } catch (error) {
            setMsg({ kind: 'err', text: '测试失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        const loadLogs = async () => {
          if (logs) {
            setLogs(null)
            return
          }
          setBusy('logs')
          try {
            const data = await call('logs.get', { lines: 80 })
            setLogs(data)
          } catch (error) {
            setMsg({ kind: 'err', text: '读取日志失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        /** task-36 快捷查看/免打扰即时动作：走 pet.action（管道命令 + 回执）。 */
        /** task-51：打开大肥鱼主页（同源 GET /pet-bridge-ui/home，新标签；不抢 DSH 焦点）。 */
        const openHome = () => {
          try {
            if (typeof window !== 'undefined' && typeof window.open === 'function') {
              window.open('/pet-bridge-ui/home', '_blank', 'noopener')
            }
          } catch {
            /* ignore */
          }
        }

        /**
         * task-67：切换控制模式（静一静/专注/下班/恢复）。
         * @param {'silent'|'focus'|'off'|'resume'} kind 模式
         * @param {object} [extra] `{minutes}` 或 `{until}`（ISO）
         * @returns {Promise<void>}
         */
        const runMode = async (kind, extra) => {
          setBusy('mode:' + kind)
          setMsg(null)
          try {
            await call('mode.request', Object.assign({ name: kind }, extra || {}))
            const label =
              kind === 'silent' ? '静一静' : kind === 'focus' ? '专注' : kind === 'off' ? '下班' : '恢复正常'
            setMsg({ kind: 'ok', text: '已请求「' + label + '」，联动插件 ≤20s 生效；倒计时见状态区' })
            const data = await call('state.get')
            if (aliveRef.current) {
              setState(data)
              syncForm(data)
            }
          } catch (error) {
            setMsg({ kind: 'err', text: '模式切换失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        const runPetAction = async (name, extra) => {
          setBusy('pet:' + name)
          setMsg(null)
          try {
            const data = await call('pet.action', Object.assign({ name }, extra || {}))
            const label = (PET_ACTION_META.find((a) => a.name === name) || {}).label || name
            const reply = data && data.reply ? '（' + data.reply + '）' : ''
            setMsg({ kind: 'ok', text: '已执行：' + label + reply })
          } catch (error) {
            setMsg({ kind: 'err', text: '执行失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        const requestAction = async (name) => {
          setBusy('action:' + name)
          setMsg(null)
          try {
            const data = await call('action.request', { name })
            setMsg({
              kind: 'ok',
              text: '已请求「' + (ACTION_LABEL[name] || name) + '」，联动插件 ≤20s 消费；结果见状态区'
            })
            if (data.request) refresh(false)
          } catch (error) {
            setMsg({ kind: 'err', text: '请求失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        const stopLinkage = async () => {
          setBusy('save')
          setMsg(null)
          try {
            const data = await call('config.set', { enabled: false })
            dirtyRef.current = false
            setMsg({
              kind: 'ok',
              text: '已停止联动（enabled=false，≤20s 生效；桌宠进程保留）'
            })
            if (data.state) {
              setState(data.state)
              syncForm(data.state)
            }
          } catch (error) {
            setMsg({ kind: 'err', text: '停止联动失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        const nativeUi = async (on) => {
          setBusy('nativeui')
          setMsg(null)
          try {
            await call('pet.nativeui', { on })
            setMsg({
              kind: 'ok',
              text: on ? '已临时显示桌宠原生菜单（用完建议隐藏）' : '已隐藏原生菜单'
            })
          } catch (error) {
            setMsg({ kind: 'err', text: '操作失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        const resetDefaults = async () => {
          const ok =
            typeof window !== 'undefined' && typeof window.confirm === 'function'
              ? window.confirm(
                  '恢复面板默认配置？\n将重置：总开关=开、活跃度=正常、免打扰=23:30-08:00、预算=¥1.0、\n大小=特小0.36×、透明度=100%、模式=散步、语录频率=正常、气泡=5s、\n置顶/贴边=开、层级=置顶、气泡风格=自动、皮肤=大肥鱼、\n音乐联动=开、城市=汕头、静音=30min、双击=看余额、自启=关、穿透/锁定=关。\n（音效/音量、全局快捷键已按用户决定移除）'
                )
              : true
          if (!ok) return
          setBusy('reset')
          setMsg(null)
          try {
            const data = await call('config.reset')
            dirtyRef.current = false
            setMsg({
              kind: 'ok',
              text: '已恢复默认配置 · ' + (data.note || '')
            })
            if (data.state) {
              setState(data.state)
              syncForm(data.state)
            }
          } catch (error) {
            setMsg({ kind: 'err', text: '恢复默认失败：' + error.message })
          } finally {
            setBusy('')
          }
        }

        if (!state) {
          return h(
            'div',
            { style: S.wrap },
            h(
              'div',
              { style: S.header },
              h('h1', { style: S.h1 }, '大肥鱼联动'),
              h('p', { style: S.hint }, 'DSH × 大肥鱼桌宠 · 唯一控制台')
            ),
            msg && msg.kind === 'err' ? h('p', { style: S.err }, msg.text) : null,
            h('p', { style: S.hint }, '正在读取联动状态…')
          )
        }

        const {
          host,
          pet,
          pipe,
          config,
          today,
          quiet,
          recentSay,
          saved,
          pending,
          petSettings,
          versions,
          lastAction,
          files,
          bubble,
          capabilities,
          petOptions,
          runtime,
          sessionList,
          companion,
          todayStats,
          events,
          teamFeatures,
          mode,
          modeSettings,
          hostMemory
        } = state
        const rt = runtime || {
          supported: false,
          state: 'idle',
          label: '未知',
          tone: 'dim',
          disconnected: true,
          staleAfterMs: 30000
        }
        // task-67：控制模式（v47 mode 字段；缺失时能力全 false → 骨架禁用）
        const md = mode
          ? { ...mode }
          : {
              available: false,
              active: false,
              kind: 'active',
              label: '正常',
              remainMs: 0,
              resumeAt: null,
              since: null,
              capabilities: { silent: false, focus: false, off: false, resume: false }
            }
        if (!md.label)
          md.label =
            md.kind === 'silent' ? '静一静' : md.kind === 'focus' ? '专注' : md.kind === 'off' ? '下班' : '正常'
        if (typeof md.available !== 'boolean') md.available = Boolean(md.kind || md.resumeAt || md.active)
        if (!md.capabilities)
          md.capabilities = (capabilities && capabilities.mode) || {
            silent: false,
            focus: false,
            off: false,
            resume: false
          }
        const resumeMsLocal = md.resumeAt ? new Date(md.resumeAt).getTime() : NaN
        if (!(Number(md.remainMs) > 0) && Number.isFinite(resumeMsLocal))
          md.remainMs = Math.max(0, resumeMsLocal - Date.now())
        const modeCaps = md.capabilities || { silent: false, focus: false, off: false, resume: false }
        const modeRemain = md.active && md.remainMs ? ' · 剩余 ' + fmtDuration(md.remainMs) : ''
        // task-46：多会话视图（无 sessionList 时按当前运行时兜底单会话）
        const sl = sessionList || {
          supported: false,
          currentSessionId: null,
          activeSessionCount: 1,
          total: 1,
          othersCount: 0,
          groups: [
            {
              workspace: '当前工作区',
              isCurrentGroup: true,
              sessions: [
                {
                  sessionId: null,
                  title: '(当前会话)',
                  state: rt.state,
                  label: rt.label,
                  tone: rt.tone,
                  tool: rt.tool,
                  isCurrent: true,
                  isBackground: false,
                  lastSeenAgeMs: rt.heartbeatAgeMs
                }
              ]
            }
          ]
        }
        const caps = capabilities || {}
        const actionReady = (name) => (caps.petActionReadiness ? caps.petActionReadiness[name] !== false : true)
        const petLabel = pet.online ? (pipe.online ? '在线' : '进程在 / 管道未响应') : '未找到'
        const petDetail = pipe.online
          ? '管道可用 · ' + (pipe.latencyMs != null ? pipe.latencyMs + 'ms' : '')
          : pet.processes > 0
            ? '检测到 ' + pet.processes + ' 个 pythonw 进程'
            : '管道 ' + (pipe.error || '不可用')
        const budget = today.budgetPerDayYuan
        const ratio = Math.max(0, Math.min(1, today.ratio || 0))
        const barColor = ratio >= 1 ? '#e5534b' : ratio >= 0.8 ? '#d29922' : '#3fb950'
        const sayNewestFirst = (recentSay || []).slice().reverse()
        const busyNow = Boolean(busy)
        const testBusy = (k) => busy === 'test:' + k
        const sizePct = Math.round(form.size * 100)
        const opacityPct = Math.round(form.opacity * 100)

        return h(
          'div',
          { style: S.wrap },
          h(
            'div',
            { style: S.header },
            h('h1', { style: S.h1 }, '大肥鱼联动'),
            h('p', { style: S.hint }, 'DSH × 大肥鱼桌宠 · 唯一控制台（状态 / 基础设置 / 应急 / 日志 / 测试）'),
            h(
              'div',
              { style: S.row },
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, S.btnPrimary),
                  onClick: openHome
                },
                '打开大肥鱼主页'
              ),
              h('span', { style: S.hint }, '新标签打开（同源鉴权）；主页含概览/会话/时间线/互动')
            )
          ),

          msg
            ? h(
                'p',
                {
                  style: msg.kind === 'err' ? S.err : msg.kind === 'warn' ? S.warn : S.ok
                },
                msg.text
              )
            : null,
          pending && pending.length > 0
            ? h(
                'p',
                { style: S.warn },
                '已保存、待联动插件应用（≤20s）：' + pending.map((k) => PENDING_LABEL[k] || k).join('、')
              )
            : null,

          // ── 实时状态（task-44：状态通道 state:<json>） ──
          h(
            Card,
            {
              title: '实时状态',
              right: h('span', { style: S.hint }, rt.supported ? '状态通道 · 5s 轮询' : '状态通道 · 待服务端')
            },
            h(
              'div',
              { style: S.stateHead },
              h(
                'span',
                {
                  style: Object.assign({}, S.stateDot, {
                    color: TONE_COLOR[rt.tone] || TONE_COLOR.dim
                  })
                },
                rt.disconnected ? '⚠' : '●'
              ),
              h('span', { style: S.stateName }, rt.label || '未知'),
              rt.disconnected
                ? h(
                    'span',
                    { style: S.stateDisconnected },
                    '失联（>' + Math.round((rt.staleAfterMs || 30000) / 1000) + 's 无心跳）'
                  )
                : null,
              rt.supported ? null : h('span', { style: S.badgeWarn }, '状态通道未就绪')
            ),
            h(
              'div',
              { style: S.statusGrid },
              h(Stat, {
                label: '当前工具',
                on: rt.state === 'tool' ? !!rt.tool : false,
                unknown: rt.state !== 'tool',
                value: rt.tool || '—',
                detail: rt.state === 'tool' ? '正在调用工具' : rt.tool ? '最近使用（当前非工具状态）' : ''
              }),
              h(Stat, {
                label: '状态耗时',
                on: !rt.disconnected,
                value: fmtDuration(rt.elapsedMs),
                detail: rt.since ? '起于 ' + fmtTime(rt.since) : '—'
              }),
              h(Stat, {
                label: '进度',
                on: !rt.disconnected,
                value:
                  rt.step == null
                    ? '—'
                    : rt.turn == null
                      ? '第 ' + rt.step + ' 步'
                      : '第 ' + rt.step + ' 步 / 第 ' + rt.turn + ' 轮',
                detail: ''
              }),
              h(Stat, {
                label: '最后心跳',
                on: !rt.disconnected,
                unknown: !rt.heartbeatAt,
                value: fmtAge(rt.heartbeatAgeMs),
                detail: rt.heartbeatAt ? fmtTime(rt.heartbeatAt) : '无心跳'
              })
            ),
            companion && companion.supported
              ? h(
                  'p',
                  { style: S.hint },
                  '她今天怎么样：心情 ' +
                    (companion.words ? companion.words.mood : companion.level || '—') +
                    ' · 精力 ' +
                    (companion.words ? companion.words.energy : '—') +
                    ' · 好感 ' +
                    (companion.words ? companion.words.affinity : '—') +
                    (Number.isFinite(companion.streakDays) && companion.streakDays > 0
                      ? ' · 连续陪伴 ' + companion.streakDays + ' 天'
                      : '')
                )
              : null,
            rt.message ? h('p', { style: S.hint }, rt.message) : null,
            rt.supported
              ? null
              : h(
                  'p',
                  { style: S.hint },
                  '服务端状态通道就绪后自动显示：思考中 / 调工具 / 等确认 / 后台运行 / 出错 / 完成 / 空闲 / 失联；30s 无心跳判失联'
                )
          ),

          // ── 运行中的对话（task-46：多工作区 / 同工作区多对话） ──
          h(
            Card,
            {
              title: '运行中的对话',
              right: h(
                'span',
                { style: S.hint },
                sl.othersCount > 0
                  ? '另有 ' +
                      sl.othersCount +
                      ' 个对话在跑' +
                      (sl.backgroundCount > 0 ? ' · 后台 ' + sl.backgroundCount : '')
                  : sl.supported
                    ? '仅当前会话' + (sl.backgroundCount > 0 ? ' · 后台 ' + sl.backgroundCount : '')
                    : '单会话兼容模式'
              )
            },
            sl.supported
              ? null
              : h(
                  'p',
                  { style: S.hint },
                  '多会话字段未就绪：当前按单会话显示（tech-scout task-46 `sessions[]` 上线后自动切换为按工作区分组）'
                ),
            sl.groups.map((group) =>
              h(
                'div',
                { key: 'g-' + group.workspace, style: S.sessionGroup },
                h(
                  'div',
                  { style: S.sessionGroupHead },
                  (group.isCurrentGroup ? '▸ ' : '· ') + group.workspace + '（' + group.sessions.length + ' 个对话）'
                ),
                group.sessions.map((sess, index) =>
                  h(
                    'div',
                    {
                      key: (sess.sessionId || 'session') + '-' + index,
                      style: Object.assign({}, S.sessionRow, sess.isCurrent ? S.sessionRowCurrent : null)
                    },
                    h(
                      'span',
                      {
                        style: Object.assign({}, S.sessionDot, {
                          color: TONE_COLOR[sess.tone] || TONE_COLOR.dim
                        })
                      },
                      '●'
                    ),
                    sess.isCurrent ? h('span', { style: S.sessionBadge }, '跟随中') : null,
                    sess.isBackground ? h('span', { style: S.sessionBadgeBg }, '后台') : null,
                    h('span', { style: S.sessionTitle }, sess.title || '(未命名会话)'),
                    h('span', { style: S.sessionMeta }, sess.label || sess.state),
                    sess.tool ? h('span', { style: S.sessionMeta }, '工具 ' + sess.tool) : null,
                    sess.step != null ? h('span', { style: S.sessionMeta }, 'step ' + sess.step) : null,
                    h(
                      'span',
                      { style: S.sessionMeta },
                      '用户消息 ' + (sess.lastUserMessageAgeMs == null ? '—' : fmtAge(sess.lastUserMessageAgeMs))
                    ),
                    h(
                      'span',
                      { style: S.sessionMeta },
                      sess.lastSeenAgeMs == null ? '最后活动 —' : '最后活动 ' + fmtAge(sess.lastSeenAgeMs)
                    ),
                    sess.sessionId ? h('span', { style: S.sessionId }, String(sess.sessionId).slice(0, 18)) : null
                  )
                )
              )
            )
          ),

          // ── 运行状态 ──
          h(
            Card,
            {
              title: '运行状态',
              right: h('span', { style: S.hint }, '刷新于 ' + fmtTime(state.now))
            },
            h(
              'div',
              { style: S.statusGrid },
              h(Stat, {
                label: 'DSH Host',
                on: host.online,
                value: '在线',
                detail: 'pid ' + host.pid + ' · 面板已运行 ' + host.uptimeSec + 's'
              }),
              h(Stat, {
                label: '桌宠进程',
                on: pet.online,
                unknown: !pet.online && !pet.probeOk,
                value: petLabel,
                detail: petDetail
              }),
              h(Stat, {
                label: '通信管道',
                on: pipe.online,
                value: pipe.online ? '在线' : '离线',
                detail: pipe.name || ''
              })
            ),
            h(
              'div',
              { style: S.row },
              h('span', { style: S.badge }, '以管理界面为准'),
              h('span', { style: S.hint }, '原生设置窗口/右键菜单即将移除，此处为唯一入口'),
              h(
                'span',
                { style: S.hint },
                '版本：面板 v' +
                  (versions.uiPlugin || '?') +
                  (versions.bridgePlugin ? ' · 联动 v' + versions.bridgePlugin : '') +
                  (versions.pet ? ' · 桌宠 ' + versions.pet : '')
              )
            ),
            h(
              'div',
              { style: S.row },
              h(
                'span',
                { style: S.hint },
                '当前模型：' +
                  (config.provider || '?') +
                  ' / ' +
                  (config.model || '?') +
                  (config.llmEnabled ? '' : '（LLM 已关）')
              ),
              h(
                'span',
                { style: S.hint },
                '免打扰：' +
                  (quiet.inQuiet ? '正在生效' : '未生效') +
                  ' · ' +
                  (quiet.ranges.length ? quiet.ranges.join('、') : '未设置')
              )
            ),
            lastAction
              ? h(
                  'p',
                  { style: S.hint },
                  '最近应急动作：' +
                    (ACTION_LABEL[lastAction.name] || lastAction.name || '?') +
                    ' · ' +
                    (lastAction.status || '?') +
                    ' · ' +
                    fmtTime(lastAction.at) +
                    (lastAction.message ? ' · ' + String(lastAction.message).slice(0, 120) : '')
                )
              : null
          ),

          // ── 快捷查看（task-36：对齐旧右键菜单项） ──
          h(
            Card,
            {
              title: '快捷查看',
              right: h('span', { style: S.hint }, '点击即让桌宠响应（管道即时）')
            },
            h(
              'div',
              { style: S.row },
              PET_ACTION_META.map((a) => {
                const ready = a.name === 'quietStart' || a.name === 'quietEnd' ? true : actionReady(a.name)
                return h(
                  'button',
                  {
                    key: a.name,
                    type: 'button',
                    title: a.hint + (ready ? '' : ' · 待服务端支持'),
                    style: Object.assign({}, S.btn, S.btnPrimary, !ready || busyNow ? S.btnDisabled : null),
                    disabled: busyNow || !ready,
                    onClick: () => runPetAction(a.name)
                  },
                  busy === 'pet:' + a.name ? '执行中…' : a.label + (ready ? '' : '（待服务端）')
                )
              })
            ),
            h(
              'p',
              { style: S.hint },
              '余额/天气/在放什么/今日汇总 = 旧右键菜单同名入口；「待服务端」项等 v19 协议（cmd:balance 等）上线后自动启用'
            )
          ),

          // ── 总开关 ──
          h(
            Card,
            {
              title: '联动总开关',
              right: h('span', { style: S.hint }, 'enabled = ' + String(!!form.enabled))
            },
            h(
              'div',
              { style: S.row },
              h(Toggle, {
                value: form.enabled,
                onChange: (v) => touch({ enabled: v }),
                onLabel: '已启用',
                offLabel: '已停用'
              }),
              h(
                'span',
                { style: S.hint },
                form.enabled
                  ? 'DSH 会话事件会驱动桌宠说话/动作'
                  : '联动停用：不再根据会话事件说话/做动作（桌宠进程保留，手动互动仍在）'
              )
            )
          ),

          // ── 活跃度 ──
          h(
            Card,
            {
              title: '活跃度',
              right: h('span', { style: S.hint }, '写 activity.txt · 即时生效（≤20s）')
            },
            h(Segmented, {
              value: form.activity,
              disabled: busyNow,
              options: Object.keys(ACTIVITY_META).map((k) => ({
                value: k,
                label: ACTIVITY_META[k].label
              })),
              onChange: (v) => touch({ activity: v })
            }),
            h('p', { style: S.hint }, (ACTIVITY_META[form.activity] || ACTIVITY_META.normal).desc),
            h(
              'div',
              { style: S.grid2 },
              h(
                'label',
                null,
                h('span', { style: S.label }, '活跃度护栏：每小时动作上限'),
                h('input', {
                  style: S.field,
                  type: 'number',
                  min: 1,
                  max: 600,
                  step: 10,
                  value: form.guardsMax,
                  onChange: (e) => touch({ guardsMax: e.target.value })
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '状态不变时不重复演出'),
                h(Toggle, {
                  value: form.guardsNoRepeat,
                  onChange: (v) => touch({ guardsNoRepeat: v }),
                  disabled: busyNow,
                  onLabel: '开（安静趴着）',
                  offLabel: '关'
                })
              )
            ),
            h(
              'p',
              { style: S.hint },
              '护栏热更新到联动插件（ui-config.guards）：每小时最多 ' +
                (Number(form.guardsMax) || 60) +
                ' 次动作；' +
                (form.guardsNoRepeat ? '同一状态不重复演出。' : '允许同状态重复演出。') +
                '「安静趴着」优先于热闹。'
            )
          ),

          // ── 免打扰 ──
          h(
            Card,
            { title: '免打扰 / 深夜时段' },
            h(
              'label',
              { style: S.block },
              h('span', { style: S.label }, '时段（HH:MM-HH:MM，多个用逗号分隔）'),
              h('input', {
                style: S.field,
                value: form.quietHours,
                placeholder: '23:30-08:00',
                onChange: (e) => touch({ quietHours: e.target.value })
              })
            ),
            h(
              'p',
              { style: S.hint },
              '当前 ' +
                quiet.now +
                ' · ' +
                (quiet.inQuiet ? '在免打扰时段内' : '不在免打扰时段内') +
                ' · 审批等待仍会提醒'
            ),
            h(
              'div',
              { style: S.row },
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () =>
                    runPetAction('quietStart', {
                      minutes: Math.max(1, Number(form.quietMinutes) || 30)
                    })
                },
                busy === 'pet:quietStart' ? '设置中…' : '立即免打扰（' + (Number(form.quietMinutes) || 30) + ' 分钟）'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => runPetAction('quietEnd')
                },
                busy === 'pet:quietEnd' ? '结束中…' : '结束免打扰'
              ),
              h(
                'span',
                { style: S.hint },
                '即时走 cmd:quiet（与旧菜单「免打扰/结束免打扰」一致）；时长用外观区「静默时长」'
              )
            )
          ),

          // ── 专注与静默（task-67 / v47 mode 契约：字段缺失时自动降级为禁用骨架） ──
          h(
            Card,
            {
              title: '专注与静默',
              right: h(
                'span',
                { style: S.hint },
                md.available ? '当前：' + md.label + modeRemain : '待服务端（v47 mode 字段）'
              )
            },
            h(
              'p',
              { style: S.hint },
              '静一静=除 S0（审批/等你选）外全静默；专注=减动作+仅 S0/审批冒泡；下班=停联动（手动互动保留）；恢复=立即回正常。优先级：mode > 免打扰 > 活跃度；到期自动恢复（autoResume）。'
            ),
            h(
              'div',
              { style: S.row },
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow || !modeCaps.silent ? S.btnDisabled : null),
                  disabled: busyNow || !modeCaps.silent,
                  title: modeCaps.silent ? '除 S0 外全静默' : '待服务端',
                  onClick: () => runMode('silent', { minutes: Number(form.modeSilent) || 30 })
                },
                busy === 'mode:silent' ? '切换中…' : '静一静 ' + (Number(form.modeSilent) || 30) + ' 分钟'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow || !modeCaps.focus ? S.btnDisabled : null),
                  disabled: busyNow || !modeCaps.focus,
                  title: modeCaps.focus ? '减动作+仅 S0/审批' : '待服务端',
                  onClick: () => runMode('focus', { minutes: Number(form.modeFocus) || 50 })
                },
                busy === 'mode:focus' ? '切换中…' : '专注 ' + (Number(form.modeFocus) || 50) + ' 分钟'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow || !modeCaps.off ? S.btnDisabled : null),
                  disabled: busyNow || !modeCaps.off,
                  title: modeCaps.off ? '停联动到明早（手动互动保留）' : '待服务端',
                  onClick: () =>
                    runMode('off', modeSettings && modeSettings.offUntil ? { until: modeSettings.offUntil } : {})
                },
                busy === 'mode:off' ? '切换中…' : '下班到明早'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow || !modeCaps.resume ? S.btnDisabled : null),
                  disabled: busyNow || !modeCaps.resume || !md.active,
                  title: md.active ? '立即恢复' : '当前不在任何模式',
                  onClick: () => runMode('resume')
                },
                busy === 'mode:resume' ? '切换中…' : '恢复'
              )
            ),
            h(
              'div',
              { style: S.row },
              h(
                'label',
                { style: { flex: '0 0 170px' } },
                h('span', { style: S.label }, '静一静默认时长（分钟）'),
                h('input', {
                  style: S.field,
                  type: 'number',
                  min: 1,
                  max: 240,
                  value: form.modeSilent,
                  onChange: (e) => touch({ modeSilent: e.target.value })
                })
              ),
              h(
                'label',
                { style: { flex: '0 0 170px' } },
                h('span', { style: S.label }, '专注默认时长（分钟）'),
                h('input', {
                  style: S.field,
                  type: 'number',
                  min: 1,
                  max: 480,
                  value: form.modeFocus,
                  onChange: (e) => touch({ modeFocus: e.target.value })
                })
              ),
              h(
                'label',
                { style: { flex: '0 0 170px' } },
                h('span', { style: S.label }, '下班恢复时间'),
                h('input', {
                  style: S.field,
                  value: '次日 08:00',
                  disabled: true,
                  title: '由联动插件 offUntilHour 决定'
                })
              )
            ),
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: S.block },
                h('span', { style: S.label }, '自动恢复（到点/开机后）'),
                h(Toggle, {
                  value: form.modeAutoResume,
                  onChange: (v) => touch({ modeAutoResume: v }),
                  disabled: busyNow,
                  onLabel: '自动恢复',
                  offLabel: '手动恢复'
                })
              )
            ),
            h(
              'p',
              { style: S.hint },
              '保存设置时写入 ui-config.mode（silentMinutes/focusMinutes/autoResume）；模式切换走 ui-action：mode-silent/mode-focus/mode-off/mode-resume，倒计时读 v2 mode.remainMs/resumeAt。全局快捷键已移除（用户决定）。'
            )
          ),

          // ── 聊天与记忆（task-91 B1 占位；等 CHAT-CONTRACT，不发请求/不写 consent） ──
          h(
            Card,
            {
              title: '聊天与记忆',
              right: h('span', { style: S.hint }, '待服务端（CHAT-CONTRACT）')
            },
            h(
              'p',
              { style: S.hint },
              '聊天默认关闭，开启需显式同意。说明：存储仅本地；生成回复时你的输入与必要的记忆摘要会发送给当前配置的 LLM，不发送 DSH 原文/工具参数/文件/路径/key；高风险敏感信息不会写入记忆。当前为 B1 占位，不发送/不保存任何内容。'
            ),
            h(
              'div',
              { style: S.row },
              h(
                'div',
                null,
                h('span', { style: S.label }, '聊天开关（默认关）'),
                h(Toggle, {
                  value: false,
                  onChange: () => {},
                  disabled: true,
                  onLabel: '开',
                  offLabel: '关'
                })
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, S.btnDisabled),
                  disabled: true,
                  title: '待契约（B2/B3）'
                },
                '查看记忆'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, S.btnDisabled),
                  disabled: true,
                  title: '待契约（B3）'
                },
                '清空聊天记录'
              )
            ),
            h(
              'p',
              { style: S.hint },
              '记忆只存本地、可查可删；契约未到前不显示任何记忆内容；形象位在 29 落盘前仅「待29」占位，不自由发挥。'
            )
          ),

          // ── 每日预算 ──
          h(
            Card,
            {
              title: '每日费用上限',
              right: h('span', { style: S.hint }, 'llm.budgetPerDayYuan')
            },
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: { flex: '0 0 180px' } },
                h(
                  'label',
                  null,
                  h('span', { style: S.label }, '上限（元 / 天）'),
                  h('input', {
                    style: S.field,
                    type: 'number',
                    min: 0,
                    step: 0.1,
                    value: form.budgetPerDayYuan,
                    onChange: (e) => touch({ budgetPerDayYuan: e.target.value })
                  })
                )
              )
            ),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  flex: '1 1 240px'
                }
              },
              h(
                'div',
                { style: S.progressTrack },
                h('div', {
                  style: Object.assign({}, S.progressBar, {
                    width: Math.round(ratio * 100) + '%',
                    background: barColor
                  })
                })
              ),
              h(
                'span',
                { style: S.hint },
                '今日：' +
                  today.calls +
                  ' 次 LLM 调用 · 桌宠说话 ' +
                  fmtMoney((todayStats && todayStats.petLlmCostYuan) || today.cost) +
                  ' / 上限 ' +
                  fmtMoney(budget) +
                  '（' +
                  Math.round(ratio * 100) +
                  '%）'
              ),
              h(
                'span',
                { style: S.hint },
                '三本账（估算）：你 ' +
                  fmtMoney((todayStats && todayStats.costUserYuan) || 0) +
                  ' + 团队 ' +
                  fmtMoney((todayStats && todayStats.costAgentYuan) || 0) +
                  ' + 她说话 ' +
                  fmtMoney((todayStats && todayStats.petLlmCostYuan) || today.cost) +
                  '（预算环只算她说话）' +
                  (todayStats && Number.isFinite(todayStats.riceBowls)
                    ? ' · 今天 ' +
                      todayStats.riceBowls +
                      ' 碗白饭' +
                      (todayStats.period ? '（' + todayStats.period + '）' : '')
                    : '') +
                  (todayStats && Number.isFinite(todayStats.tokens)
                    ? ' · ' + Math.round(todayStats.tokens / 1000) + 'k token'
                    : '')
              ),
              h(
                'div',
                { style: S.row },
                h(
                  'div',
                  null,
                  h('span', { style: S.label }, '主页默认显示费用估算'),
                  h(Toggle, {
                    value: showCostDefault,
                    onChange: setShowCostPref,
                    disabled: false,
                    onLabel: '展开费用（估算可能偏高）',
                    offLabel: '默认折叠（推荐）'
                  })
                )
              ),
              h(
                'p',
                { style: S.hint },
                (todayStats && todayStats.cacheSavedYuan != null
                  ? '费用已含 cache 分价（较旧算法节省 ' +
                    fmtMoney(todayStats.cacheSavedYuan) +
                    '）；仍为估算。白饭/token/峰谷更稳定。'
                  : '费用为估算（cache 未单独计价，偏高）；白饭/token/峰谷更稳定。') +
                  '开关写入本机 localStorage，主页「今日数据」立即生效。'
              )
            ),
            h('p', { style: S.hint }, '达到上限后联动插件停用 LLM，回退台词池')
          ),

          // ── 桌宠外观 ──
          h(
            Card,
            {
              title: '桌宠外观',
              right: h('span', { style: S.hint }, '大小/透明度即时生效')
            },
            h(
              'div',
              { style: S.block },
              h(
                'div',
                { style: S.row },
                h('span', { style: S.label }, '大小'),
                h('span', { style: S.sliderVal }, form.size.toFixed(2) + '×'),
                SIZE_PRESETS.map((p) =>
                  h(
                    'button',
                    {
                      key: p.label,
                      type: 'button',
                      style: Object.assign({}, S.chip, Math.abs(form.size - p.value) < 0.01 ? S.chipActive : null),
                      disabled: busyNow,
                      onClick: () => touch({ size: p.value })
                    },
                    p.label
                  )
                )
              ),
              h(
                'div',
                { style: S.sliderRow },
                h('input', {
                  style: S.slider,
                  type: 'range',
                  min: 18,
                  max: 100,
                  step: 1,
                  value: sizePct,
                  disabled: busyNow,
                  onChange: (e) => touch({ size: Number(e.target.value) / 100 })
                }),
                h('span', { style: S.sliderVal }, pct(form.size))
              )
            ),
            h(
              'div',
              { style: S.block },
              h(
                'div',
                { style: S.row },
                h('span', { style: S.label }, '透明度'),
                h('span', { style: S.sliderVal }, pct(form.opacity))
              ),
              h(
                'div',
                { style: S.sliderRow },
                h('input', {
                  style: S.slider,
                  type: 'range',
                  min: 20,
                  max: 100,
                  step: 5,
                  value: opacityPct,
                  disabled: busyNow,
                  onChange: (e) => touch({ opacity: Number(e.target.value) / 100 })
                }),
                h('span', { style: S.sliderVal }, opacityPct + '%')
              )
            ),
            h(
              'div',
              { style: S.grid2 },
              h(
                'div',
                null,
                h('span', { style: S.label }, '模式'),
                h(Segmented, {
                  value: form.mode,
                  options: MODE_META,
                  disabled: busyNow,
                  onChange: (v) => touch({ mode: v })
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '鼠标穿透'),
                h(Toggle, {
                  value: form.passthrough,
                  onChange: (v) => touch({ passthrough: v }),
                  disabled: busyNow,
                  onLabel: '穿透（点击穿过桌宠）',
                  offLabel: '不穿透'
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '锁定位置'),
                h(Toggle, {
                  value: form.locked,
                  onChange: (v) => touch({ locked: v }),
                  disabled: busyNow,
                  onLabel: '已锁定（不可拖动）',
                  offLabel: '可拖动'
                })
              )
            ),
            h(
              'div',
              { style: S.grid2 },
              h(
                'div',
                null,
                h('span', { style: S.label }, '置顶'),
                h(Toggle, {
                  value: form.topmost,
                  onChange: (v) => touch({ topmost: v }),
                  disabled: busyNow,
                  onLabel: '置顶显示',
                  offLabel: '不置顶'
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '贴边吸附'),
                h(Toggle, {
                  value: form.snap,
                  onChange: (v) => touch({ snap: v }),
                  disabled: busyNow,
                  onLabel: '开',
                  offLabel: '关'
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '层级'),
                h(Segmented, {
                  value: form.layer,
                  options: LAYER_META,
                  disabled: busyNow,
                  onChange: (v) => touch({ layer: v })
                })
              ),
              h(
                'label',
                null,
                h('span', { style: S.label }, '皮肤（当前形象）'),
                h(
                  'select',
                  {
                    style: Object.assign({}, S.field, { colorScheme: 'dark' }),
                    value: form.skin,
                    disabled: busyNow,
                    onChange: (e) => touch({ skin: e.target.value })
                  },
                  (petOptions && petOptions.skins && petOptions.skins.length ? petOptions.skins : ['大肥鱼'])
                    .concat(
                      form.skin && !((petOptions && petOptions.skins) || []).includes(form.skin) ? [form.skin] : []
                    )
                    .map((s) =>
                      h(
                        'option',
                        {
                          key: s,
                          value: s,
                          style: {
                            backgroundColor: '#1f1f1f',
                            color: '#f5f5f5'
                          }
                        },
                        s
                      )
                    )
                )
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '开机自启' + (actionReady('autoStart') ? '' : '（待服务端）')),
                h(Toggle, {
                  value: form.autoStart,
                  onChange: (v) => touch({ autoStart: v }),
                  disabled: busyNow,
                  onLabel: '开',
                  offLabel: '关'
                })
              ),
              h('span', { style: S.hint }, '音效：已关闭（用户决定，不可调）。'),
              h(
                'label',
                null,
                h('span', { style: S.label }, '静音时长（分钟，0=不停）'),
                h('input', {
                  style: S.field,
                  type: 'number',
                  min: 0,
                  max: 240,
                  step: 5,
                  value: form.quietMinutes,
                  onChange: (e) => touch({ quietMinutes: e.target.value })
                })
              )
            )
          ),

          // ── 外观与渲染（task-62/3D：render.mode 2D/3D 占位，字段未到前禁用） ──
          h(
            Card,
            {
              title: '外观与渲染',
              right: h('span', { style: S.hint }, '待服务端（render.mode）')
            },
            // task-107 B4：形象位（本地镜像头像；未装资产时 img onerror 降级为 29 色板）
            h(
              'div',
              { style: S.row },
              h('span', { style: S.label }, '形象'),
              h(
                'span',
                {
                  style: {
                    position: 'relative',
                    display: 'inline-flex',
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#fff',
                    background: 'linear-gradient(135deg,#31366D 0%,#5060A3 55%,#789BD5 100%)'
                  }
                },
                h('span', null, '29'),
                h('img', {
                  src: CHANNEL + '/asset/portrait.png',
                  alt: '大肥鱼头像（二头身蓝紫长发鲸鱼娘）',
                  width: 64,
                  height: 64,
                  loading: 'lazy',
                  referrerPolicy: 'no-referrer',
                  style: {
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  },
                  onError: (e) => {
                    e.currentTarget.style.display = 'none'
                  }
                })
              )
            ),
            h(
              'p',
              { style: S.hint },
              '角色素材：YunYueSama · github.com/YunYueSama/codex-deepseek-pet · 大肥鱼项目署名许可 1.0 · 已裁剪/筛选/降采样（未重绘）· 非官方（DeepSeek 未推出/未认领任何拟人吉祥物）'
            ),
            h(
              'div',
              { style: S.row },
              h('span', { style: S.label }, '渲染模式'),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.chip, S.chipActive),
                  disabled: true,
                  title: '当前默认 2D；3D 原型验证中'
                },
                '2D（默认）'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.chip, S.btnDisabled),
                  disabled: true,
                  title: '待 render.mode 字段（bridge-dev/3d-dev）'
                },
                '3D（实验）'
              )
            ),
            h(
              'p',
              { style: S.hint },
              '3D 原型验证中：形象基准为 29 角色圣经（二头身蓝紫长发鲸鱼娘；社区二创风格的原创 3D 形象，不称官方鲸鱼娘）；默认 1080p 可见身高 184px（size=0.54）。等 render.mode 接入后可切换 2D/3D，失败自动回 2D，不影响桌宠与联动。当前固定 2D。'
            )
          ),

          // ── 语录与气泡 ──
          h(
            Card,
            {
              title: '语录与气泡',
              right: h('span', { style: S.hint }, '语录频率即时生效')
            },
            h(
              'div',
              { style: S.grid2 },
              h(
                'div',
                null,
                h('span', { style: S.label }, '语录频率（闲着时自己冒话的频率）'),
                h(Segmented, {
                  value: form.lineFreq,
                  options: LINE_FREQ_META,
                  disabled: busyNow,
                  onChange: (v) => touch({ lineFreq: v })
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '气泡风格'),
                h(Segmented, {
                  value: form.bubbleStyle,
                  options: BUBBLE_STYLE_META,
                  disabled: busyNow,
                  onChange: (v) => touch({ bubbleStyle: v })
                })
              )
            ),
            h(
              'div',
              { style: S.grid2 },
              h(
                'label',
                null,
                h('span', { style: S.label }, '气泡停留时长（秒，普通气泡）'),
                h('input', {
                  style: S.field,
                  type: 'number',
                  min: 1,
                  max: 30,
                  step: 1,
                  value: form.bubbleSec,
                  onChange: (e) => touch({ bubbleSec: e.target.value })
                })
              ),
              h(
                'label',
                null,
                h('span', { style: S.label }, '城市（天气/报账气泡）'),
                h('input', {
                  style: S.field,
                  value: form.city,
                  placeholder: '如：汕头',
                  maxLength: 20,
                  onChange: (e) => touch({ city: e.target.value })
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '音乐联动（读 Windows 媒体会话，歌词上气泡）'),
                h(Toggle, {
                  value: form.musicLink,
                  onChange: (v) => touch({ musicLink: v }),
                  disabled: busyNow,
                  onLabel: '开',
                  offLabel: '关'
                })
              ),
              h(
                'div',
                null,
                h('span', { style: S.label }, '音效'),
                h('span', { style: S.hint }, '已移除（用户决定，不可调）')
              ),
              h(
                'label',
                null,
                h('span', { style: S.label }, '双击行为' + (actionReady('doubleClick') ? '' : '（待服务端 v19）')),
                h(
                  'select',
                  {
                    style: Object.assign({}, S.field, { colorScheme: 'dark' }),
                    value: form.doubleClick,
                    disabled: busyNow,
                    onChange: (e) => touch({ doubleClick: e.target.value })
                  },
                  DOUBLE_CLICK_META.map((m) =>
                    h(
                      'option',
                      {
                        key: m.value,
                        value: m.value,
                        style: { backgroundColor: '#1f1f1f', color: '#f5f5f5' }
                      },
                      m.label
                    )
                  )
                )
              )
            ),
            bubble && Number.isFinite(bubble.normalMs)
              ? h(
                  'p',
                  { style: S.hint },
                  '生效气泡节奏：普通 ' +
                    bubble.normalMs / 1000 +
                    's · 内心 ' +
                    (bubble.innerMs || 0) / 1000 +
                    's · 报账 ' +
                    (bubble.reportMs || 0) / 1000 +
                    's · 审批 ' +
                    (bubble.approvalMs || 0) / 1000 +
                    's · 深夜 ' +
                    (bubble.nightMs || 0) / 1000 +
                    's'
                )
              : null,
            h(
              'p',
              { style: S.hint },
              '语录频率/气泡风格/音乐/音效/城市经 cmd:config 即时下发；气泡停留时长 → 联动插件气泡节奏（≤20s 应用）'
            )
          ),

          // ── 最近 say ──
          h(
            Card,
            {
              title: '最近 say 记录',
              right: h('span', { style: S.hint }, '最近 ' + (recentSay || []).length + ' 条')
            },
            sayNewestFirst.length === 0
              ? h('p', { style: S.hint }, '暂无记录（日志里还没有 say 行）')
              : h(
                  'ul',
                  { style: S.list },
                  sayNewestFirst.map((item, i) =>
                    h(
                      'li',
                      { key: (item.at || '') + '-' + i, style: S.listItem },
                      h('span', { style: S.listTime }, fmtTime(item.at)),
                      h('span', { style: S.listKind }, KIND_LABEL[item.kind] || item.kind || '—'),
                      h('span', { style: S.listText }, item.line || '—')
                    )
                  )
                )
          ),

          // ── 日志 ──
          h(
            Card,
            {
              title: '运行日志',
              right: h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busy === 'logs' ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: loadLogs
                },
                busy === 'logs' ? '读取中…' : logs ? '收起' : '查看最近 80 条'
              )
            },
            logs
              ? h(
                  'div',
                  {
                    style: { display: 'flex', flexDirection: 'column', gap: 6 }
                  },
                  h('pre', { style: S.pre }, (logs.lines || []).join('\n')),
                  h('p', { style: S.mono }, logs.file)
                )
              : h('p', { style: S.hint }, '只读 pet-bridge 联动日志尾部；日志可能含桌宠台词，不含用户对话原文')
          ),

          // ── 应急控制 ──
          h(
            Card,
            {
              title: '应急控制',
              right: h('span', { style: S.badgeWarn }, '高风险操作')
            },
            h(
              'div',
              { style: S.row },
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => requestAction('restart-pet')
                },
                busy === 'action:restart-pet' ? '请求中…' : '重启桌宠'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, S.btnDanger, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: stopLinkage
                },
                '停止联动'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, S.btnDanger, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: resetDefaults
                },
                busy === 'reset' ? '重置中…' : '恢复默认配置'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => setShowRollback(!showRollback)
                },
                showRollback ? '收起回滚指引' : '回滚指引'
              )
            ),
            h(
              'div',
              { style: S.row },
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busy === 'nativeui' ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => nativeUi(true)
                },
                '应急：显示原生菜单'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busy === 'nativeui' ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => nativeUi(false)
                },
                '隐藏原生菜单'
              ),
              h(
                'button',
                {
                  type: 'button',
                  title: actionReady('quit') ? '退出桌宠进程（联动/面板保留）' : '待服务端支持 cmd:quit',
                  style: Object.assign({}, S.btn, S.btnDanger, !actionReady('quit') || busyNow ? S.btnDisabled : null),
                  disabled: busyNow || !actionReady('quit'),
                  onClick: () => {
                    const ok =
                      typeof window !== 'undefined' && typeof window.confirm === 'function'
                        ? window.confirm(
                            '退出桌宠进程？\n「停止联动」只是不再驱动桌宠，桌宠仍会留在屏幕上；「退出桌宠」才会真正关闭它。'
                          )
                        : true
                    if (ok) requestAction('quit-pet')
                  }
                },
                '退出桌宠' + (actionReady('quit') ? '' : '（待服务端）')
              ),
              h('span', { style: S.hint }, '「停止联动」= 不再根据会话驱动；「退出桌宠」= 关掉桌宠进程')
            ),
            h(
              'p',
              { style: S.hint },
              '重启桌宠走 ui-action.json（联动插件消费，≤20s）；停止联动=总开关关闭；恢复默认会重置本面板全部配置'
            ),
            showRollback
              ? h(
                  'div',
                  {
                    style: { display: 'flex', flexDirection: 'column', gap: 6 }
                  },
                  h('p', { style: S.warn }, '回滚设置面板（不影响桌宠/联动插件）：'),
                  h(
                    'pre',
                    { style: S.pre },
                    'powershell -NoProfile -ExecutionPolicy Bypass -File "E:\\project\\AI提效\\tool\\pet-integration-src\\pet-work\\plugin-ui\\dsh-pet-bridge-ui\\scripts\\rollback.ps1"\n\n# 预览（零写入）\n... -File "...\\rollback.ps1" -DryRun'
                  ),
                  h('p', { style: S.mono }, '说明文档：dsh-pet-bridge-ui\\README.md（安装/接线/回滚/接口契约）')
                )
              : null
          ),

          // ── 兼容性与能力（task-67：让用户看到联动到了哪些能力；未知统一「未启用/未安装」） ──
          h(
            Card,
            {
              title: '兼容性与能力',
              right: h('span', { style: S.hint }, '已联动能力 / 降级状态一览')
            },
            h(
              'div',
              { style: S.statusGrid },
              h(Stat, {
                label: '版本',
                on: true,
                value: '面板 ' + ((versions && versions.uiPlugin) || '—'),
                detail:
                  '联动 ' +
                  ((versions && versions.bridgePlugin) || '—') +
                  ' · 桌宠 ' +
                  ((versions && versions.pet) || '—')
              }),
              h(Stat, {
                label: '状态通道',
                on: Boolean(runtime && runtime.supported),
                unknown: !(runtime && runtime.supported),
                value: runtime && runtime.supported ? '已联通' : '未就绪',
                detail: rt.disconnected ? '失联（>30s 无心跳）' : '心跳正常'
              }),
              h(Stat, {
                label: '状态文件',
                on: true,
                value: files && files.stateSource === 'v2' ? 'v2 真源' : 'legacy 兜底',
                detail: files && files.stateSource === 'v2' ? 'bridge-state-v2.json' : 'state.json'
              }),
              h(Stat, {
                label: '多会话',
                on: Boolean(sessionList && sessionList.supported),
                unknown: !(sessionList && sessionList.supported),
                value: sessionList && sessionList.supported ? sessionList.total + ' 个会话' : '单会话兼容',
                detail:
                  sessionList && sessionList.supported
                    ? '真人 ' + sessionList.userActiveCount + ' · 后台 ' + sessionList.backgroundCount
                    : ''
              }),
              h(Stat, {
                label: '事件时间线',
                on: Boolean(events && events.supported),
                unknown: !(events && events.supported),
                value: events && events.supported ? events.total + ' 条记录' : '未就绪',
                detail: events && events.unread ? '未读 ' + events.unread : '无未读'
              }),
              h(Stat, {
                label: '她的心情',
                on: Boolean(companion && companion.supported),
                unknown: !(companion && companion.supported),
                value:
                  companion && companion.supported
                    ? companion.words
                      ? companion.words.mood
                      : companion.level || '已启用'
                    : '未就绪',
                detail:
                  companion && companion.supported
                    ? '精力 ' +
                      (companion.words ? companion.words.energy : '—') +
                      ' · 好感 ' +
                      (companion.words ? companion.words.affinity : '—')
                    : ''
              }),
              h(Stat, {
                label: '团队 / 计划',
                on: Boolean(teamFeatures && (teamFeatures.status === 'ok' || teamFeatures.status === 'empty')),
                unknown: !teamFeatures || teamFeatures.status === 'unsupported',
                value:
                  teamFeatures && teamFeatures.status === 'ok'
                    ? (teamFeatures.team.members.total || 0) +
                      ' 人 · 任务 ' +
                      (teamFeatures.team.tasks.completed || 0) +
                      '/' +
                      (teamFeatures.team.tasks.total || 0)
                    : teamFeatures && teamFeatures.status === 'empty'
                      ? '暂无团队/任务'
                      : teamFeatures && teamFeatures.status === 'degraded'
                        ? '数据异常（降级）'
                        : '未启用（DSH 未装载 Agent Teams）',
                detail:
                  teamFeatures && teamFeatures.source ? '数据源 ' + teamFeatures.source : '等待 v2 字段 / 能力探测'
              }),
              h(Stat, {
                label: '互动',
                on: Boolean(capabilities && capabilities.interactions && capabilities.interactions.head),
                unknown: !(capabilities && capabilities.interactions),
                value:
                  capabilities && capabilities.interactions
                    ? [
                        capabilities.interactions.head ? '摸头' : null,
                        capabilities.interactions.feed ? '喂食' : null,
                        capabilities.interactions.come ? '叫她' : null
                      ]
                        .filter(Boolean)
                        .join(' / ') || '未就绪'
                    : '未就绪',
                detail: '互动经节流；失败看最近动作'
              }),
              h(Stat, {
                label: '活跃度护栏',
                on: true,
                value: (state.guards && state.guards.maxActionsPerHour) || 60,
                detail:
                  '每小时动作上限 · ' +
                  (state.guards && state.guards.noActionOnSameState === false ? '同状态可重复' : '同状态不重复')
              }),
              h(Stat, {
                label: '宿主内存',
                on: Boolean(hostMemory && hostMemory.lowFootprint !== false),
                unknown: !hostMemory,
                value: hostMemory ? hostMemory.rssMB + ' MB' : '未知',
                detail: hostMemory
                  ? 'heap ' +
                    hostMemory.heapMB +
                    'MB · timers ' +
                    hostMemory.timers +
                    (hostMemory.lowFootprint ? ' · 低占用中' : ' · 高于阈值 ' + hostMemory.thresholdRssMB + 'MB')
                  : '等待 v2 hostMemory'
              })
            ),
            hostMemory && (modeCaps.off || modeCaps.resume)
              ? h(
                  'div',
                  { style: S.row },
                  h('span', { style: S.hint }, '宿主内存偏高时可一键降载：'),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: Object.assign({}, S.btn, busyNow || !modeCaps.off ? S.btnDisabled : null),
                      disabled: busyNow || !modeCaps.off,
                      onClick: () => runMode('off', {})
                    },
                    busy === 'mode:off' ? '降载中…' : '下班降载（停自动联动）'
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: Object.assign({}, S.btn, busyNow || !modeCaps.resume || !md.active ? S.btnDisabled : null),
                      disabled: busyNow || !modeCaps.resume || !md.active,
                      onClick: () => runMode('resume')
                    },
                    busy === 'mode:resume' ? '恢复中…' : '恢复联动'
                  )
                )
              : null,
            h(
              'p',
              { style: S.hint },
              '能力探测（DSH 插件/技能/MCP/jobs/计划/上下文）待 task-66 能力地图接入；未知能力统一显示「未启用/未安装」，不谎报连接状态。'
            )
          ),

          // ── Phase-2 能力卡（骨架：字段未到前只显示「待服务端」，不猜数据） ──
          h(
            Card,
            {
              title: 'Phase-2 能力（骨架）',
              right: h('span', { style: S.hint }, '静态骨架 · 字段到位后变活')
            },
            h(
              'div',
              { style: S.statusGrid },
              h(Stat, {
                label: '模型 / 渠道',
                on: Boolean(config && (config.provider || config.model)),
                unknown: !(config && (config.provider || config.model)),
                value:
                  config && (config.provider || config.model)
                    ? (config.provider || '?') + ' / ' + (config.model || '?')
                    : '待服务端',
                detail: '面板配置（非会话实时；会话模型待 v2）'
              }),
              h(Stat, { label: '技能', unknown: true, value: '待服务端', detail: 'skills.list + 最近使用计数' }),
              h(Stat, {
                label: 'MCP 服务器',
                unknown: true,
                value: '待服务端（推断 inferred）',
                detail: '工具名 mcp__<server>__* 推断，非官方状态 API'
              }),
              h(Stat, { label: 'Jobs / 定时', unknown: true, value: '待服务端', detail: 'job/schedule 标量计数' }),
              h(Stat, {
                label: '上下文压力',
                unknown: true,
                value: '待服务端',
                detail: 'contextPressure/contextBreakdown'
              }),
              h(Stat, {
                label: '编排（Workflow / Ralph / Subagent）',
                unknown: true,
                value: '待服务端',
                detail: '阶段/轮次/父子计数'
              })
            ),
            h(
              'p',
              { style: S.hint },
              '按 19 v4 §8 IA + 22 能力矩阵预留：只显示计数/枚举/状态，绝不读内容；未接入统一「待服务端」，不谎报连接状态。'
            )
          ),

          // ── DSH 能力地图（简版，静态矩阵；22 §2.2；待 task-66 数据接入后变活） ──
          h(
            Card,
            {
              title: 'DSH 能力地图（简版）',
              right: h('span', { style: S.hint }, '静态矩阵 · 22 §2.2；「已联动」为实时探测')
            },
            h(
              'p',
              { style: S.hint },
              '已联动（实时）：' +
                [
                  runtime && runtime.supported ? '状态通道' : null,
                  sessionList && sessionList.supported ? '多会话' : null,
                  events && events.supported ? '事件时间线' : null,
                  companion && companion.supported ? '情绪' : null,
                  teamFeatures && teamFeatures.status !== 'unsupported' ? '团队/计划' : null,
                  mode && mode.available ? '控制模式' : null,
                  hostMemory ? '宿主内存' : null,
                  todayStats && todayStats.cacheSavedYuan != null ? '费用 cache 分项' : null,
                  capabilities && capabilities.interactions && capabilities.interactions.head ? '互动' : null,
                  files && files.stateSource === 'v2' ? 'v2 状态文件' : null,
                  '主页',
                  'overlay 徽标'
                ]
                  .filter(Boolean)
                  .join(' · ')
            ),
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: S.block },
                h('span', { style: S.label }, '✅ 默认可用（base + web-app，同事默认也有）'),
                h(
                  'p',
                  { style: S.hint },
                  '会话/事件/投影/标题/token/统计/工作区/命令/slots/HTTP 路由 · Goals/Plan/Todo/Skills/Subagents/Jobs/Compaction/Session query · Schedule · Workflow（工具+运行视图）· MCP 框架（默认无服务器配置）'
                )
              ),
              h(
                'div',
                { style: S.block },
                h('span', { style: S.label }, '🧩 需 profile bundle（本机已启用）'),
                h(
                  'p',
                  { style: S.hint },
                  'Agent Teams + 任务板 · Ralph · Terminal 增强（terminal_*）· Session search · Session titles 增量 · Git worktree · 翻译/auto-review/inspector/plugin market · 子代理 CLI（codex/claude）'
                )
              ),
              h(
                'div',
                { style: S.block },
                h('span', { style: S.label }, '⚠️ 需 profile bundle（本机未启用，同事可能也没有）'),
                h(
                  'p',
                  { style: S.hint },
                  'Voice 输入 · Badge skill（未安装）· 同事缺 bundle 时：团队显示「未启用团队」、无 ralph/terminal/search 活动，不报错'
                )
              ),
              h(
                'div',
                { style: S.block },
                h('span', { style: S.label }, '🔌 第三方扩展（本机已装）'),
                h(
                  'p',
                  { style: S.hint },
                  'MCP 服务器（codegraph/context7/idea/chrome-devtools/datagrip）· memory_manager（仅计数）· IM 渠道'
                )
              ),
              h(
                'div',
                { style: S.block },
                h('span', { style: S.label }, '🚫 不可用 / 不显示'),
                h(
                  'p',
                  { style: S.hint },
                  'intel-status（未激活）· Web 内置桌宠（不做）· 语音/ASR/TTS、hooks、OTel/analytics 展示 · 全局快捷键、音效/音量（用户决定，已移除）'
                )
              )
            ),
            h(
              'p',
              { style: S.hint },
              '探测规则（22 §2.3）：服务用 ctx.get/inject 探测、投影 key 缺失=未装载、工具名探测 MCP/terminal/worktree；缺失统一「未启用」，绝不抛错。数据接入后本卡按 v2/fallback/empty 规则变活。'
            )
          ),

          // ── 测试 ──
          h(
            Card,
            { title: '测试（on-demand）' },
            h(
              'div',
              { style: S.row },
              h('input', {
                style: Object.assign({}, S.field, {
                  flex: '1 1 220px',
                  width: 'auto'
                }),
                value: testLine,
                placeholder: '自定义台词（可空，默认：测试一下：我在这儿呢。）',
                maxLength: 60,
                onChange: (e) => setTestLine(e.target.value)
              }),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, S.btnPrimary, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => runTest('say')
                },
                testBusy('say') ? '发送中…' : '说一句'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => runTest('jump')
                },
                testBusy('jump') ? '发送中…' : '跳一下'
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, S.btn, busyNow ? S.btnDisabled : null),
                  disabled: busyNow,
                  onClick: () => runTest('screenshot')
                },
                testBusy('screenshot') ? '抓屏中…' : '截图'
              )
            ),
            shot
              ? h(
                  'div',
                  {
                    style: { display: 'flex', flexDirection: 'column', gap: 6 }
                  },
                  h('img', {
                    style: S.img,
                    src: shot.dataUrl,
                    alt: '桌面截图'
                  }),
                  h('p', { style: S.mono }, '截图文件：' + shot.file)
                )
              : h('p', { style: S.hint }, '说一句/跳一下走命名管道协议；截图抓当前桌面（仅本次点击，不写日志）')
          ),

          // ── 底部 ──
          h(
            'div',
            {
              style: {
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap'
              }
            },
            h(
              'button',
              {
                type: 'button',
                style: Object.assign({}, S.btn, S.btnPrimary, busyNow ? S.btnDisabled : null),
                disabled: busyNow,
                onClick: save
              },
              busy === 'save' ? '保存中…' : '保存设置'
            ),
            h(
              'button',
              {
                type: 'button',
                style: Object.assign({}, S.btn, busyNow ? S.btnDisabled : null),
                disabled: busyNow,
                onClick: () => refresh(true)
              },
              busy === 'load' ? '刷新中…' : '刷新状态'
            ),
            h(
              'span',
              { style: S.hint },
              '面板每 ' + REFRESH_MS / 1000 + 's 自动刷新 · 配置写入 ui-config.json（联动插件 watcher 应用）'
            )
          ),

          h(
            'p',
            { style: S.mono },
            'log: ' +
              String(files.logFile || '')
                .split(/[\\/]/)
                .pop() +
              ' · ui-config: ' +
              String(files.uiConfigFile || '')
                .split(/[\\/]/)
                .pop()
          )
        )
      }

      return Panel
    }

    /**
     * 侧栏底部入口（task-51：`sidebar.footer.action`，加性安全槽）——打开大肥鱼主页。
     * task-67：叠加状态点（运行中/等你选/空闲）与「等你选」角标，20s 轮询、hidden 暂停、失败静默。
     * @returns {any} React 元素
     */
    function FooterAction() {
      const [dot, setDot] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const data = await call('state.get')
            if (!alive) return
            const rt = data.runtime || {}
            const stateClass = String(rt.stateClass || '').toLowerCase()
            const tone = rt.disconnected
              ? TONE_COLOR.err
              : stateClass === 'waiting'
                ? TONE_COLOR.warn
                : stateClass === 'error'
                  ? TONE_COLOR.err
                  : stateClass === 'running' || stateClass === 'busy'
                    ? TONE_COLOR.busy
                    : TONE_COLOR.ok
            const waiting = (data.events && data.events.s0Unread) || 0
            setDot({ color: tone, label: rt.label || '空闲', waiting })
          } catch {
            /* 离线静默 */
          }
        }
        load()
        const timer = setInterval(() => {
          if (!document.hidden) load()
        }, 20000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      return h(
        'button',
        {
          type: 'button',
          title: dot ? '大肥鱼：' + dot.label + (dot.waiting ? ' · 等你选 ' + dot.waiting : '') : '打开大肥鱼主页',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
            opacity: 0.8
          },
          onClick: () => {
            try {
              if (typeof window !== 'undefined' && typeof window.open === 'function') {
                window.open('/pet-bridge-ui/home', '_blank', 'noopener')
              }
            } catch {
              /* ignore */
            }
          }
        },
        h(
          'span',
          {
            style: {
              width: 7,
              height: 7,
              borderRadius: '50%',
              display: 'inline-block',
              background: dot ? dot.color : 'transparent',
              border: dot ? 'none' : '1px solid currentColor'
            }
          },
          ''
        ),
        h('span', null, '🐋'),
        h('span', null, '大肥鱼'),
        dot && dot.waiting
          ? h(
              'span',
              {
                style: {
                  marginLeft: 'auto',
                  fontSize: 10,
                  color: TONE_COLOR.warn,
                  border: '1px solid rgba(210,153,34,.5)',
                  borderRadius: 999,
                  padding: '0 6px'
                }
              },
              '等你选 ' + dot.waiting
            )
          : null
      )
    }

    /**
     * task-58：`shell.overlay` 团队徽标（加性安全槽；帧级浮层，click-through 层上的小胶囊）。
     * 仅团队/任务/等你选存在时显示；点击打开大肥鱼主页；15s 轮询、hidden 暂停。
     * @returns {any} React 元素或 null
     */
    function OverlayBadge() {
      const [features, setFeatures] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const data = await call('state.get')
            if (alive) {
              const features = data.teamFeatures || null
              // P0/M3：S0 未读（等你确认）并入徽标红点
              if (features) features.eventsS0Unread = (data.events && data.events.s0Unread) || 0
              setFeatures(features)
            }
          } catch {
            /* 离线静默 */
          }
        }
        load()
        const timer = setInterval(() => {
          if (!document.hidden) load()
        }, 15000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      const tf = features
      // 渲染容错：不同 DSH 版本 slot 上下文差异不应炸页面（失败→静默不显示）
      try {
        if (!tf || (tf.status !== 'ok' && tf.status !== 'empty')) return null
        const members = (tf.team && tf.team.members) || {}
        const tasks = (tf.team && tf.team.tasks) || {}
        const questions = tf.userQuestions || {}
        const waiting = Math.max(Number(questions.active) || 0, Number(tf.eventsS0Unread) || 0)
        const total = Number(tasks.total) || 0
        if (Number(members.total) <= 1 && total === 0 && waiting === 0) return null
        const label =
          waiting > 0
            ? '等你选 ' + waiting
            : total > 0
              ? '任务 ' + (Number(tasks.completed) || 0) + '/' + total
              : '团队 ' + (Number(members.total) || 0)
        return h(
          'div',
          {
            title: '大肥鱼 · 打开主页',
            onClick: openHome,
            style: {
              position: 'fixed',
              right: 14,
              bottom: 14,
              zIndex: 2147483000,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(24,26,31,.88)',
              color: '#e7e8ea',
              border: '1px solid rgba(110,168,255,.45)',
              boxShadow: '0 2px 10px rgba(0,0,0,.35)',
              fontSize: 12,
              cursor: 'pointer',
              pointerEvents: 'auto',
              userSelect: 'none'
            }
          },
          h('span', null, '🐋'),
          h('span', null, label),
          waiting > 0
            ? h('span', {
                style: {
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#e5534b',
                  display: 'inline-block'
                }
              })
            : null
        )
      } catch {
        return null
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'pet-bridge-ui',
              order: 72,
              label: '大肥鱼联动'
            },
            makeSection()
          )
        )
        // task-51：侧栏底部入口（加性安全槽；DSH 页面常驻可打开主页）
        try {
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              {
                name: 'sidebar.footer.action',
                id: 'pet-bridge-ui-home',
                order: 80
              },
              FooterAction
            )
          )
        } catch {
          /* 旧版 DSH 无该槽时静默降级（设置页入口仍在） */
        }
        // task-58：帧级团队徽标（shell.overlay，加性安全槽；无团队数据时不渲染）
        try {
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              {
                name: 'shell.overlay',
                id: 'pet-bridge-ui-badge',
                order: 200
              },
              OverlayBadge
            )
          )
        } catch {
          /* 旧版 DSH 无 shell.overlay 时静默降级 */
        }
      }
    }
  }
})
