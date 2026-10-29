param([int]$Width = 390, [switch]$CapturePreview)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testPage = Join-Path $projectRoot '.auth-check.html'
$testProfile = Join-Path $projectRoot '.auth-check-profile'
$logFile = Join-Path $projectRoot '.auth-check-log.txt'
$outFile = Join-Path $projectRoot '.auth-check-out.txt'
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$browserProcess = $null
$socket = $null
$script:requestId = 0
function Invoke-DevTools($Method, $Parameters) {
  $script:requestId++
  $payload = @{ id = $script:requestId; method = $Method; params = $Parameters } | ConvertTo-Json -Depth 12 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $segment = New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$bytes)
  $cancel = New-Object Threading.CancellationTokenSource
  $cancel.CancelAfter(10000)
  try {
    $socket.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, $cancel.Token).GetAwaiter().GetResult() | Out-Null
    do {
      $stream = New-Object IO.MemoryStream
      try {
        do {
          $buffer = New-Object byte[] 65536
          $received = $socket.ReceiveAsync((New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$buffer)), $cancel.Token).GetAwaiter().GetResult()
          $stream.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)
        $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
      } finally { $stream.Dispose() }
    } while ($response.id -ne $script:requestId)
    if ($response.error) { throw ($response.error | ConvertTo-Json) }
    return $response
  } finally { $cancel.Dispose() }
}
if (-not (Test-Path -LiteralPath $chromePath)) { throw 'Se requiere Google Chrome instalado.' }
try {
  $html = Get-Content -LiteralPath (Join-Path $projectRoot 'index.html') -Raw -Encoding UTF8
  $html.Replace('</body>', '<script src="tests/auth.browser.js"></script></body>') | Set-Content -LiteralPath $testPage -Encoding UTF8
  $testUrl = ([Uri]$testPage).AbsoluteUri
  $arguments = '--headless --disable-gpu --no-first-run --no-default-browser-check --remote-debugging-port=0 --user-data-dir="' + $testProfile + '" about:blank'
  $browserProcess = Start-Process -FilePath $chromePath -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError $logFile -RedirectStandardOutput $outFile
  $portFile = Join-Path $testProfile 'DevToolsActivePort'
  for ($attempt = 0; $attempt -lt 100 -and -not (Test-Path -LiteralPath $portFile); $attempt++) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $portFile)) { throw 'No se pudo iniciar Chrome para las pruebas.' }
  $port = (Get-Content -LiteralPath $portFile)[0]
  $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list"
  $target = $targets | Where-Object type -eq 'page' | Select-Object -First 1
  $socket = New-Object Net.WebSockets.ClientWebSocket
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  Invoke-DevTools 'Emulation.setDeviceMetricsOverride' @{ width = $Width; height = 900; deviceScaleFactor = 1; mobile = ($Width -lt 768) } | Out-Null
  Invoke-DevTools 'Page.navigate' @{ url = $testUrl } | Out-Null
  $summary = ''
  for ($attempt = 0; $attempt -lt 225; $attempt++) {
    Start-Sleep -Milliseconds 200
    $response = Invoke-DevTools 'Runtime.evaluate' @{ expression = 'document.body?.dataset.testResult || ""'; returnByValue = $true }
    $summary = $response.result.result.value
    if ($summary) { break }
  }
  if (-not $summary) { throw 'La prueba no termino dentro de 45 segundos.' }
  Write-Output $summary
  if (-not $summary.StartsWith('PASS:')) { throw 'Fallo de la prueba funcional.' }
  if ($CapturePreview) {
    $previewDirectory = Join-Path $projectRoot 'previews'
    New-Item -ItemType Directory -Path $previewDirectory -Force | Out-Null
    Invoke-DevTools 'Page.navigate' @{ url = ([Uri](Join-Path $projectRoot 'index.html')).AbsoluteUri } | Out-Null
    Start-Sleep -Milliseconds 400
    foreach ($viewName in @('login', 'registration', 'recovery')) {
      if ($viewName -ne 'login') {
        Invoke-DevTools 'Runtime.evaluate' @{ expression = "document.querySelector('[data-view=""$viewName""]').click()" } | Out-Null
      }
      $screenshot = Invoke-DevTools 'Page.captureScreenshot' @{ format = 'png'; captureBeyondViewport = $true }
      $previewFile = Join-Path $previewDirectory "$viewName-$Width.png"
      [IO.File]::WriteAllBytes($previewFile, [Convert]::FromBase64String($screenshot.result.data))
      Write-Output "Vista guardada: $previewFile"
    }
  }
} finally {
  if ($socket) { $socket.Dispose() }
  if ($browserProcess -and -not $browserProcess.HasExited) { Stop-Process -Id $browserProcess.Id -Force; $browserProcess.WaitForExit() }
  Start-Sleep -Milliseconds 500
  foreach ($temporaryFile in @($testPage, $logFile, $outFile)) {
    if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
  }
  $resolvedProfile = [IO.Path]::GetFullPath($testProfile)
  if ($resolvedProfile -ne (Join-Path $projectRoot '.auth-check-profile') -or -not $resolvedProfile.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Ruta temporal fuera del proyecto.' }
  if (Test-Path -LiteralPath $resolvedProfile) { Remove-Item -LiteralPath $resolvedProfile -Recurse -Force }
}
