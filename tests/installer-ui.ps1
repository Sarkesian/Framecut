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

function Find-Window($titleLike, $timeout = 60) {
  $end = (Get-Date).AddSeconds($timeout)
  while ((Get-Date) -lt $end) {
    foreach ($w in $A::RootElement.FindAll($TS::Children, $C)) { if ($w.Current.Name -like $titleLike) { return $w } }
    Start-Sleep -Milliseconds 300
  }
  throw "Window '$titleLike' not found"
}
function All($w) { $w.FindAll($TS::Descendants, $C) }
function Text($w) { (All $w | ForEach-Object { $_.Current.Name }) -join ' | ' }
function Wait-Text($w, $pattern, $timeout = 120) {
  $end = (Get-Date).AddSeconds($timeout)
  while ((Get-Date) -lt $end) { $t = Text $w; if ($t -match $pattern) { return $t }; Start-Sleep -Milliseconds 400 }
  throw "Timed out waiting for /$pattern/. Saw: $(Text $w)"
}
function Button($w, $name) { All $w | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $_.Current.Name -replace '&', '' -like $name } | Select-Object -First 1 }
function Click($w, $name) { $b = Button $w $name; if (-not $b) { throw "No button '$name'. Saw: $(Text $w)" }; $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 700 }
function Check($ok, $msg) { if (-not $ok) { throw "FAILED: $msg" }; Write-Host "  ok - $msg" }

Write-Host '· installer: protected folder is explained, Next disabled'
$p = Start-Process -FilePath $Setup -PassThru
$w = Find-Window '*FrameCut Studio*Setup*'
Wait-Text $w 'Destination Folder|Choose Install Location' | Out-Null
$edit = All $w | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit' } | Select-Object -First 1
$default = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
Check ($default -like "$env:LOCALAPPDATA\Programs\*") "default folder is per-user and writable ($default)"
$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue("$env:ProgramFiles\FrameCut Studio")
Click $w 'Next*'
$t = Wait-Text $w 'protected Windows folder'
Check ($t -match 'Program Files and Windows') 'explains the Program Files limitation'
Check (-not (Button $w 'Next*').Current.IsEnabled) 'Next is disabled'
Check (-not (Test-Path "$env:ProgramFiles\FrameCut Studio")) 'nothing created in Program Files'
Click $w 'Back*'
$edit = All $w | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit' } | Select-Object -First 1
$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Dir)
Click $w 'Next*'
Wait-Text $w 'Completing|has been installed|Finish' 300 | Out-Null
$run = All $w | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.CheckBox' } | Select-Object -First 1
if ($run -and $run.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -eq 'On') { $run.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() }
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
$complete = All $w | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.RadioButton' -and $_.Current.Name -like '*Complete*' } | Select-Object -First 1
$complete.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
Click $w 'Next*'
$box = Find-Window '*FrameCut Studio*' 20
$end = (Get-Date).AddSeconds(20)
do { $box = $null; foreach ($x in $A::RootElement.FindAll($TS::Children, $C)) { if ((Text $x) -match 'Also delete your projects') { $box = $x } }; Start-Sleep -Milliseconds 300 } while (-not $box -and (Get-Date) -lt $end)
Check ($box -ne $null) 'separate confirmation before deleting projects'
Click $box 'No'
$w = Find-Window '*FrameCut Studio*Uninstall*'
if (Button $w 'Uninstall*') { Click $w 'Uninstall*' }
$end = (Get-Date).AddSeconds(120)
do {
  foreach ($x in $A::RootElement.FindAll($TS::Children, $C)) { if ((Text $x) -match 'were kept in') { Click $x 'OK' } }
  $w2 = $null; foreach ($x in $A::RootElement.FindAll($TS::Children, $C)) { if ($x.Current.Name -like '*FrameCut Studio*Uninstall*') { $w2 = $x } }
  if ($w2 -and (Button $w2 'Finish*') -and (Button $w2 'Finish*').Current.IsEnabled) { Click $w2 'Finish*'; break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $end)
Start-Sleep 3
Check (-not (Test-Path "$Dir\FrameCut Studio.exe")) 'app removed'
Check (-not (Test-Path "$Dir\data\engines")) 'models removed'
Check (Test-Path "$Dir\data\projects\ui-test-project\project.json") 'project kept after answering No'
Remove-Item -Recurse -Force $Dir
Write-Host 'installer UI: all checks passed'
