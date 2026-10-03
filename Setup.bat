@echo off
setlocal
cd /d "%~dp0"
title Enex Setup
chcp 65001 >nul
where powershell >nul 2>nul || (echo PowerShell bulunamadi / PowerShell not found. & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $s=[IO.File]::ReadAllText($f,[Text.Encoding]::UTF8); $i=$s.LastIndexOf('#==PS==#'); iex $s.Substring($i+8)"
exit /b %errorlevel%
#==PS==#
# ---------------------------------------------------------------
#  Enex kurulum betigi / installer script (PowerShell, bat icinde)
# ---------------------------------------------------------------
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { [Console]::CursorVisible = $false } catch {}
$root = Split-Path -Parent $f
Set-Location $root
$log = Join-Path $root 'setup.log'
'' | Set-Content $log

function W($t, $c = 'Gray', [switch]$n) { if ($n) { Write-Host $t -ForegroundColor $c -NoNewline } else { Write-Host $t -ForegroundColor $c } }
function At($x, $y) { try { [Console]::SetCursorPosition($x, $y) } catch {} }

# ---------- 1) Logo: karisik sembollerden cozulme efekti ----------
$logo = @(
  '  ███████╗███╗   ██╗███████╗██╗  ██╗',
  '  ██╔════╝████╗  ██║██╔════╝╚██╗██╔╝',
  '  █████╗  ██╔██╗ ██║█████╗   ╚███╔╝ ',
  '  ██╔══╝  ██║╚██╗██║██╔══╝   ██╔██╗ ',
  '  ███████╗██║ ╚████║███████╗██╔╝ ██╗',
  '  ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝'
)
$colors = 'DarkMagenta','Magenta','Magenta','Cyan','Cyan','DarkCyan'
$glyphs = '░▒▓█▀▄■□▪◆◇○●※#@$%&*+=<>/\|'.ToCharArray()
$rnd = New-Object Random

Clear-Host
W ''
$top = [Console]::CursorTop
# bos satirlari ayir
foreach ($l in $logo) { W '' }

# 12 kare: her karede sol taraftan saga dogru daha fazla karakter "yerine oturur"
$frames = 14
for ($k = 0; $k -le $frames; $k++) {
  for ($r = 0; $r -lt $logo.Count; $r++) {
    $line = $logo[$r]; $sb = New-Object Text.StringBuilder
    $edge = [int]($line.Length * $k / $frames) + ($r * 2) - 6
    for ($i = 0; $i -lt $line.Length; $i++) {
      $ch = $line[$i]
      if ($ch -eq ' ' -or $i -lt $edge) { [void]$sb.Append($ch) }
      else { [void]$sb.Append($glyphs[$rnd.Next($glyphs.Length)]) }
    }
    At 0 ($top + $r); W $sb.ToString() ($(if ($k -eq $frames) { $colors[$r] } else { 'DarkGray' })) -n
  }
  Start-Sleep -Milliseconds 45
}
# parlama (shimmer) gecisi
$w = $logo[0].Length
for ($x = 0; $x -lt $w + 6; $x += 2) {
  for ($r = 0; $r -lt $logo.Count; $r++) {
    $line = $logo[$r]
    At 0 ($top + $r)
    $a = [Math]::Max(0, [Math]::Min($w, $x - 4)); $b = [Math]::Min($w, $x)
    W $line.Substring(0, $a) $colors[$r] -n
    W $line.Substring($a, $b - $a) 'White' -n
    W $line.Substring($b) $colors[$r] -n
  }
  Start-Sleep -Milliseconds 18
}
At 0 ($top + $logo.Count); W ''

# daktilo efekti
function Typewrite($t, $c = 'Gray') { foreach ($ch in $t.ToCharArray()) { W $ch $c -n; Start-Sleep -Milliseconds 12 }; W '' }
Typewrite '   discord, ama senin tarzinda  ·  discord, your way' 'DarkGray'
W ''

# ---------- 2) Adimlar: donen semboller ----------
$spin = '▖','▘','▝','▗'
$dots = '⣾','⣽','⣻','⢿','⡿','⣟','⣯','⣷'
$useBraille = $env:WT_SESSION -ne $null   # Windows Terminal ise braille, degilse blok sembol
$frm = if ($useBraille) { $dots } else { $spin }

function Run-Step($num, $label, $cmd) {
  $y = [Console]::CursorTop
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c $cmd >> `"$log`" 2>&1" -NoNewWindow -PassThru
  [void]$p.Handle
  $sw = [Diagnostics.Stopwatch]::StartNew(); $i = 0
  while (-not $p.HasExited) {
    $t = '{0:mm\:ss}' -f $sw.Elapsed
    $bar = ''
    $pos = $i % 20
    for ($j = 0; $j -lt 20; $j++) { $d = [Math]::Abs($j - $pos); $bar += $(if ($d -eq 0) { '█' } elseif ($d -eq 1) { '▓' } elseif ($d -eq 2) { '▒' } else { '░' }) }
    At 0 $y
    W "   $($frm[$i % $frm.Count]) " 'Magenta' -n
    W "[$num] " 'DarkGray' -n
    W ($label.PadRight(34)) 'White' -n
    W "$bar " 'DarkCyan' -n
    W $t 'DarkGray' -n
    W '   ' -n
    Start-Sleep -Milliseconds 90; $i++
  }
  $p.WaitForExit()
  At 0 $y
  if ($p.ExitCode -eq 0) {
    W '   ✔ ' 'Green' -n; W "[$num] " 'DarkGray' -n; W ($label.PadRight(34)) 'White' -n
    W ('█' * 20) 'Green' -n; W (' {0:mm\:ss}   ' -f $sw.Elapsed) 'DarkGray'
    return $true
  } else {
    W '   ✖ ' 'Red' -n; W "[$num] " 'DarkGray' -n; W ($label.PadRight(34)) 'White' -n
    W ('▒' * 20) 'Red'
    return $false
  }
}

function Fail($msg) {
  W ''
  W "   $msg" 'Red'
  if (Test-Path $log) {
    W '   ---- setup.log (son satirlar / last lines) ----' 'DarkGray'
    Get-Content $log -Tail 15 | ForEach-Object { W "   $_" 'DarkGray' }
  }
  try { [Console]::CursorVisible = $true } catch {}
  W ''; W '   Bir tusa bas / press any key...' 'DarkGray'; [void][Console]::ReadKey($true)
  exit 1
}

# [1/3] Node.js kontrolu
$y = [Console]::CursorTop
for ($i = 0; $i -lt 10; $i++) { At 0 $y; W "   $($frm[$i % $frm.Count]) " 'Magenta' -n; W '[1/3] ' 'DarkGray' -n; W 'Node.js kontrol / checking' 'White' -n; Start-Sleep -Milliseconds 60 }
$node = Get-Command node -ErrorAction SilentlyContinue
At 0 $y
if (-not $node -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  W '   ✖ ' 'Red' -n; W '[1/3] ' 'DarkGray' -n; W 'Node.js kontrol / checking      ' 'White'
  Fail 'Node.js bulunamadi / Node.js not found  ->  https://nodejs.org'
}
$nv = (& node -v)
W '   ✔ ' 'Green' -n; W '[1/3] ' 'DarkGray' -n; W 'Node.js kontrol / checking  ' 'White' -n; W $nv 'DarkGray'

W '   (Acik bir Enex penceresi varsa kapat / close Enex if it is open)' 'DarkYellow'
W ''

if (-not (Run-Step '2/3' 'Paketler / dependencies' 'npm install --no-audit --no-fund')) { Fail 'npm install basarisiz / failed.' }
if (-not (Run-Step '3/3' 'Derleniyor / building' 'npm run build')) { Fail 'Derleme basarisiz / build failed.' }

# ---------- 3) Bitis: dolan bar + kutlama ----------
W ''
$y = [Console]::CursorTop
for ($p = 0; $p -le 40; $p++) {
  At 0 $y
  W '   ' -n; W ('█' * $p) 'Magenta' -n; W ('░' * (40 - $p)) 'DarkGray' -n
  W (' {0,3}%' -f [int]($p * 2.5)) 'White' -n
  Start-Sleep -Milliseconds 15
}
W ''; W ''
$spark = '✦','✧','·','*'
$y = [Console]::CursorTop
for ($k = 0; $k -lt 12; $k++) {
  At 0 $y; $s = ''
  for ($j = 0; $j -lt 44; $j++) { $s += $(if ($rnd.Next(5) -eq 0) { $spark[$rnd.Next($spark.Count)] } else { ' ' }) }
  W $s (('Magenta','Cyan','Yellow')[$k % 3]) -n
  Start-Sleep -Milliseconds 70
}
At 0 $y; W (' ' * 44) -n; At 0 $y
W '   ✔ Tamam! Kurulum baslatiliyor.  ·  Done! Starting the installer.' 'Green'
W ''

$exe = Join-Path $root 'dist\Enex-Setup.exe'
if (Test-Path $exe) { Start-Process $exe } else { Fail 'dist\Enex-Setup.exe bulunamadi / not found.' }
try { [Console]::CursorVisible = $true } catch {}
Start-Sleep -Seconds 3
exit 0
