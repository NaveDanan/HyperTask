# Read-only proof of concept. Prints up to three newest MailItem messages from
# the default Inbox. Does not display, save, send, move, delete, or mark mail.
# Message contents go to stdout only; do not redirect them into the repository.
[CmdletBinding()]
param(
  [ValidateRange(1, 3)] [int] $Count = 3,
  [ValidateRange(0, 1200)] [int] $PreviewLength = 400
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$outlook = $null; $namespace = $null; $inbox = $null; $items = $null; $item = $null
$exitCode = 0

function Release-HyperDemoCom($value) {
  if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($value)
  }
}

try {
  $demoIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $demoPrincipal = New-Object Security.Principal.WindowsPrincipal($demoIdentity)
  if ($demoPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this demo without elevation, as the same Windows user as Outlook.'
  }
  if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw 'Run Windows PowerShell with -Sta.'
  }
  $outlook = New-Object -ComObject Outlook.Application
  $namespace = $outlook.GetNamespace('MAPI')
  $inbox = $namespace.GetDefaultFolder(6) # olFolderInbox
  $items = $inbox.Items
  $items.Sort('[ReceivedTime]', $true)
  $messages = New-Object Collections.ArrayList
  $scanned = 0
  $allReadStatesUnchanged = $true
  $item = $items.GetFirst()
  while ($null -ne $item -and $messages.Count -lt $Count -and $scanned -lt 100) {
    $scanned++
    if ([int]$item.Class -eq 43) { # olMail; excludes meeting requests/reports
      $unreadBefore = [bool]$item.UnRead
      $preview = ''
      if ($PreviewLength -gt 0) {
        $preview = ([regex]::Replace([string]$item.Body, '\s+', ' ')).Trim()
        if ($preview.Length -gt $PreviewLength) { $preview = $preview.Substring(0, $PreviewLength) }
      }
      $from = [string]$item.SenderName
      $subject = [string]$item.Subject
      $received = ([datetime]$item.ReceivedTime).ToString('yyyy-MM-dd HH:mm:ss')
      $unreadAfter = [bool]$item.UnRead
      $unchanged = $unreadBefore -eq $unreadAfter
      $allReadStatesUnchanged = $allReadStatesUnchanged -and $unchanged
      [void]$messages.Add([pscustomobject]@{
        From = $from; Subject = $subject; ReceivedLocal = $received
        Preview = $preview; WasUnread = $unreadBefore
        IsUnread = $unreadAfter; ReadStateUnchanged = $unchanged
      })
    }
    Release-HyperDemoCom $item
    $item = $null
    if ($messages.Count -lt $Count -and $scanned -lt 100) { $item = $items.GetNext() }
  }
  [pscustomobject]@{
    Ok = $true; Method = 'Classic Outlook COM / MAPI'; Folder = 'Default Inbox'
    TimeZone = [TimeZoneInfo]::Local.Id; Returned = $messages.Count
    ReadOnly = $true; AllReadStatesUnchanged = $allReadStatesUnchanged
    Emails = @($messages.ToArray())
  } | ConvertTo-Json -Depth 5 -Compress
} catch {
  [pscustomobject]@{ Ok = $false; Error = $_.Exception.Message; ReadOnly = $true } |
    ConvertTo-Json -Compress
  $exitCode = 1
} finally {
  foreach ($value in @($item, $items, $inbox, $namespace, $outlook)) { Release-HyperDemoCom $value }
  # Deliberately do not call Outlook.Quit(): Outlook belongs to the user.
}
exit $exitCode
