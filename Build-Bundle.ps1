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
# guids: destFilename -> guid (從 .meta 取出，給翻譯工具算 UID 用)
$guids = [ordered]@{}

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

        # 抽 .meta 的 guid（給翻譯工具算 UID = guid + nodeIdx + lineIdx 用）
        # 注意：v2 LocKit 的 UID 是基於這個 source .meta 的 guid，所以同名 json 在不同
        # 資料夾會有不同 guid。先掃到的優先 = LocKit 對齊。
        $metaPath = "$($_.FullName).meta"
        if (Test-Path $metaPath) {
            $metaText = [IO.File]::ReadAllText($metaPath, [Text.Encoding]::UTF8)
            if ($metaText -match '(?m)^guid:\s*([0-9a-f]+)') {
                $guids[$name] = $Matches[1]
            }
        }
    }
}

# --- 新語言 stub 生成 ---
# 對於還沒開工翻譯的目標語言（例如 fr-FR 第一次加），預覽站需要 dropdown 內出現它，
# 不然譯者連選都選不到。這裡對每個 script 補上缺少的 locale stub：
#   - 用 en-US 的 JSON 直接複製一份，命名成 `xxx(target).json`
#   - guids.json 也指向同一個 en-US guid（UID 才會跟 LocKit CSV 對得上）
# 之後譯者開 Edit Mode 自己翻或上傳填好的 CSV 都會蓋掉這個 stub 的英文顯示。
# 真實 JSON 之後從 v2 Batch Process 產出來放回 Settings/Localization/En-It/，下次跑
# 這個 script 時 first-wins 會選真實 JSON，stub 自動退場。
$ensureTargetLocales = @('en-US', 'es-ES', 'it-IT', 'ja-JP', 'ru-RU', 'fr-FR', 'zh-CN', 'zh-TW')

$stubCount = 0
foreach ($canon in @($scripts.Keys)) {
    $sc = $scripts[$canon]
    $enUSName = $sc.locales['en-US']
    if (-not $enUSName) { continue }                              # 沒英文 source 就沒辦法 stub
    $enUSPath = Join-Path $OutDir $enUSName

    foreach ($loc in $ensureTargetLocales) {
        if ($sc.locales.ContainsKey($loc)) { continue }           # 已有真實 JSON
        $stubName = $enUSName -replace '\(en-US\)', "($loc)"
        if ($stubName -eq $enUSName) { continue }                 # 安全網：替換沒成功就跳過
        $stubPath = Join-Path $OutDir $stubName
        if (Test-Path $stubPath) { continue }                     # 已經被別的 source 寫進來
        if (-not (Test-Path $enUSPath)) { continue }
        Copy-Item -Path $enUSPath -Destination $stubPath -Force
        $sc.locales[$loc] = $stubName
        if ($guids.Contains($enUSName)) {
            # 用 en-US source 的 guid（UID = guid + nodeIdx + lineIdx，要對齊 LocKit CSV）
            $guids[$stubName] = $guids[$enUSName]
        }
        $stubCount++
    }
}
if ($stubCount -gt 0) {
    Write-Host ("產出 stub 數: " + $stubCount + " (新語言可預覽 + 站內編輯)") -ForegroundColor DarkYellow
}

# 故事順序排序：每個 script 名稱 → 排序 key。
# 主線(教學 → 第一日 → ... → 第五日 → 結局)在前,
# 跨天通用對話(工廠支線/路人/街景)在後。
# 之後加新檔案 → 第六日之類 → 通用公式自動把它擺進對應位置;
# 完全不認識的檔案會被丟到最尾巴(100000),不會打亂已知檔案的順序。
function Get-StoryOrderKey {
    param([string]$name)

    # Cross-day 通用對話 → 排到最後
    if ($name -match '工廠.*支線對話')   { return 10000 }
    if ($name -match '工廠.*路人對話')   { return 10001 }
    if ($name -match '街景.*路人對話')   { return 10002 }
    if ($name -match '街景對話$')        { return 10003 }

    # 教學
    if ($name -match '教學關')           { return 10 }

    # 結局(異常後日談排在後日談後面)
    if ($name -match '異常後日談')       { return 9001 }
    if ($name -match '後日談')           { return 9000 }

    # 第一日(結構特殊:只有主角家 + 工廠第一日,沒有回家)
    if ($name -match '^yarn_主角家$')    { return 100 }
    if ($name -match '工廠第一日')       { return 110 }

    # 第五日(目前只有單一檔)
    if ($name -match '第五日')           { return 500 }

    # 通用：第N日 + 階段(主角家+街景=morning, 工廠=work, 回家=return)
    $chDigits = @{ '一'=1; '二'=2; '三'=3; '四'=4; '五'=5; '六'=6; '七'=7; '八'=8; '九'=9; '十'=10 }
    if ($name -match '第([一二三四五六七八九十])日') {
        $dayCh = $Matches[1]
        if ($chDigits.Contains($dayCh)) {
            $dayNum = [int]$chDigits[$dayCh]
            $base = $dayNum * 100
            if ($name -match '^yarn_主角家') { return $base + 0  }
            if ($name -match '^yarn_工廠')   { return $base + 10 }
            if ($name -match '^yarn_回家')   { return $base + 20 }
            return $base + 50  # 第N日但階段不明
        }
    }

    # 完全不認識 → 推到最尾巴
    return 100000
}

# 組 manifest
$manifest = @{
    generatedAt = (Get-Date).ToString('o')
    scripts     = @()
}

foreach ($base in ($scripts.Keys | Sort-Object { Get-StoryOrderKey $_ }, { $_ })) {
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

# 寫 guids.json (filename → guid)
$guidsPath = Join-Path $OutDir 'guids.json'
[IO.File]::WriteAllText($guidsPath, ($guids | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
Write-Host "guids.json: $($guids.Count) 條對應 → $guidsPath" -ForegroundColor Green

# --- character key + per-locale translation map -----------------------------
# 給翻譯流程用：source 對話的角色名是 en-US（例如 "Lawrence Chang"），要轉成
# 目標語言的角色名（例如 "Лоуренс ЧFан"）。需要兩張表：
#   character-keys.json         : en-US name → Key
#   character-translations.json : Key → { locale → name }
#
# 翻譯對照表 sheet6 (角色) 欄位順序（與 ReleasedLanguage enum 對齊）：
#   A=Gender, B=Key, C=zh-TW, D=zh-CN, E=en-US, F=ja-JP, G=it-IT, H=ru-RU, I=es-ES, J=fr-FR
function Build-CharacterTranslationMaps {
    param([string]$XlsxPath, [string]$OutDir)
    if (-not (Test-Path $XlsxPath)) { return }
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [IO.Compression.ZipFile]::OpenRead($XlsxPath)
    try {
        $ssEntry = $zip.Entries | Where-Object FullName -eq 'xl/sharedStrings.xml'
        if (-not $ssEntry) { return }
        $ssXml = [xml]([IO.StreamReader]::new($ssEntry.Open()).ReadToEnd())
        $ns = New-Object Xml.XmlNamespaceManager($ssXml.NameTable)
        $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
        $strings = @()
        foreach ($si in $ssXml.SelectNodes('//x:si', $ns)) {
            $strings += -join ($si.SelectNodes('.//x:t', $ns) | ForEach-Object { $_.InnerText })
        }
        $sheetEntry = $zip.Entries | Where-Object FullName -eq 'xl/worksheets/sheet6.xml'
        if (-not $sheetEntry) { return }
        $sx = [xml]([IO.StreamReader]::new($sheetEntry.Open()).ReadToEnd())
        $rows = $sx.SelectNodes('//x:row', $ns)
        if (-not $rows -or $rows.Count -lt 4) { return }

        $enToKey    = [ordered]@{}
        $keyToTrans = [ordered]@{}

        # 跳過前 3 列（標題 / 註解 / 字體設定）
        for ($i = 3; $i -lt $rows.Count; $i++) {
            $row = $rows[$i]
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
            $key = $cells['B']
            if (-not $key -or $key.StartsWith('//')) { continue }

            $enUS = $cells['E']
            if ($enUS -and -not $enToKey.Contains($enUS)) {
                $enToKey[$enUS] = $key
            }

            $keyToTrans[$key] = [ordered]@{
                'zh-TW' = $cells['C']
                'zh-CN' = $cells['D']
                'en-US' = $cells['E']
                'ja-JP' = $cells['F']
                'it-IT' = $cells['G']
                'ru-RU' = $cells['H']
                'es-ES' = $cells['I']
                'fr-FR' = $cells['J']
            }
        }

        $keysOut  = Join-Path $OutDir 'character-keys.json'
        $transOut = Join-Path $OutDir 'character-translations.json'
        [IO.File]::WriteAllText($keysOut,  ($enToKey    | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($transOut, ($keyToTrans | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        Write-Host ("character-keys.json: " + $enToKey.Count + " 條對應 → " + $keysOut)
        Write-Host ("character-translations.json: " + $keyToTrans.Count + " 條對應 → " + $transOut)
    } finally {
        $zip.Dispose()
    }
}

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

    # 翻譯流程要的：en-US 角色名 → Key、Key → {locale → name}
    Build-CharacterTranslationMaps -XlsxPath $xlsxPath.Path -OutDir $OutDir
}

Write-Host ""
Write-Host "完成：" -ForegroundColor Green
Write-Host "  共 $($scripts.Count) 部劇本(故事順序)"
foreach ($base in ($scripts.Keys | Sort-Object { Get-StoryOrderKey $_ }, { $_ })) {
    $locs = ($scripts[$base].locales.Keys | Sort-Object) -join ', '
    Write-Host "  - $base  ($locs)"
}
Write-Host ""
Write-Host "manifest 寫到: $manifestPath"
