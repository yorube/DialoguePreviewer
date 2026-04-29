# Build-Bundle.ps1
# 把 per-locale .json 檔複製到 yarn-preview/data/，並產生 manifest.json，
# 之後翻譯人員打開 index.html 就會自動載入。
#
# 用法（從 Tools/yarn-preview/ 執行）：
#   .\Build-Bundle.ps1
#
# 自動掃 SourceDir 底下所有 yarn_*.json 並按下列規則分群：
#   yarn_xxx(en-US).json       → locale = en-US
#   yarn_xxx(es-ES).json       → locale = es-ES
#   yarn_xxx(ru-RU).json       → locale = ru-RU
#   yarn_xxx(zh-CN).json       → locale = zh-CN
#   yarn_xxx.json (無 locale)  → locale = zh-TW（中文源檔）
#
# 群組 base 名稱會自動把 trailing （231226）這類 timestamp 拿掉，讓
#   yarn_工廠_第三日（231226）(en-US).json 和
#   yarn_工廠_第三日.json
#   分到同一個 base = yarn_工廠_第三日。

param(
    [string[]]$SourceDir = @(
        "..\..\Assets\Settings\Localization\En-It",
        "..\..\Assets\Settings\Localization\En-Ru",
        "..\..\Assets\Scenes\Scene_WalkThrough"
    ),
    [string]$OutDir = ".\data"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}
$OutDir = (Resolve-Path $OutDir).Path

# 清空 data/，避免舊檔殘留
Get-ChildItem -Path $OutDir -File | Where-Object { $_.Extension -eq '.json' } | Remove-Item -Force

# 帶 locale: yarn_xxx(en-US).json
$patternWithLocale = '^(.+?)\(([A-Za-z]{2}-[A-Za-z]{2})\)\.json$'
# 不帶 locale: yarn_xxx.json
$patternBare = '^(yarn_.+?|.+?)\.json$'

function Get-CanonicalBase {
    param([string]$base)
    # 把 trailing 全形括號數字 timestamp 拿掉，例如 （231226）/ （240512）
    return ($base -replace '（\d+）\s*$', '').Trim()
}

# Sanitize a node body before bundling.
#
# 變數紀錄 node:
#   砍掉「全部 //...」開頭的註解行（包含 //public 變數宣告 + 純 // 註解）。
#   runtime 之後讀不到預設值，靠 lazy-init 為 0/false/""。對翻譯預覽夠用，
#   但能徹底隱藏內部變數命名和開發者備註。
#
# 其他 node:
#   只裁掉「行內 ` // ...` 雙重註解」的尾巴(rare),其餘照舊。
function Sanitize-NodeBody {
    param([string]$body, [string]$title)
    if ([string]::IsNullOrEmpty($body)) { return $body }

    if ($title -eq '變數紀錄') {
        $bodyLines = $body -split "`n"
        $kept = @()
        foreach ($line in $bodyLines) {
            $stripped = $line -replace '^\s+', ''
            if ($stripped.StartsWith('//')) { continue }
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $kept += $line
        }
        return ($kept -join "`n")
    }

    $bodyLines = $body -split "`n"
    for ($i = 0; $i -lt $bodyLines.Count; $i++) {
        $line = $bodyLines[$i]
        if ($line -match '^(\s*\/\/[^\r\n]*?)\s{2,}\/\/.*$') {
            $bodyLines[$i] = $Matches[1].TrimEnd()
        }
    }
    return ($bodyLines -join "`n")
}

# Read a JSON file, strip dev-only trailing-//-comments from every node body,
# write to dest as compact UTF-8 (no BOM).
function Copy-AndSanitize {
    param([string]$srcPath, [string]$destPath)
    $raw = [IO.File]::ReadAllText($srcPath, [Text.UTF8Encoding]::new($false))
    try {
        $json = $raw | ConvertFrom-Json
    } catch {
        # 解析失敗 → 退回到直接 byte 複製，免得把好檔搞壞
        Write-Warning ("解析 {0} 失敗，直接 byte 複製: {1}" -f (Split-Path $srcPath -Leaf), $_.Exception.Message)
        Copy-Item -Path $srcPath -Destination $destPath -Force
        return
    }
    if ($json -isnot [System.Array]) {
        Copy-Item -Path $srcPath -Destination $destPath -Force
        return
    }
    foreach ($node in $json) {
        if ($null -ne $node.body) {
            $node.body = Sanitize-NodeBody -body $node.body -title $node.title
        }
    }
    $out = $json | ConvertTo-Json -Depth 32 -Compress
    [IO.File]::WriteAllText($destPath, $out, [Text.UTF8Encoding]::new($false))
}

# scripts: canonical-base -> @{ locales = @{ locale -> destFilename } }
$scripts = @{}

foreach ($dir in $SourceDir) {
    if (-not (Test-Path $dir)) {
        Write-Warning "找不到來源目錄: $dir (跳過)"
        continue
    }
    $absDir = (Resolve-Path $dir).Path
    Write-Host "掃描: $absDir" -ForegroundColor Cyan

    Get-ChildItem -Path $absDir -File -Filter '*.json' -Recurse | ForEach-Object {
        $name = $_.Name
        # 排除附屬檔
        if ($name -like '*.meta') { return }
        if ($name -match '_localization' -or $name -match '_SO\b' -or $name -match 'translation_pure') { return }
        # Backup naming: yarn_xxx(locale)_N.json / _O.json / _BAK.json — skip
        if ($name -match '\([A-Za-z]{2}-[A-Za-z]{2}\)_[A-Za-z]+\.json$') { return }
        # 只要 yarn_ 開頭的，避開無關的設定檔
        if (-not ($name -match '^yarn_' -or $name -match '工廠第一日')) { return }

        $base = $null; $locale = $null
        if ($name -match $patternWithLocale) {
            $base   = $Matches[1]
            $locale = $Matches[2]
        } elseif ($name -match $patternBare) {
            $base   = $Matches[1]
            $locale = 'zh-TW'   # 中文源檔
        } else {
            return
        }

        $canon = Get-CanonicalBase $base
        if (-not $canon) { return }

        # 衝突：同 canonical-base + 同 locale 已經有檔了 → 略過後者（保留先掃到的）
        if ($scripts.ContainsKey($canon) -and $scripts[$canon].locales.ContainsKey($locale)) {
            return
        }

        # 複製 + 移除開發者註解，輸出 compact UTF-8 (no BOM)
        $destPath = Join-Path $OutDir $name
        Copy-AndSanitize -srcPath $_.FullName -destPath $destPath

        if (-not $scripts.ContainsKey($canon)) {
            $scripts[$canon] = @{ locales = @{} }
        }
        $scripts[$canon].locales[$locale] = $name
    }
}

# 組 manifest
$manifest = @{
    generatedAt = (Get-Date).ToString('o')
    scripts     = @()
}

foreach ($base in ($scripts.Keys | Sort-Object)) {
    $entry = [ordered]@{
        name    = $base
        locales = [ordered]@{}
    }
    foreach ($loc in ($scripts[$base].locales.Keys | Sort-Object)) {
        $entry.locales[$loc] = $scripts[$base].locales[$loc]
    }
    $manifest.scripts += $entry
}

$manifestJson = $manifest | ConvertTo-Json -Depth 6
$manifestPath = Join-Path $OutDir 'manifest.json'
[IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))

# --- speaker → gender map -----------------------------------------------
# 從翻譯對照表 xlsx 的 sheet6 (角色) 抽出 Gender 欄,各 locale 名字 → M/F/N
function Build-SpeakerGenderMap {
    param([string]$XlsxPath, [string]$OutPath)
    if (-not (Test-Path $XlsxPath)) {
        Write-Warning "找不到 xlsx: $XlsxPath (跳過 speakers.json)"
        return 0
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [IO.Compression.ZipFile]::OpenRead($XlsxPath)
    try {
        $ssEntry = $zip.Entries | Where-Object FullName -eq 'xl/sharedStrings.xml'
        if (-not $ssEntry) { return 0 }
        $ssXml = [xml]([IO.StreamReader]::new($ssEntry.Open()).ReadToEnd())
        $ns = New-Object Xml.XmlNamespaceManager($ssXml.NameTable)
        $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
        $strings = @()
        foreach ($si in $ssXml.SelectNodes('//x:si', $ns)) {
            $strings += -join ($si.SelectNodes('.//x:t', $ns) | ForEach-Object { $_.InnerText })
        }
        # sheet6 == 角色 (per .asset ordering) — 確認時會用 header 'Gender' 雙重檢查
        $sheetEntry = $zip.Entries | Where-Object FullName -eq 'xl/worksheets/sheet6.xml'
        if (-not $sheetEntry) { return 0 }
        $sx = [xml]([IO.StreamReader]::new($sheetEntry.Open()).ReadToEnd())
        $rows = $sx.SelectNodes('//x:row', $ns)
        if (-not $rows -or $rows.Count -lt 4) { return 0 }

        $localeCols = @('B','C','D','E','F','G','H','I','J')
        $genderMap = [ordered]@{}

        foreach ($row in $rows) {
            $cells = @{}
            foreach ($c in $row.SelectNodes('x:c', $ns)) {
                $v = $c.SelectSingleNode('x:v', $ns)
                if (-not $v) { continue }
                $col = ($c.GetAttribute('r') -replace '\d', '')
                if ($c.GetAttribute('t') -eq 's') {
                    $cells[$col] = $strings[[int]$v.InnerText]
                } else {
                    $cells[$col] = $v.InnerText
                }
            }
            $gender = $cells['A']
            if (-not $gender) { continue }
            if ($gender -notin 'M', 'F', 'N') { continue }
            foreach ($col in $localeCols) {
                $name = $cells[$col]
                if ($name -and -not $name.StartsWith('//') -and -not $genderMap.Contains($name)) {
                    $genderMap[$name] = $gender
                }
            }
        }
        $json = $genderMap | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($OutPath, $json, [Text.UTF8Encoding]::new($false))
        return $genderMap.Count
    } finally {
        $zip.Dispose()
    }
}

$xlsxPath = (Resolve-Path "..\..\Assets\Settings\Game 遊戲設定\翻譯對照表.xlsx" -ErrorAction SilentlyContinue)
if ($xlsxPath) {
    $speakerOut = Join-Path $OutDir 'speakers.json'
    $count = Build-SpeakerGenderMap -XlsxPath $xlsxPath.Path -OutPath $speakerOut
    Write-Host ("speakers.json: " + $count + " 條對應 → " + $speakerOut)
}

Write-Host ""
Write-Host "完成：" -ForegroundColor Green
Write-Host "  共 $($scripts.Count) 部劇本"
foreach ($base in ($scripts.Keys | Sort-Object)) {
    $locs = ($scripts[$base].locales.Keys | Sort-Object) -join ', '
    Write-Host "  - $base  ($locs)"
}
Write-Host ""
Write-Host "manifest 寫到: $manifestPath"
