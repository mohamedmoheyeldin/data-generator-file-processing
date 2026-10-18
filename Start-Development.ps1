param([ValidateSet('start', 'verify', 'test:e2e', 'dist')][string]$Task = 'start')
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
if (Test-Path -LiteralPath (Join-Path $runtime 'node.exe')) {
    $env:PATH = "$runtime;$env:PATH"
}
if ((node --version) -notmatch '^v24\.') {
    throw 'This project requires Node.js 24. Install Node 24 or add it to PATH.'
}
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    corepack pnpm run $Task
    if ($LASTEXITCODE -ne 0) { throw "Task $Task failed." }
} finally { Pop-Location }
