# Downloads the free-exercise-db (public domain, github.com/yuhonas/free-exercise-db)
# exercise catalog + images into apps/server/prisma/seed-data/.
# The results are committed so builds and seeding work offline.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root 'apps\server\prisma\seed-data'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "free-exercise-db-$(Get-Random)"

New-Item -ItemType Directory -Force $dest | Out-Null
Invoke-WebRequest 'https://github.com/yuhonas/free-exercise-db/archive/refs/heads/main.zip' -OutFile "$tmp.zip"
Expand-Archive "$tmp.zip" $tmp
$src = Join-Path $tmp 'free-exercise-db-main'

Copy-Item (Join-Path $src 'dist\exercises.json') (Join-Path $dest 'exercises.json') -Force
if (Test-Path (Join-Path $dest 'images')) { Remove-Item (Join-Path $dest 'images') -Recurse -Force }
Copy-Item (Join-Path $src 'exercises') (Join-Path $dest 'images') -Recurse -Exclude '*.json'

Remove-Item "$tmp.zip" -Force
Remove-Item $tmp -Recurse -Force
Write-Host "Done. $((Get-ChildItem (Join-Path $dest 'images') -Directory).Count) exercise image folders."
