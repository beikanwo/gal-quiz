# 仅修改 cloudflare/worker.mjs 时需要重新上传；日常网页更新仍走 GitHub Actions。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root 'design/edge-upload'
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'cloudflare/worker.mjs') -Destination (Join-Path $output '_worker.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'site/index.html') -Destination (Join-Path $output 'index.html') -Force
$zip = Join-Path $root 'design/gal-quiz-edge.zip'
Compress-Archive -LiteralPath (Join-Path $output '_worker.js'), (Join-Path $output 'index.html') -DestinationPath $zip -Force
Write-Output $zip
