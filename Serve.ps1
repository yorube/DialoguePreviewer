# Serve.ps1 — minimal static HTTP server for testing yarn-preview locally.
# 用法（在 yarn-preview 目錄底下）：
#   .\Serve.ps1                     → http://localhost:8080
#   .\Serve.ps1 -Port 9000          → 換 port
#
# 之所以需要 server：瀏覽器在 file:// 下會擋 fetch()，data/manifest.json 拉不下來。
# 這支只是讓本機測試方便。正式部署直接把 yarn-preview/ 整個資料夾丟 GitHub Pages
# / Cloudflare Pages / 任何 static hosting 都可以，不需要這個 script。

param(
    [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    Write-Error "無法綁定 port ${Port}: $_"
    exit 1
}

Write-Host "Serving $root" -ForegroundColor Cyan
Write-Host "→ http://localhost:$Port/" -ForegroundColor Green
Write-Host "按 Ctrl+C 中止。" -ForegroundColor DarkGray

$mimeMap = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response
        try {
            $rel = [uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
            if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
            # 阻擋 .. 跳出 root
            $rel = $rel -replace '\.\.', ''
            $path = Join-Path $root $rel
            if ((Test-Path $path -PathType Container)) {
                $path = Join-Path $path 'index.html'
            }
            if (Test-Path $path -PathType Leaf) {
                $bytes = [IO.File]::ReadAllBytes($path)
                $ext   = [IO.Path]::GetExtension($path).ToLower()
                $mime  = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' }
                $res.ContentType = $mime
                $res.ContentLength64 = $bytes.Length
                # 禁用快取：開發/翻譯預覽環境，內容會頻繁更動
                $res.Headers.Add('Cache-Control', 'no-cache, no-store, must-revalidate')
                $res.Headers.Add('Pragma', 'no-cache')
                $res.Headers.Add('Expires', '0')
                $res.StatusCode = 200
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
                Write-Host "200 $($req.HttpMethod) /$rel ($($bytes.Length) bytes)" -ForegroundColor DarkGray
            } else {
                $res.StatusCode = 404
                $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found: /$rel`n")
                $res.OutputStream.Write($msg, 0, $msg.Length)
                Write-Host "404 $($req.HttpMethod) /$rel" -ForegroundColor Yellow
            }
        } catch {
            Write-Warning "處理請求時錯誤: $_"
            $res.StatusCode = 500
        } finally {
            $res.Close()
        }
    }
} finally {
    $listener.Stop()
    Write-Host "Server 停止。" -ForegroundColor Cyan
}
