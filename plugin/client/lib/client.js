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
      { value: 'follow', label: '跟随' },
      { value: 'still', label: '原地' }
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
            volume: 0.9,
            quietMinutes: '30',
            bubbleSec: '5',
            city: '',
            musicLink: true,
            soundOn: true,
            doubleClick: 'balance',
            autoStart: false
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
            volume: typeof pet.volume === 'number' ? pet.volume : 0.9,
            quietMinutes: String(typeof pet.quietMinutes === 'number' ? pet.quietMinutes : 30),
            bubbleSec: String(typeof pet.bubbleMs === 'number' ? Math.round(pet.bubbleMs / 1000) : 5),
            city: typeof pet.city === 'string' ? pet.city : '',
            musicLink: typeof pet.musicLink === 'boolean' ? pet.musicLink : true,
            soundOn: typeof pet.soundOn === 'boolean' ? pet.soundOn : true,
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
                  : false
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
                volume: Number(form.volume),
                quietMinutes: Number(form.quietMinutes),
                bubbleMs: Math.max(1000, Math.min(30000, Math.round(Number(form.bubbleSec) * 1000))),
                city: form.city,
                musicLink: form.musicLink,
                soundOn: form.soundOn,
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
                  '恢复面板默认配置？\n将重置：总开关=开、活跃度=正常、免打扰=23:30-08:00、预算=¥1.0、\n大小=特小0.36×、透明度=100%、模式=散步、语录频率=正常、气泡=5s、\n置顶/贴边=开、层级=置顶、气泡风格=自动、皮肤=大肥鱼、音效=开、音量=90%、\n音乐联动=开、城市=汕头、静音=30min、双击=看余额、自启=关、穿透/锁定=关。'
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
          sessionList
        } = state
        const rt = runtime || {
          supported: false,
          state: 'idle',
          label: '未知',
          tone: 'dim',
          disconnected: true,
          staleAfterMs: 30000
        }
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
            h('p', { style: S.hint }, 'DSH × 大肥鱼桌宠 · 唯一控制台（状态 / 基础设置 / 应急 / 日志 / 测试）')
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
                label: 'Step / Turn',
                on: !rt.disconnected,
                value: (rt.step == null ? '—' : rt.step) + ' / ' + (rt.turn == null ? '—' : rt.turn),
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
                  ? '另有 ' + sl.othersCount + ' 个对话在跑'
                  : sl.supported
                    ? '仅当前会话'
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
                    h(
                      'span',
                      { style: S.sessionMeta },
                      sess.lastSeenAgeMs == null ? '无活动时间' : '最后活动 ' + fmtAge(sess.lastSeenAgeMs)
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
            h('p', { style: S.hint }, (ACTIVITY_META[form.activity] || ACTIVITY_META.normal).desc)
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
                  ' 次 LLM 调用 · ' +
                  fmtMoney(today.cost) +
                  ' / 上限 ' +
                  fmtMoney(budget) +
                  '（' +
                  Math.round(ratio * 100) +
                  '%）'
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
              h(
                'div',
                null,
                h('span', { style: S.label }, '音量'),
                h(
                  'div',
                  { style: S.sliderRow },
                  h('input', {
                    style: S.slider,
                    type: 'range',
                    min: 0,
                    max: 100,
                    step: 5,
                    value: Math.round(form.volume * 100),
                    disabled: busyNow,
                    onChange: (e) => touch({ volume: Number(e.target.value) / 100 })
                  }),
                  h('span', { style: S.sliderVal }, Math.round(form.volume * 100) + '%')
                )
              ),
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
                h(Toggle, {
                  value: form.soundOn,
                  onChange: (v) => touch({ soundOn: v }),
                  disabled: busyNow,
                  onLabel: '开',
                  offLabel: '关'
                })
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

          h('p', { style: S.mono }, 'log: ' + (files.logFile || '') + ' · ui-config: ' + (files.uiConfigFile || ''))
        )
      }

      return Panel
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
      }
    }
  }
})
