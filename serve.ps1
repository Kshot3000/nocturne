# Nocturne local server (zero-dependency, PowerShell)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$port = 8080

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host ""
Write-Host "  Nocturne is serving $root"
Write-Host "  →  http://localhost:$port/"
Write-Host "  (Ctrl+C to stop)"
Write-Host ""

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.map'  = 'application/json'
  '.txt'  = 'text/plain; charset=utf-8'
}

function Send-Error([System.Net.HttpListenerContext]$ctx, [int]$code, [string]$msg) {
  $ctx.Response.StatusCode = $code
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $path = Join-Path $root $rel
    $resolved = $null
    if (Test-Path -LiteralPath $path) {
      $resolved = (Resolve-Path -LiteralPath $path).Path
    }
    if (-not $resolved) { throw '404' }
    if ($resolved -notlike ($root + '*')) { throw '403' }
    if ((Get-Item -LiteralPath $resolved).PSIsContainer) {
      $idx = Join-Path $resolved 'index.html'
      if (Test-Path -LiteralPath $idx) { $resolved = $idx } else { throw '404' }
    }
    $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
    $ctx.Response.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($resolved)
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    if ($_.Exception.Message -eq '404') { Send-Error $ctx 404 '404 — lost in the dark.' }
    elseif ($_.Exception.Message -eq '403') { Send-Error $ctx 403 '403' }
    else { Send-Error $ctx 500 '500' }
  } finally {
    $ctx.Response.Close()
  }
}
