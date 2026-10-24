/**
 * task-91 B1：聊天页壳（`/pet-bridge-ui/chat`）—— 自包含 HTML，**纯结构 / 空态 / pending**。
 *
 * B1 边界（reviewer 条件）：
 * - **不固化端点名**：本页不发任何 chat/memory 请求（传输层待 CHAT-CONTRACT），只渲染壳与状态；
 * - **不伪造**：不显示假聊天/假记忆、不自造台词、不写盘、不调 LLM；
 * - **同意卡**：契约/后端未到 → 仅「mock 预览」展示，**不写 consent/enabled**（按钮禁用）；
 * - 29 已落盘 → 形象位引用 29（**仅文字/色板，不画脸、不搬素材**）；表情名按 29 §7；
 * - 隐私：不展示 DSH 原文/路径；DOM 0 绝对路径；仅本地占位说明。
 */

/** 聊天页静态文案（后续按 30 §4.5 边界话术与 ux 定稿校对）。 */
const CHAT_TEXTS = {
  title: '大肥鱼 · 聊天',
  avatarPlaceholder: '29',
  avatarNote: '二头身蓝紫长发鲸鱼娘（29 §0/§6）· 社区二创风格的原创 3D 形象（不称官方鲸鱼娘）',
  expressionNote: '状态表情按 29 §7：听（idle 微笑）· 想（思考）· 说（开心）',
  paletteNote: '配色按 29 §5：发 #5060A3 · 裙 #2D366A · 围裙 #F7F8FC · 品牌蓝 #4D6BFE · 金 #B08D5E',
  sizeNote: '默认尺寸：1080p 可见身高 184px（size=0.54，窗口约 248×270 DIP）',
  pendingTitle: '聊天待服务端开启',
  pendingHint: '契约（CHAT-CONTRACT）与后端就绪后开放；当前仅结构预览，不会发送/保存任何内容。',
  emptyTitle: '还没聊过，点下面说点什么吧。',
  inputPlaceholder: '说点什么…（待服务端）',
  consentTitle: '首次开启需了解',
  consentItems: [
    '存储仅本地（history/memory 文件，与 companion 同目录）；可随时关闭、清空、删除记忆。',
    '生成回复时，你的输入文本与选中的必要记忆摘要会发送给当前配置的 LLM provider（与 DSH 既有边界一致）；不发送 DSH 原文/工具参数/文件/路径/key。',
    '高风险敏感信息不会写入记忆（服务端过滤）；可随时关闭聊天，不惩罚。'
  ],
  consentCheck: '我已了解',
  consentEnable: '同意并开启（mock 预览，不可用）',
  consentCancel: '取消',
  boundaryFooter:
    '她是屏幕另一端的鲸鱼娘朋友，不是真人/不是工具；不做医疗/法律/投资结论，不做心理诊断；遇到困难时也建议和可信的人或专业人士聊聊。',
  memoryTitle: '记忆',
  memoryEmpty: '还没有记忆',
  memoryHint: '契约未到：查看/删除/忘掉/清空待 CHAT-CONTRACT（B2/B3）。',
  quietLabel: '静音 / 不打扰',
  quietHint: '由服务端/pet 判定，面板只显示状态；B3 接线。',
  quotaHint: '今日额度/成本提示（B4 接入后显示）'
}

/** 组装聊天页 HTML（自包含；无外部 CDN/构建；B1 不发任何数据请求）。 */
export function renderChatHtml() {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>大肥鱼 · 聊天</title>',
    '<style>',
    ':root{color-scheme:dark light;--bg:#17181b;--panel:#1d1f24;--line:#2c2f36;--fg:#e7e8ea;--muted:#9aa0a6;--accent:#6ea8ff;--line-soft:rgba(128,128,128,.22)}',
    '@media (prefers-color-scheme:light){:root{--bg:#f7f8fa;--panel:#fff;--line:#e3e6ea;--fg:#1f2328;--muted:#6b7280;--accent:#2563eb;--line-soft:rgba(0,0,0,.10)}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}',
    '.wrap{max-width:860px;margin:0 auto;padding:18px 18px 120px}',
    '.head{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);flex-wrap:wrap}',
    '.avatar{width:44px;height:44px;border-radius:50%;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;flex:0 0 auto;background:linear-gradient(135deg,#31366D 0%,#5060A3 55%,#789BD5 100%)}',
    '.who{display:flex;flex-direction:column;min-width:0}.who .name{font-weight:700;font-size:15px}',
    '.who .sub{font-size:11px;color:var(--muted)}.spacer{flex:1 1 20px}',
    '.dot{width:7px;height:7px;border-radius:50%;background:#d29922;display:inline-block;margin-right:5px;vertical-align:middle}',
    '.badge{font-size:10px;border:1px solid var(--line);border-radius:999px;padding:1px 7px;color:var(--muted)}',
    '.btn{background:transparent;color:inherit;border:1px solid var(--line);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer}',
    '.btn:hover{border-color:var(--accent)}.btn.primary{border-color:var(--accent);color:var(--accent)}',
    '.btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-top:12px}',
    '.stream{min-height:230px;max-height:46vh;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px}',
    '.state{margin:auto;text-align:center;color:var(--muted);font-size:12px;line-height:1.8}',
    '.state b{color:var(--fg);display:block;font-size:13px;margin-bottom:4px}',
    '.consent{border:1px solid rgba(210,153,34,.5);border-radius:10px;margin-top:12px;padding:12px;background:rgba(210,153,34,.08)}',
    '.consent h3{margin:0 0 8px;font-size:13px}.consent ul{margin:0 0 10px;padding-left:18px;color:var(--muted);font-size:12px}',
    '.consent li{margin-bottom:5px}.consent .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}',
    '.inputbar{position:sticky;bottom:0;background:var(--panel);border-top:1px solid var(--line);padding:10px 12px;display:flex;gap:8px}',
    '.inputbar input{flex:1 1 auto;min-width:0;background:transparent;color:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;outline:none}',
    '.foot{color:var(--muted);font-size:10px;margin-top:14px;line-height:1.7}',
    '.notes{margin-top:8px;color:var(--muted);font-size:11px;line-height:1.8}',
    '.notes p{margin:0}',
    '.mem{margin-top:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px}',
    '.mem h3{margin:0 0 6px;font-size:12px;color:var(--muted)}.mem .empty{color:var(--muted);font-size:12px;margin:0 0 8px}',
    '.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    '  <div class="head">',
    '    <div class="avatar">' + CHAT_TEXTS.avatarPlaceholder + '</div>',
    '    <div class="who">',
    '      <div class="name">🐋 ' + CHAT_TEXTS.title + '</div>',
    '      <div class="sub">' + CHAT_TEXTS.avatarNote + '</div>',
    '    </div>',
    '    <div class="spacer"></div>',
    '    <span class="badge"><span class="dot"></span>待服务端</span>',
    '    <button class="btn" id="btnMem" disabled title="待 CHAT-CONTRACT（B2）">记忆</button>',
    '    <button class="btn" id="btnQuiet" disabled title="待 CHAT-CONTRACT（B3）">静音</button>',
    '  </div>',
    '  <div class="notes">',
    '    <p>' + CHAT_TEXTS.expressionNote + '</p>',
    '    <p>' + CHAT_TEXTS.paletteNote + '</p>',
    '    <p>' + CHAT_TEXTS.sizeNote + '</p>',
    '  </div>',
    '  <div class="card"><div class="stream" id="stream">',
    '    <div class="state"><b>' +
      CHAT_TEXTS.pendingTitle +
      '</b>' +
      CHAT_TEXTS.pendingHint +
      '<br><span style="font-size:11px">聊天内容将在这里显示（当前不发送/不保存）</span></div>',
    '  </div></div>',
    '  <div class="consent" id="consent">',
    '    <h3>' + CHAT_TEXTS.consentTitle + '（mock 预览 · 契约未到）</h3>',
    '    <ul>' + CHAT_TEXTS.consentItems.map((item) => '<li>' + item + '</li>').join('') + '</ul>',
    '    <div class="row">',
    '      <label class="check"><input type="checkbox" id="agree" disabled> ' + CHAT_TEXTS.consentCheck + '</label>',
    '      <button class="btn primary" id="btnEnable" disabled title="契约/后端未到，不会写入 consent/enabled">' +
      CHAT_TEXTS.consentEnable +
      '</button>',
    '      <button class="btn" id="btnCancel" disabled>' + CHAT_TEXTS.consentCancel + '</button>',
    '      <span class="badge">默认关闭 · 仅用户主动</span>',
    '    </div>',
    '  </div>',
    '  <div class="mem" id="memory">',
    '    <h3>' + CHAT_TEXTS.memoryTitle + '</h3>',
    '    <p class="empty">' + CHAT_TEXTS.memoryEmpty + '</p>',
    '    <p class="empty" style="font-size:11px">' + CHAT_TEXTS.memoryHint + '</p>',
    '  </div>',
    '  <div class="mem" id="quiet">',
    '    <h3>' + CHAT_TEXTS.quietLabel + '</h3>',
    '    <p class="empty">' + CHAT_TEXTS.quietHint + '</p>',
    '  </div>',
    '  <div class="card inputbar"><input id="input" placeholder="' +
      CHAT_TEXTS.inputPlaceholder +
      '" disabled><button class="btn primary" id="btnSend" disabled>发送</button></div>',
    '  <p class="foot">' +
      CHAT_TEXTS.boundaryFooter +
      '<br><span id="quota">' +
      CHAT_TEXTS.quotaHint +
      '</span> · 静音/不打扰由服务端/pet 判定</p>',
    '</div>',
    '<script>',
    '(function(){',
    '  "use strict";',
    '  // B1：纯壳。不发端点（不固化端点名），不写 consent/enabled，不伪造聊天/记忆。',
    '  var MOCK = true;',
    '  window.__CHAT_B1__ = { mock: MOCK, endpoints: "待 CHAT-CONTRACT" };',
    '  document.getElementById("btnEnable").addEventListener("click", function(){ /* mock：禁止写入 */ });',
    '  document.getElementById("btnCancel").addEventListener("click", function(){ /* mock：仅关闭占位 */ var c = document.getElementById("consent"); if (c) c.style.display = "none"; });',
    '  document.getElementById("agree").addEventListener("change", function(){ /* mock：不改状态 */ });',
    '})();',
    '</script>',
    '</body>',
    '</html>'
  ].join('\n')
}

export { CHAT_TEXTS }
