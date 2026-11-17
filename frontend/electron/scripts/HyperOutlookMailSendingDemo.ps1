<#
.SYNOPSIS
Sends one plain-text test email through the default classic Outlook account.
.DESCRIPTION
Requires classic Outlook for Windows under the same Windows user. The -To
parameter accepts one email address. -WhatIf validates the request without
connecting to Outlook. Outlook handles sending; success does not confirm delivery.
.EXAMPLE
.\HyperOutlookMailSendingDemo.ps1 -To 'naved@rafael.co.il'
.EXAMPLE
.\HyperOutlookMailSendingDemo.ps1 -To 'naved@rafael.co.il' -Subject 'My test' -Body 'Hello from HyperTask.'
.EXAMPLE
.\HyperOutlookMailSendingDemo.ps1 -To 'naved@rafael.co.il' -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [ValidateLength(1, 320)]
  [string] $To,

  [ValidateNotNullOrEmpty()]
  [ValidateLength(1, 255)]
  [string] $Subject = 'HyperTask Outlook sending demo',

  [AllowEmptyString()]
  [ValidateLength(0, 65536)]
  [string] $Body = 'This is a test email sent through the HyperTask Outlook COM/MAPI demo.'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$outlook = $null; $mail = $null; $recipients = $null; $recipient = $null
$sendAttempted = $false; $exitCode = 0

function Release-HyperSendingDemoCom($value) {
  if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($value)
  }
}

try {
  $target = $To.Trim()
  $address = New-Object Net.Mail.MailAddress($target)
  if ($target -match '[\r\n;,]' -or $address.Address -ne $target -or $address.DisplayName) {
    throw 'Enter exactly one email address, without a display name or recipient list.'
  }
  if ($Subject -match '[\r\n]' -or [string]::IsNullOrWhiteSpace($Subject)) {
    throw 'The subject must be nonempty and contain no line breaks.'
  }

  if ($PSCmdlet.ShouldProcess($target, "Send Outlook email with subject '$Subject'")) {
    $demoIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $demoPrincipal = New-Object Security.Principal.WindowsPrincipal($demoIdentity)
    if ($demoPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw 'Run this demo without elevation, as the same Windows user as Outlook.'
    }
    if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
      throw 'Run Windows PowerShell with -Sta.'
    }
    $outlook = New-Object -ComObject Outlook.Application
    $mail = $outlook.CreateItem(0) # olMailItem
    $mail.BodyFormat = 1 # olFormatPlain
    $mail.Subject = $Subject
    $mail.Body = $Body
    $recipients = $mail.Recipients
    $recipient = $recipients.Add($target)
    $recipient.Type = 1 # olTo
    if (!$recipients.ResolveAll()) { throw 'Outlook could not resolve the recipient. No send was attempted.' }

    $sendAttempted = $true
    $mail.Send()
    [pscustomobject]@{
      Ok = $true; Status = 'SubmittedToOutlook'; Method = 'Classic Outlook COM / MAPI'
      To = $target; Subject = $Subject; Account = 'Default Outlook account'
      DeliveryConfirmed = $false
    } | ConvertTo-Json -Compress
  } else {
    [pscustomobject]@{
      Ok = $true; Status = 'NotSent'; To = $target; Subject = $Subject
      SendAttempted = $false
    } | ConvertTo-Json -Compress
  }
} catch {
  [pscustomobject]@{
    Ok = $false; Status = 'Failed'; Error = $_.Exception.Message
    SendAttempted = $sendAttempted
    Note = $(if ($sendAttempted) { 'Check Outlook Outbox and Sent Items before retrying; delivery is unknown.' } else { 'No send was attempted.' })
  } | ConvertTo-Json -Compress
  $exitCode = 1
} finally {
  if ($null -ne $mail -and !$sendAttempted) {
    try { $mail.Close(1) } catch {} # olDiscard: only this newly created, unsent item
  }
  foreach ($value in @($recipient, $recipients, $mail, $outlook)) { Release-HyperSendingDemoCom $value }
  # Do not call Outlook.Quit(): Outlook belongs to the user. Never retry a send.
}
exit $exitCode
