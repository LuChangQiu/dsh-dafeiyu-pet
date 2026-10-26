# 提交前门禁：preflight-check.ps1
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\preflight-check.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\preflight-check.ps1 -Patch "C:\...\cordis.patch.yml" -PetWorkDir "E:\...\pet-work"
# 说明：只读检查，不修改任何文件。任何 FAIL → 退出码 1，禁止部署/reload。
param(
  [string]$Patch = "C:\Users\xiqi\.dsh\profiles\web\cordis.patch.yml",
  [string]$PetWorkDir = "E:\project\AI提效\tool\pet-integration-src\pet-work"
)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$script:results = @()

function Invoke-Step {
  param([string]$Name, [scriptblock]$Block)
  Write-Host ""
  Write-Host ("=== {0} ===" -f $Name)
  & $Block
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }
  $script:results += [pscustomobject]@{ Name = $Name; Ok = ($code -eq 0); Code = $code }
}

Write-Host ("preflight @ {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host ("repo: {0}" -f $root)

# 1) profile patch：YAML/重复 key/两个插件块命中/TEST HOOK 生产禁用
Invoke-Step "validate-profile (YAML + 插件块命中 + 生产禁 TEST HOOK)" {
  & node scripts/validate-profile.mjs --patch $Patch
}

# 2) JS 语法
Invoke-Step "node --check (repo JS)" {
  & node scripts/lint.mjs
}

# 3) Prettier 格式
Invoke-Step "prettier --check" {
  & npx prettier --check "plugin/**/*.js" "scripts/**/*.mjs"
}

# 4) ruff（可选；未安装则 SKIP 不判失败）
$ruff = $null
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) { & python -m ruff --version *> $null; if ($LASTEXITCODE -eq 0) { $ruff = $py.Source } }
if ($ruff) {
  Invoke-Step "ruff (pet)" { & python -m ruff check pet --config ruff.toml }
} else {
  Write-Host ""
  Write-Host "=== ruff (pet) === SKIP (ruff 未安装)"
}

# 5) 隐私抽检（运行数据目录存在时）
if (Test-Path $PetWorkDir) {
  Invoke-Step "privacy audit (pet-work)" { & node scripts/audit-privacy.mjs --dir $PetWorkDir }
} else {
  Write-Host ""
  Write-Host "=== privacy audit === SKIP (指定目录不存在)"
}

# 6) 关键单测
Invoke-Step "unit: tool-types" { & node scripts/test-tool-types.mjs }
Invoke-Step "unit: pricing" { & node scripts/test-pricing.mjs }
Invoke-Step "unit: mode" { & node scripts/test-mode.mjs }
Invoke-Step "unit: privacy" { & node scripts/test-privacy.mjs }
Invoke-Step "unit: team-view" { & node scripts/test-team-view.mjs }
Invoke-Step "unit: text-fmt" { & node scripts/test-text-fmt.mjs }
Invoke-Step "unit: detached harness" { & node scripts/harness/plugin-harness.mjs }


# 6b) CF1：鲸鱼娘 act 接线（插件导入 + 白名单双文件 + 纯函数 fixtures；失败给可读原因，不静默跳过）
Invoke-Step "unit: whale-wiring" {
  & node scripts/test-plugin-imports.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: test-plugin-imports（插件模块导出/导入不一致）"; return }
  & node scripts/gen-act-fx-whitelist.mjs --check
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: act-fx whitelist drift（跑 node scripts/gen-act-fx-whitelist.mjs）"; return }
  & node --test plugin/server/test/whale-acts.test.mjs plugin/server/test/cf1-wiring-contract.test.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: whale-acts/CF1 wiring fixtures（unit，<5s）"; return }
}

# 6g) task-133：LLM 全事件化（helpers 单测 + mock ctx.llm 集成；<5s）
Invoke-Step "unit: llm-lines" {
  & node plugin/server/test/llm-lines.test.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: llm-lines（kind→池/夜间/回退原因/统计/接线契约）"; return }
  & node plugin/server/test/speech-requests.test.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: speech-requests（队列映射/上下文白名单/去重）"; return }
  & node plugin/server/test/action-director.test.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: action-director（JSON 解析/白名单/边界/兜底/perf payload）"; return }
  & node plugin/server/test/llm-lines-mock.test.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: llm-lines mock（成功/回退/点击互动/被夸/文件队列）"; return }
}

# 7) git 状态（信息项，不判失败）
Write-Host ""
Write-Host "=== git status（信息项，未提交改动需说明） ==="
& git log --oneline -1
& git status --porcelain

# 汇总
Write-Host ""
Write-Host "=== preflight summary ==="
$failed = @($script:results | Where-Object { -not $_.Ok })
foreach ($r in $script:results) {
  if ($r.Ok) { Write-Host ("PASS  {0}" -f $r.Name) } else { Write-Host ("FAIL  {0} (exit {1})" -f $r.Name, $r.Code) }
}
if ($failed.Count -gt 0) {
  Write-Host ("RESULT: FAIL ({0}/{1})" -f $failed.Count, $script:results.Count)
  exit 1
}
Write-Host ("RESULT: PASS ({0}/{1})" -f $script:results.Count, $script:results.Count)
exit 0
