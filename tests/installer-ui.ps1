# Drives the interactive installer and uninstaller pages with Windows UI Automation (no silent flags):
#   folder page -> Program Files is explained and Next is disabled -> Back -> valid folder -> install ->
#   uninstaller shows Standard / Complete choices -> Complete -> separate "also delete projects?" prompt
#   -> No -> projects kept, everything else removed.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tests\installer-ui.ps1 <Setup.exe> <install dir>
param([string]$Setup, [string]$Dir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]; $TS = [System.Windows.Automation.TreeScope]
$C = [System.Windows.Automation.Condition]::TrueCondition

Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W32 {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
}
"@
# NSIS dialogs show up as plain panes in UI Automation: find controls by class/name, drive them with messages.
function Windows { $A::RootElement.FindAll($TS::Children, $C) }
function Find-Window($titleLike, $timeout = 60) {
  $end = (Get-Date).AddSeconds($timeout)
  while ((Get-Date) -lt $end) { foreach ($w in Windows) { if ($w.Current.Name -like $titleLike) { return $w } }; Start-Sleep -Milliseconds 300 }
  throw "Window '$titleLike' not found"
}
function All($w) { $w.FindAll($TS::Descendants, $C) }
function Text($w) { (All $w | ForEach-Object { $_.Current.Name }) -join ' | ' }
function Wait-Text($w, $pattern, $timeout = 120) {
  $end = (Get-Date).AddSeconds($timeout)
  while ((Get-Date) -lt $end) { $t = Text $w; if ($t -match $pattern) { return $t }; Start-Sleep -Milliseconds 400 }
  throw "Timed out waiting for /$pattern/. Saw: $(Text $w)"
}
function Ctl($w, $class, $name = '*') { All $w | Where-Object { $_.Current.ClassName -eq $class -and ($_.Current.Name -replace '&', '') -like $name } | Select-Object -First 1 }
function Button($w, $name) { Ctl $w 'Button' $name }
function Hwnd($e) { [IntPtr]$e.Current.NativeWindowHandle }
function Click($w, $name) { $b = Button $w $name; if (-not $b) { throw "No button '$name'. Saw: $(Text $w)" }; [W32]::PostMessage((Hwnd $b), 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; Start-Sleep -Milliseconds 900 }
function Checked($e) { [W32]::SendMessage((Hwnd $e), 0xF0, [IntPtr]::Zero, [IntPtr]::Zero) -eq 1 }
function Set-Edit($w, $value) { $e = Ctl $w 'Edit'; [W32]::SendMessage((Hwnd $e), 0x000C, [IntPtr]::Zero, $value) | Out-Null }
# The forward button (control id 1) is labelled Next >, Install or Uninstall depending on the page.
function Forward($w) { foreach ($n in 'Next*', 'Install', 'Uninstall') { $b = Button $w $n; if ($b) { return $b } } }
function Check($ok, $msg) { if (-not $ok) { throw "FAILED: $msg" }; Write-Host "  ok - $msg" }

Write-Host '· installer: protected folder is explained, Next disabled'
$p = Start-Process -FilePath $Setup -PassThru
$w = Find-Window '*FrameCut Studio*Setup*'
Wait-Text $w 'Destination Folder|Choose Install Location' | Out-Null
$default = (Ctl $w 'Edit').Current.Name
Check ($default -like "$env:LOCALAPPDATA\Programs\*") "default folder is per-user and writable ($default)"
Set-Edit $w "$env:ProgramFiles\FrameCut Studio"
Click $w 'Next*'
$t = Wait-Text $w 'protected Windows folder'
Check ($t -match 'Program Files and Windows') 'explains the Program Files limitation'
$fwd = Forward $w
Check ($fwd -and -not $fwd.Current.IsEnabled) "$($fwd.Current.Name) is disabled"
Check (-not (Test-Path "$env:ProgramFiles\FrameCut Studio")) 'nothing created in Program Files'
Click $w '*Back'
Set-Edit $w $Dir
Click $w 'Next*'
Wait-Text $w 'Completing|has been installed|Finish' 300 | Out-Null
$run = Button $w 'Run*'
if ($run -and (Checked $run)) { [W32]::SendMessage((Hwnd $run), 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
Click $w 'Finish*'
$p.WaitForExit(30000) | Out-Null
Check (Test-Path "$Dir\FrameCut Studio.exe") "installed into $Dir"

# A project inside the folder, so the uninstaller has user files to ask about.
New-Item -ItemType Directory -Force "$Dir\data\projects\ui-test-project" | Out-Null
Set-Content "$Dir\data\projects\ui-test-project\project.json" '{}'
New-Item -ItemType Directory -Force "$Dir\data\engines\models" | Out-Null
Set-Content "$Dir\data\engines\models\model.bin" 'x'

Write-Host '· uninstaller: two choices, Complete asks separately about projects'
$u = Start-Process -FilePath "$Dir\Uninstall FrameCut Studio.exe" -PassThru
$w = Find-Window '*FrameCut Studio*Uninstall*'
$t = Wait-Text $w 'Standard uninstall'
Check ($t -match 'Complete removal') 'shows Standard and Complete removal'
Click $w 'Complete removal'
Check (Checked (Button $w 'Complete removal')) 'Complete removal selected' 
Click $w ((Forward $w).Current.Name -replace '&', '')
$end = (Get-Date).AddSeconds(20)
do { $box = $null; foreach ($x in Windows) { if ((Text $x) -match 'Also delete your projects') { $box = $x } }; Start-Sleep -Milliseconds 300 } while (-not $box -and (Get-Date) -lt $end)
Check ($box -ne $null) 'separate confirmation before deleting projects'
Click $box 'No'
$w = Find-Window '*FrameCut Studio*Uninstall*'
if (Button $w 'Uninstall*') { Click $w 'Uninstall*' }
$end = (Get-Date).AddSeconds(120)
do {
  foreach ($x in Windows) { if ((Text $x) -match 'were kept in') { Click $x 'OK' } }
  $w2 = $null; foreach ($x in Windows) { if ($x.Current.Name -like '*FrameCut Studio*Uninstall*') { $w2 = $x } }
  if ($w2 -and (Button $w2 'Finish*') -and (Button $w2 'Finish*').Current.IsEnabled) { Click $w2 'Finish*'; break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $end)
Start-Sleep 3
Check (-not (Test-Path "$Dir\FrameCut Studio.exe")) 'app removed'
Check (-not (Test-Path "$Dir\data\engines")) 'models removed'
Check (Test-Path "$Dir\data\projects\ui-test-project\project.json") 'project kept after answering No'
Remove-Item -Recurse -Force $Dir
Write-Host 'installer UI: all checks passed'
