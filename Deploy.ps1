# Deploy.ps1 — 一鍵部署到 GitHub Pages
#
# 流程:
#   1. 跑 Build-Bundle.ps1 重新打包 data/ (掃 Assets/Settings/Localization +
#      Scenes/Scene_WalkThrough,寫 manifest.json)
#   2. 把整個 yarn-preview/ 內容鏡像到 deploy 資料夾(預設 D:\Repos\yarn-preview)
#   3. 在 deploy 資料夾 git add / commit / push
#
# 第一次跑前要先:
#   - 在 github.com 建好 yarn-preview repo
#   - 在 deploy 資料夾跑過 git init / git remote add origin / git push -u origin main
#     (詳見 yarn-preview/README.md 的部署章節)
#
# 用法:
#   .\Deploy.ps1
#   .\Deploy.ps1 -DeployDir "C:\path\to\local\repo" -Message "更新第三日對話"

param(
    [string]$DeployDir = "D:\Repos\yarn-preview",
    [string]$Message   = ""
)

$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
if (-not $source) { $source = (Get-Location).Path }

if (-not (Test-Path $DeployDir)) {
    Write-Error "找不到 deploy 資料夾: $DeployDir`n第一次部署要先 git init 過,看 README。"
    exit 1
}
if (-not (Test-Path (Join-Path $DeployDir '.git'))) {
    Write-Error "$DeployDir 不是 git 資料夾。先在那邊跑 git init / git remote add origin。"
    exit 1
}

# Step 1: 重新 build data/
Write-Host "=== 1/3  重新打包 data/ ===" -ForegroundColor Cyan
$buildScript = Join-Path $source 'Build-Bundle.ps1'
$src = [IO.File]::ReadAllText($buildScript, [Text.Encoding]::UTF8)
$sb  = [scriptblock]::Create($src)
Push-Location $source
try { & $sb } finally { Pop-Location }

# Step 2: 鏡像 source → DeployDir(保留 .git)
Write-Host ""
Write-Host "=== 2/3  同步到 $DeployDir ===" -ForegroundColor Cyan

# 用 robocopy /MIR 但排除 .git。若沒裝 robocopy 退回逐項複製。
$rc = Get-Command robocopy -ErrorAction SilentlyContinue
if ($rc) {
    & robocopy $source $DeployDir /MIR /XD .git /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Warning "robocopy 回傳 $LASTEXITCODE,有錯誤"
    }
} else {
    # fallback
    Get-ChildItem -Path $DeployDir -Exclude '.git' -Force | Remove-Item -Recurse -Force
    Copy-Item -Path "$source\*" -Destination $DeployDir -Recurse -Force
}

# Step 3: git push
Write-Host ""
Write-Host "=== 3/3  git commit + push ===" -ForegroundColor Cyan
Push-Location $DeployDir
try {
    git add -A
    $diff = git diff --cached --stat
    if (-not $diff) {
        Write-Host "沒有變動,跳過 commit。" -ForegroundColor Yellow
    } else {
        if (-not $Message) {
            $Message = "Update " + (Get-Date -Format "yyyy-MM-dd HH:mm")
        }
        git commit -m $Message
        git push
        Write-Host ""
        Write-Host "推完了。1-2 分鐘後 GitHub Pages 會自動更新。" -ForegroundColor Green
    }
} finally {
    Pop-Location
}
