export const HyperOutlookScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$outlook = $null; $ns = $null; $calendar = $null
function Reset-Hyper {
  $script:calendar = $null; $script:ns = $null; $script:outlook = $null
}
function Hyper-Disconnected($exception) {
  while ($null -ne $exception) {
    if ($exception.HResult.ToString('X8') -in @('80010108','800706BA','800706BE','800401FD','80010007','80010012')) { return $true }
    $exception = $exception.InnerException
  }
  return $false
}
function Connect-Hyper {
  $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
  if (!(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session })) {
    Reset-Hyper
    throw 'Outlook is closed. Open Outlook to use your calendar and mail.'
  }
  if ($null -ne $calendar) {
    try { if ([string](Hyper-ComGet $calendar 'EntryID')) { return } } catch {}
    Reset-Hyper
  }
  try {
    # ROT attachment never activates Outlook, even if it exits between the process check and this call.
    $script:outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
    $script:ns = $outlook.GetNamespace('MAPI')
    $script:calendar = $ns.GetDefaultFolder(9)
    if ($null -eq $calendar -or ![string](Hyper-ComGet $calendar 'EntryID')) { throw 'Outlook calendar is not ready.' }
  } catch { Reset-Hyper; throw ('Outlook is still connecting. Wait for its profile to finish loading. Run HyperTask and Outlook as the same Windows user without elevation. ' + $_.Exception.Message) }
}
function Hyper-Utc($date) { return $date.ToUniversalTime().ToString('o') }
function Hyper-Date([string]$text) { return [datetime]::Parse($text, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime() }
function Hyper-Original($item) {
  $original = $item.Start
  if ([int]$item.RecurrenceState -eq 3) {
    $pattern = $item.GetRecurrencePattern()
    $matched = $false
    for ($i = 1; $i -le $pattern.Exceptions.Count; $i++) {
      $exception = $pattern.Exceptions.Item($i)
      if (!$exception.Deleted -and $exception.AppointmentItem.Start -eq $item.Start) {
        $original = $exception.OriginalDate.Date.Add($pattern.StartTime.TimeOfDay); $matched = $true; break
      }
    }
    if (!$matched) { throw 'Could not resolve this recurring occurrence. Open it in Outlook.' }
  }
  return $original
}
function Hyper-Map($item) {
  $private = [int]$item.Sensitivity -eq 2
  $allDay = [bool]$item.AllDayEvent
  $recurrence = [int]$item.RecurrenceState
  $key = [string]$item.EntryID
  if ($recurrence -eq 2 -or $recurrence -eq 3) { $key += '|' + (Hyper-Utc (Hyper-Original $item)) }
  $people = @(); $count = [int]$item.Recipients.Count
  if (!$private) {
    for ($i = 1; $i -le [Math]::Min($count, 200); $i++) {
      $recipient = $item.Recipients.Item($i); $email = ''
      try { $email = [string]$recipient.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x39FE001E') } catch {
        $address = [string]$recipient.Address; if ($address -like '*@*') { $email = $address }
      }
      $people += @{ name = [string]$recipient.Name; email = $email; type = [int]$recipient.Type; response = [int]$recipient.MeetingResponseStatus }
    }
  }
  $body = ''; $join = $null
  if (!$private) {
    $body = [string]$item.Body
    $match = [regex]::Match($body, 'https://teams\.(?:microsoft\.com/l/meetup-join/|live\.com/meet/)[^\s<>"]+')
    if ($match.Success) { $join = $match.Value }
    if ($body.Length -gt 8192) { $body = $body.Substring(0,8192) }
  }
  return @{
    id = $key; subject = $(if ($private) { 'Private' } elseif ($item.Subject) { [string]$item.Subject } else { 'Untitled' })
    start = $(if ($allDay) { $item.Start.ToString('yyyy-MM-dd') } else { Hyper-Utc $item.Start })
    end = $(if ($allDay) { $item.End.ToString('yyyy-MM-dd') } else { Hyper-Utc $item.End })
    allDay = $allDay; location = $(if ($private) { '' } else { [string]$item.Location }); body = $body
    organizer = $(if ($private) { '' } else { [string]$item.Organizer }); isOrganizer = ([int]$item.MeetingStatus -in @(0,1))
    responseStatus = [int]$item.ResponseStatus; attendees = @($people); attendeeCount = $count; busyStatus = [int]$item.BusyStatus
    isRecurring = [bool]$item.IsRecurring; recurrenceState = $recurrence; isCancelled = ([int]$item.MeetingStatus -in @(5,7)); isPrivate = $private
    joinUrl = $join; lastModified = (Hyper-Utc $item.LastModificationTime)
  }
}
function Hyper-Resolve([string]$key) {
  $parts = $key.Split('|'); $item = $ns.GetItemFromID($parts[0], $calendar.StoreID)
  if ($item.Class -ne 26 -or $item.Parent.EntryID -ne $calendar.EntryID) { throw 'Only items in your default Outlook calendar are supported.' }
  if ($parts.Length -eq 2) { $item = $item.GetRecurrencePattern().GetOccurrence((Hyper-Date $parts[1])) }
  return $item
}
function Hyper-Own($item) {
  if ([int]$item.MeetingStatus -notin @(0,1)) { throw 'Only the organizer can change this meeting. Respond to the invitation instead.' }
  if ([int]$item.RecurrenceState -eq 1) { throw 'Open the series in Outlook. Changes here apply to one occurrence only.' }
}
function Hyper-CheckSend($item, $a) {
  if ($item.Recipients.Count -gt 0 -and !$a.send) { throw 'Confirm sending to attendees first.' }
}
function Hyper-Fields($item, $patch) {
  $names = @($patch.PSObject.Properties.Name)
  $allDay = if ($names -contains 'allDay') { [bool]$patch.allDay } else { [bool]$item.AllDayEvent }
  $start = if ($names -contains 'start') { if ($allDay) { [datetime]::ParseExact($patch.start,'yyyy-MM-dd',$null) } else { Hyper-Date $patch.start } } else { $item.Start }
  $end = if ($names -contains 'end') { if ($allDay) { [datetime]::ParseExact($patch.end,'yyyy-MM-dd',$null) } else { Hyper-Date $patch.end } } else { $item.End }
  if ($end -le $start) { throw 'End must be after start.' }
  if ($names -contains 'subject') { $item.Subject = $patch.subject }
  if ($names -contains 'location') { $item.Location = $patch.location }
  if ($names -contains 'body') {
    if ($item.EntryID -and ([string]$item.Body).Length -gt 8192) { throw 'Open in Outlook to edit this long description.' }
    $item.Body = $patch.body
  }
  $item.AllDayEvent = $allDay; $item.Start = $start; $item.End = $end
}

# Online meetings: the Teams and Skype for Business add-ins have no API, so HyperTask presses their ribbon button on
# the new item, exactly as the owner would, and waits for the add-in to put its join link in. Nothing is saved before.
$HyperUia = $false
function Hyper-OnlineReady($item, [string]$kind, [string]$before) {
  $base = 'http://schemas.microsoft.com/mapi/string/{00020329-0000-0000-C000-000000000046}/'
  $body = [string]$item.Body
  if ($kind -eq 'teams') {
    $url = ''; try { $url = [string]$item.PropertyAccessor.GetProperty($base + 'SkypeTeamsMeetingUrl') } catch {}
    return [bool]$url -and $body -match 'https://teams\.(?:microsoft\.com|live\.com)/'
  }
  foreach ($name in @('OnlineMeetingExternalLink', 'OnlineMeetingConfLink')) { try { if ([string]$item.PropertyAccessor.GetProperty($base + $name)) { return $true } } catch {} }
  return $body.Length -gt $before.Length -and $body -match 'https://\S*(?:meet|lync)\S*' -and $before -notmatch 'https://\S*(?:meet|lync)'
}
function Hyper-Online($item, [string]$kind) {
  if (!$script:HyperUia) { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes; $script:HyperUia = $true }
  $label = if ($kind -eq 'teams') { 'Teams' } else { 'Skype' }
  $names = if ($kind -eq 'teams') { @('Teams Meeting', 'New Teams Meeting') } else { @('Skype Meeting', 'New Skype Meeting', 'Lync Meeting', 'New Lync Meeting') }
  $before = [string]$item.Body
  if (Hyper-OnlineReady $item $kind $before) { return }
  # The button is pressed only inside this item's own window: Outlook gives its handle (IOleWindow on the inspector),
  # so another window with the same title can never receive it. The title is left as it is: the add-in names the
  # online meeting after it.
  if (!('HyperOle' -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices;
[ComImport, Guid("00000114-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IHyperOleWindow { void GetWindow(out IntPtr phwnd); void ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool fEnterMode); }
public static class HyperOle { public static long Hwnd(object o) { IntPtr h; ((IHyperOleWindow)o).GetWindow(out h); return h.ToInt64(); } }'
  }
  $A = [Windows.Automation.AutomationElement]; $scope = [Windows.Automation.TreeScope]
  $buttons = New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
  $item.Display($false)
  $hwnd = 0; try { $hwnd = [HyperOle]::Hwnd($item.GetInspector) } catch {}
  if (!$hwnd) { throw 'The Outlook meeting window could not be identified; nothing was saved or sent.' }
  $window = $A::FromHandle([IntPtr]$hwnd); $button = $null
  for ($t = 0; $t -lt 40 -and !$button; $t++) {
    foreach ($b in $window.FindAll($scope::Descendants, $buttons)) { if ($names -contains [string]$b.Current.Name -and $b.Current.IsEnabled) { $button = $b; break } }
    if (!$button) { Start-Sleep -Milliseconds 250 }
  }
  if (!$button) { throw ('Outlook on this PC has no ' + $label + ' Meeting button (its add-in is not installed or is turned off); nothing was saved or sent.') }
  $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  $ready = $false
  for ($t = 0; $t -lt 80 -and !$ready; $t++) { Start-Sleep -Milliseconds 250; $ready = Hyper-OnlineReady $item $kind $before }
  if (!$ready) { throw ($label + ' did not add a meeting link within 20 seconds (is ' + $label + ' signed in?); nothing was saved or sent.') }
}

# Mail for HyperBots (main only, never the renderer): the default store, mail and meeting messages only, plain text out.
# Reading never opens an item, so its unread state is unchanged; private, confidential, encrypted and rights-protected
# messages return no text.
$HyperMailClasses = @(43, 53, 54, 55, 56, 57, 181)
function Hyper-MailKind($item) { switch ([int]$item.Class) { 43 { 'mail' } 53 { 'meeting_request' } 54 { 'meeting_cancellation' } 181 { 'meeting_forward' } default { 'meeting_response' } } }
function Hyper-Protected($item) { return ([int]$item.Sensitivity -ge 2) -or ([string]$item.MessageClass -match 'SMIME|rpmsg') }
function Hyper-Received($item) { $time = $item.ReceivedTime; if ($time.Year -ge 4000) { $time = $item.LastModificationTime }; return Hyper-Utc $time }
function Hyper-Address($entry, [string]$name, [string]$address, $accessor) {
  $email = ''
  try { $email = [string]$accessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x39FE001E') } catch {}
  if (!$email -and $address -like '*@*') { $email = $address }
  if (!$email -and $null -ne $entry) { try { $user = $entry.GetExchangeUser(); if ($null -ne $user) { $email = [string]$user.PrimarySmtpAddress } } catch {} }
  return @{ name = $name; email = $email }
}
function Hyper-Sender($item) {
  $email = ''
  try { $email = [string]$item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x5D01001F') } catch {}
  if (!$email) { $address = [string]$item.SenderEmailAddress; if ($address -like '*@*') { $email = $address } }
  if (!$email) { try { $user = $item.Sender.GetExchangeUser(); if ($null -ne $user) { $email = [string]$user.PrimarySmtpAddress } } catch {} }
  return @{ name = [string]$item.SenderName; email = $email }
}
function Hyper-MailRecipients($item, [int]$type) {
  $list = New-Object Collections.ArrayList; $count = 0; $all = $item.Recipients
  for ($i = 1; $i -le $all.Count; $i++) {
    $r = $all.Item($i)
    if ([int]$r.Type -ne $type) { continue }
    $count++
    if ($list.Count -lt 50) { $entry = $null; try { $entry = $r.AddressEntry } catch {}; [void]$list.Add((Hyper-Address $entry ([string]$r.Name) ([string]$r.Address) $r.PropertyAccessor)) }
  }
  return @{ list = @($list); count = $count }
}
function Hyper-Emails($item, [int]$type) { return @((Hyper-MailRecipients $item $type).list | ForEach-Object { if ($_.email) { $_.email } else { $_.name } }) }
# Who a reply goes to, as Outlook built it; more than 50 recipients is refused rather than shortened.
function Hyper-ReplyRecipients($mail) {
  if ([int]$mail.Recipients.Count -gt 50) { throw 'Reply all would reach more than 50 recipients; reply in Outlook instead.' }
  Hyper-Resolved $mail
  return @{ to = @(Hyper-Emails $mail 1); cc = @(Hyper-Emails $mail 2) }
}
function Hyper-MailSummary($item, [bool]$preview = $true) {
  $protected = Hyper-Protected $item; $text = ''
  if ($preview -and !$protected) { try { $text = ([string]$item.Body -replace '\s+', ' ').Trim() } catch {}; if ($text.Length -gt 300) { $text = $text.Substring(0, 300) } }
  $attached = $false; try { $attached = [int]$item.Attachments.Count -gt 0 } catch {}
  return @{
    id = [string]$item.EntryID; kind = (Hyper-MailKind $item); subject = [string]$item.Subject; from = (Hyper-Sender $item); received = (Hyper-Received $item)
    unread = [bool]$item.UnRead; importance = [int]$item.Importance; hasAttachments = $attached; protected = $protected; preview = $text
  }
}
# A COM property read that fails loudly: PowerShell's own property access turns a failed read into $null. Collections
# and $null come back as they are.
function Hyper-ComGet($object, [string]$name) { Write-Output -NoEnumerate ($object.GetType().InvokeMember($name, [Reflection.BindingFlags]::GetProperty, $null, $object, $null)) }
# What a reply or forward carries, as a hash: subject, sender name and address, plain and HTML text, and each
# attachment's name, size, type and creation and change times (a replaced or edited attachment gets new times). Every
# part must be read: when one cannot be, this throws, and the message cannot be replied to or forwarded by a bot.
# An approval is for this content only.
function Hyper-MailVersion($item) {
  $parts = @([string](Hyper-ComGet $item 'Subject'), [string](Hyper-ComGet $item 'SenderName'), [string](Hyper-Sender $item).email)
  if (!(Hyper-Protected $item)) {
    $parts += [string](Hyper-ComGet $item 'Body')
    if ([int]$item.Class -eq 43) { $parts += [string](Hyper-ComGet $item 'HTMLBody') }
  }
  $base = 'http://schemas.microsoft.com/mapi/proptag/'
  $files = Hyper-ComGet $item 'Attachments'
  for ($i = 1; $i -le [int](Hyper-ComGet $files 'Count'); $i++) {
    $file = $files.Item($i); $accessor = Hyper-ComGet $file 'PropertyAccessor'
    $times = foreach ($tag in @('0x30070040', '0x30080040')) { $accessor.GetProperty($base + $tag).ToString('o') }
    $parts += ([string](Hyper-ComGet $file 'DisplayName') + '|' + [string](Hyper-ComGet $file 'Size') + '|' + [string](Hyper-ComGet $file 'Type') + '|' + ($times -join '|'))
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($parts -join [string][char]0))).Replace('-', '') } finally { $sha.Dispose() }
}
# The version a reply or forward is checked against; when the message cannot be fully read it cannot be checked.
function Hyper-CheckVersion($item, [string]$expected) {
  $now = ''; try { $now = Hyper-MailVersion $item } catch { throw 'Outlook could not read all of this message (its text or attachment details), so it cannot be checked against the approval; nothing was sent.' }
  if ($now -ne $expected) { throw 'The message changed after it was approved; nothing was sent.' }
}
function Hyper-MailResolve([string]$id) {
  $item = $null
  try { $item = $ns.GetItemFromID($id, $ns.DefaultStore.StoreID) } catch { throw 'That message is no longer in your mailbox.' }
  if ([int]$item.Class -notin $HyperMailClasses) { throw 'Only mail and meeting messages in your mailbox are supported.' }
  return $item
}
function Hyper-Folder([string]$name) { switch ($name) { 'inbox' { return $ns.GetDefaultFolder(6) } 'sent' { return $ns.GetDefaultFolder(5) } 'drafts' { return $ns.GetDefaultFolder(16) } default { throw 'Unknown mail folder.' } } }
# The account whose store is the default one sends by default; its address is what the owner approves.
function Hyper-Account {
  $store = [string]$ns.DefaultStore.StoreID; $first = $null
  foreach ($account in $ns.Accounts) { if ($null -eq $first) { $first = $account }; try { if ([string]$account.DeliveryStore.StoreID -eq $store) { return $account } } catch {} }
  return $first
}
function Hyper-SendAccount([string]$address) {
  foreach ($account in $ns.Accounts) { if ([string]$account.SmtpAddress -eq $address) { return $account } }
  throw 'The approved sending account is no longer in Outlook; nothing was sent.'
}
# An existing meeting sends from its own account; it must be the approved one, and one that cannot be read is refused.
function Hyper-SameSender($item, [string]$address) {
  [void](Hyper-SendAccount $address)
  # Read through Hyper-ComGet: a failed read must stop here, never look like the default account ($null).
  $current = $null; $smtp = ''
  try { $current = Hyper-ComGet $item 'SendUsingAccount'; if ($null -ne $current) { $smtp = [string](Hyper-ComGet $current 'SmtpAddress') } }
  catch { throw 'Could not check which Outlook account this meeting sends from; nothing was changed.' }
  if ($null -ne $current -and $smtp -ne $address) { throw 'This meeting sends from another Outlook account than the approved one; nothing was changed.' }
}
# Plain text to HTML: encoded, one paragraph per line, right to left when the line starts with Hebrew or Arabic.
function Hyper-Html([string]$text) {
  $paragraphs = foreach ($line in $text.Replace([string][char]13, '').Split([char]10)) {
    $dir = if ($line -match '^[^A-Za-z\p{IsHebrew}\p{IsArabic}]*[\p{IsHebrew}\p{IsArabic}]') { 'rtl' } else { 'ltr' }
    $encoded = [Net.WebUtility]::HtmlEncode($line); if (!$encoded) { $encoded = '&nbsp;' }
    '<p dir="' + $dir + '" style="margin:0">' + $encoded + '</p>'
  }
  return '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">' + ($paragraphs -join '') + '</div>'
}
# The owner's text goes above the quoted original, which keeps its own formatting.
function Hyper-Prepend($item, [string]$text) {
  if (!$text) { return }
  $gap = [Environment]::NewLine + [Environment]::NewLine
  if ([int]$item.Class -ne 43 -or [int]$item.BodyFormat -eq 1) { $item.Body = $text + $gap + [string]$item.Body; return }
  if ([int]$item.BodyFormat -ne 2) { $item.BodyFormat = 2 }
  $html = [string]$item.HTMLBody; $block = (Hyper-Html $text) + '<br>'
  $open = [regex]::Match($html, '<body[^>]*>', 'IgnoreCase')
  $item.HTMLBody = if ($open.Success) { $html.Insert($open.Index + $open.Length, $block) } else { $block + $html }
}
function Hyper-AddRecipients($item, $list, [int]$type) { foreach ($address in @($list)) { $recipient = $item.Recipients.Add([string]$address); $recipient.Type = $type } }
function Hyper-Resolved($item) { if (!$item.Recipients.ResolveAll()) { throw 'A recipient could not be resolved in Outlook; nothing was sent.' } }
# From the first Save, Send or Delete on, a failure may come after Outlook made the change: the reply then says 'unknown'.
$HyperCommitted = $false
function Hyper-Commit { $script:HyperCommitted = $true }
function Hyper-Deliver($item, [string]$delivery) { Hyper-Commit; if ($delivery -eq 'draft') { $item.Save() } else { $item.Send() } }
function Hyper-Discard($item) { try { $item.Close(1) } catch {} }
# The invitation an attendee received, found by the series' global id in the Inbox and then Deleted Items. An
# occurrence has its series' EntryID, so the series item is read by that id.
function Hyper-Invitation($appointment) {
  $target = $ns.GetItemFromID([string]$appointment.EntryID, $calendar.StoreID)
  $global = [string]$target.GlobalAppointmentID
  foreach ($folder in @(6, 3)) {
    $items = $ns.GetDefaultFolder($folder).Items.Restrict("[MessageClass] = 'IPM.Schedule.Meeting.Request'")
    $items.Sort('[ReceivedTime]', $true); $seen = 0; $request = $items.GetFirst()
    while ($null -ne $request -and $seen -lt 200) {
      $seen++
      try { $other = $request.GetAssociatedAppointment($false); if ($null -ne $other -and [string]$other.GlobalAppointmentID -eq $global) { return $request } } catch {}
      $request = $items.GetNext()
    }
  }
  throw 'The original invitation email is no longer in your Inbox or Deleted Items, so Outlook cannot forward this meeting. Ask the organizer to invite them.'
}
function Hyper-Meeting($message) {
  $appointment = $null; try { $appointment = $message.GetAssociatedAppointment($false) } catch {}
  if ($null -eq $appointment) { return $null }
  $allDay = [bool]$appointment.AllDayEvent; $event = $null
  try { if ([string]$appointment.Parent.EntryID -eq [string]$calendar.EntryID) { $event = [string]$appointment.EntryID } } catch {}
  return @{
    start = $(if ($allDay) { $appointment.Start.ToString('yyyy-MM-dd') } else { Hyper-Utc $appointment.Start }); end = $(if ($allDay) { $appointment.End.ToString('yyyy-MM-dd') } else { Hyper-Utc $appointment.End })
    allDay = $allDay; location = [string]$appointment.Location; organizer = [string]$appointment.Organizer; responseStatus = [int]$appointment.ResponseStatus
    isRecurring = [bool]$appointment.IsRecurring; eventId = $event; lastModified = (Hyper-Utc $appointment.LastModificationTime)
  }
}

# Directory operations use AD independently of Outlook/calendar availability.
function Hyper-LdapEscape([string]$text) {
  $builder = New-Object Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    switch ([int]$ch) { 0 { [void]$builder.Append('\00') } 40 { [void]$builder.Append('\28') } 41 { [void]$builder.Append('\29') } 42 { [void]$builder.Append('\2a') } 92 { [void]$builder.Append('\5c') } default { [void]$builder.Append($ch) } }
  }
  return $builder.ToString()
}
function Hyper-AdValue($result, [string]$field) { $values = $result.Properties[$field]; if ($null -ne $values -and $values.Count -gt 0) { return [string]$values[0] }; return '' }
function Hyper-AdPerson($result) {
  $p = $result.Properties
  $person = @{ name = (Hyper-AdValue $result 'displayname'); email = (Hyper-AdValue $result 'mail'); title = (Hyper-AdValue $result 'title'); department = (Hyper-AdValue $result 'department'); phone = (Hyper-AdValue $result 'telephonenumber'); office = (Hyper-AdValue $result 'physicaldeliveryofficename'); company = (Hyper-AdValue $result 'company'); source = 'ad' }
  if (!$person.name) { $person.name = $person.email }
  if ($null -ne $p['thumbnailphoto'] -and $p['thumbnailphoto'].Count -gt 0) {
    [byte[]]$photo = $p['thumbnailphoto'][0]
    if ($photo.Length -gt 3 -and $photo.Length -le 65536) {
      $mime = if ($photo[0] -eq 137 -and $photo[1] -eq 80) { 'png' } elseif ($photo[0] -eq 255 -and $photo[1] -eq 216) { 'jpeg' } else { '' }
      if ($mime) { $person.photo = 'data:image/' + $mime + ';base64,' + [Convert]::ToBase64String($photo) }
    }
  }
  return $person
}
function Hyper-GalPeople([string]$query) {
  $recipient = $null; $entry = $null; $user = $null
  Connect-Hyper
  try {
    $recipient = $ns.CreateRecipient($query); $recipient.Resolve()
    if (!$recipient.Resolved) { return }
    $entry = $recipient.AddressEntry; $user = $entry.GetExchangeUser()
    if ($null -ne $user -and $user.PrimarySmtpAddress) { return @{ name = [string]$user.Name; email = [string]$user.PrimarySmtpAddress; title = [string]$user.JobTitle; department = [string]$user.Department; phone = [string]$user.BusinessTelephoneNumber; office = [string]$user.OfficeLocation; company = [string]$user.CompanyName; source = 'outlook' } }
  } catch { throw 'Employee directory is unavailable. Connect to the company network or VPN and try again.' }
  finally { foreach ($com in @($user, $entry, $recipient)) { if ($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($com) } } }
}
function Hyper-People([string]$query, [int]$limit, [bool]$lookup) {
  $searcher = $null; $results = $null; $root = $null
  try {
    Add-Type -AssemblyName System.DirectoryServices
    $root = New-Object DirectoryServices.DirectoryEntry
    $searcher = New-Object DirectoryServices.DirectorySearcher($root)
    $escaped = Hyper-LdapEscape $query
    $match = if ($lookup) { '(mail=' + $escaped + ')' } else { '(anr=' + $escaped + ')' }
    $searcher.Filter = '(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2))(mail=*)' + $match + ')'
    $searcher.SizeLimit = $limit; $searcher.ServerTimeLimit = [timespan]::FromSeconds(5); $searcher.ClientTimeout = [timespan]::FromSeconds(7)
    foreach ($field in @('displayName','mail','title','department','telephoneNumber','physicalDeliveryOfficeName','company','thumbnailPhoto')) { [void]$searcher.PropertiesToLoad.Add($field) }
    $results = $searcher.FindAll()
    foreach ($result in $results) { Hyper-AdPerson $result }
  } catch { Hyper-GalPeople $query }
  finally { if ($results) { $results.Dispose() }; if ($searcher) { $searcher.Dispose() }; if ($root) { $root.Dispose() } }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $request = $null; $HyperCommitted = $false
  try {
    $request = ConvertFrom-Json -InputObject $line; $a = $request.args; $value = $null
    if ($request.op -notlike 'people.*') { Connect-Hyper }
    switch ($request.op) {
      'people.search' { $value = @(Hyper-People $a.query ([Math]::Min(20, [int]$a.limit)) $false) }
      'people.lookup' { $found = @(Hyper-People $a.email 1 $true); $value = if ($found.Count) { $found[0] } else { $null } }
      'status' {
        $email = ''; try { $email = [string]$ns.Accounts.Item(1).SmtpAddress } catch {}
        $current = Hyper-ComGet $ns 'CurrentUser'; $name = [string](Hyper-ComGet $current 'Name')
        if (!$name) { throw 'Outlook profile is still loading.' }
        $value = @{ available = $true; userName = $name; email = $email }
      }
      'list' {
        $items = $calendar.Items; $items.Sort('[Start]'); $items.IncludeRecurrences = $true
        $start = Hyper-Date $a.start; $end = Hyper-Date $a.end
        # Outlook may use a different short-date order than the host; month names avoid ambiguity.
        $filter = "[Start] < '" + $end.ToString('dd MMM yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture) + "' AND [End] > '" + $start.ToString('dd MMM yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture) + "'"
        $found = $items.Restrict($filter); $list = New-Object Collections.ArrayList; $seen = 0
        foreach ($item in $found) {
          if ($seen++ -ge 2000) { break }
          try { if ([int]$item.MeetingStatus -notin @(5,7)) { [void]$list.Add((Hyper-Map $item)) } }
          finally { if ($null -ne $item) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($item) } }
        }
        $value = @($list)
      }
      'create' {
        if ($a.attendees.Count -gt 0 -and !$a.send) { throw 'Confirm sending to attendees first.' }
        $account = $null; if ($a.account) { $account = Hyper-SendAccount ([string]$a.account) }
        $item = $outlook.CreateItem(1); $done = $false
        try {
          Hyper-Fields $item $a
          if ($null -ne $account) { $item.SendUsingAccount = $account }
          if ($a.onlineMeeting) { Hyper-Online $item ([string]$a.onlineMeeting) }
          if ($a.attendees.Count -gt 0) {
            $item.MeetingStatus = 1
            foreach ($email in $a.attendees) { [void]$item.Recipients.Add($email) }
            if (!$item.Recipients.ResolveAll()) { throw 'An attendee could not be resolved.' }
            Hyper-Commit; $item.Send()
          } else { Hyper-Commit; $item.Save() }
          $done = $true
        } catch { if (!$done -and $a.onlineMeeting) { Hyper-Discard $item }; throw }
        $value = Hyper-Map $item
        # The meeting window opened for the add-in closes once the item is saved; a sent item closes its own window.
        if ($a.onlineMeeting) { try { $item.Close(0) } catch {} }
      }
      'update' {
        $item = Hyper-Resolve $a.id; Hyper-Own $item; Hyper-CheckSend $item $a
        if ($a.account) { Hyper-SameSender $item ([string]$a.account) }
        if ((Hyper-Utc $item.LastModificationTime) -ne $a.expectedLastModified) { throw 'hyper_conflict' }
        Hyper-Fields $item $a.patch; Hyper-Commit; $item.Save()
        if ($item.Recipients.Count -gt 0) { $item.Send() }
        $value = Hyper-Map $item
      }
      'delete' {
        $item = Hyper-Resolve $a.id; Hyper-Own $item; Hyper-CheckSend $item $a
        Hyper-Commit
        if ($item.Recipients.Count -gt 0) { $item.MeetingStatus = 5; $item.Send() }
        $item.Delete()
      }
      'respond' {
        $item = Hyper-Resolve $a.id
        if ([int]$item.MeetingStatus -ne 3 -or [int]$item.RecurrenceState -eq 1) { throw 'Only received meeting occurrences can be responded to.' }
        $code = switch ($a.response) { 'accept' { 3 } 'tentative' { 2 } 'decline' { 4 } default { throw 'Invalid response.' } }
        $message = $item.Respond($code, $true, $false)
        Hyper-Commit
        if ($a.send) { $message.Send() } else { $message.Close(1) }
        if ($a.response -eq 'decline') { $item.Delete() } else { $item.Save() }
      }
      'event.get' { $value = Hyper-Map (Hyper-Resolve $a.id) }
      'event.forward' {
        $account = Hyper-SendAccount ([string]$a.account); $item = Hyper-Resolve $a.id
        if ([int]$item.MeetingStatus -in @(5, 7)) { throw 'This meeting was cancelled.' }
        if ((Hyper-Utc $item.LastModificationTime) -ne [string]$a.expect) { throw 'The meeting changed after it was approved; nothing was sent.' }
        if ([int]$item.MeetingStatus -in @(0, 1)) {
          # The organizer forwards by inviting: the update goes to every attendee, as in Outlook.
          Hyper-Own $item; Hyper-SameSender $item ([string]$a.account); $done = $false
          try {
            $item.MeetingStatus = 1
            Hyper-AddRecipients $item $a.to 1; Hyper-Resolved $item
            Hyper-Commit; $item.Save(); $item.Send(); $done = $true
          } catch { if (!$done) { Hyper-Discard $item }; throw }
          $value = @{ mode = 'organizer'; to = @($a.to) }
        } else {
          $forward = (Hyper-Invitation $item).Forward(); $done = $false
          try {
            $forward.SendUsingAccount = $account
            Hyper-AddRecipients $forward $a.to 1; Hyper-Resolved $forward; Hyper-Prepend $forward ([string]$a.comment)
            $sentTo = Hyper-Emails $forward 1
            Hyper-Commit; $forward.Send(); $done = $true
          } catch { if (!$done) { Hyper-Discard $forward }; throw }
          $value = @{ mode = 'invitation'; to = @($sentTo) }
        }
      }
      'mail.account' {
        $account = Hyper-Account
        if ($null -eq $account) { throw 'Outlook has no mail account.' }
        $value = @{ address = [string]$account.SmtpAddress; name = [string]$account.DisplayName }
      }
      'mail.list' {
        $folder = Hyper-Folder ([string]$a.folder)
        $field = if ($a.folder -eq 'drafts') { '[LastModificationTime]' } else { '[ReceivedTime]' }
        $filters = @()
        if ($a.since) { $filters += $field + " >= '" + (Hyper-Date $a.since).ToString('dd MMM yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture) + "'" }
        if ($a.unreadOnly) { $filters += '[UnRead] = True' }
        $items = $folder.Items
        if ($filters.Count) { $items = $items.Restrict($filters -join ' AND ') }
        $items.Sort($field, $true)
        $list = New-Object Collections.ArrayList; $seen = 0; $item = $items.GetFirst()
        while ($null -ne $item -and $seen -lt 500 -and $list.Count -lt [int]$a.max) {
          $seen++
          try {
            if ([int]$item.Class -in $HyperMailClasses) {
              $match = !$a.subject -or ([string]$item.Subject).IndexOf([string]$a.subject, [StringComparison]::OrdinalIgnoreCase) -ge 0
              if ($match -and $a.from) { $sender = Hyper-Sender $item; $match = ($sender.name + ' ' + $sender.email).IndexOf([string]$a.from, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
              if ($match) { [void]$list.Add((Hyper-MailSummary $item)) }
            }
          } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
          $item = $items.GetNext()
        }
        $value = @($list)
      }
      'mail.read' {
        # A header read (maxChars 0, for an approval card) takes no text from the message.
        $item = Hyper-MailResolve $a.id; $value = Hyper-MailSummary $item ([int]$a.maxChars -gt 0); $value.version = ''; try { $value.version = Hyper-MailVersion $item } catch {}
        $to = Hyper-MailRecipients $item 1; $cc = Hyper-MailRecipients $item 2; $replyTo = New-Object Collections.ArrayList
        try { $all = $item.ReplyRecipients; for ($i = 1; $i -le [Math]::Min($all.Count, 50); $i++) { $r = $all.Item($i); $entry = $null; try { $entry = $r.AddressEntry } catch {}; [void]$replyTo.Add((Hyper-Address $entry ([string]$r.Name) ([string]$r.Address) $r.PropertyAccessor)) } } catch {}
        $body = ''; $truncated = $false; $files = New-Object Collections.ArrayList
        if ([int]$a.maxChars -gt 0) {
          if (!$value.protected) { try { $body = [string]$item.Body } catch {}; if ($body.Length -gt [int]$a.maxChars) { $body = $body.Substring(0, [int]$a.maxChars); $truncated = $true } }
          try {
            $attachments = $item.Attachments
            for ($i = 1; $i -le $attachments.Count -and $files.Count -lt 50; $i++) {
              $file = $attachments.Item($i); $hidden = $false
              try { $hidden = [bool]$file.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x7FFE000B') } catch {}
              if (!$hidden) { [void]$files.Add(@{ name = [string]$file.DisplayName; size = [int]$file.Size }) }
            }
          } catch {}
        }
        $value.to = $to.list; $value.toCount = $to.count; $value.cc = $cc.list; $value.ccCount = $cc.count; $value.replyTo = @($replyTo)
        $value.body = $body; $value.bodyTruncated = $truncated; $value.attachments = @($files)
        $value.meeting = $(if ([int]$item.Class -eq 43 -or $value.protected) { $null } else { Hyper-Meeting $item })
      }
      'mail.send' {
        $account = Hyper-SendAccount ([string]$a.account); $mail = $outlook.CreateItem(0); $done = $false
        try {
          $mail.SendUsingAccount = $account
          Hyper-AddRecipients $mail $a.to 1; Hyper-AddRecipients $mail $a.cc 2; Hyper-Resolved $mail
          $mail.Subject = [string]$a.subject; $mail.BodyFormat = 2; $mail.HTMLBody = '<html><body>' + (Hyper-Html ([string]$a.body)) + '</body></html>'
          $sentTo = Hyper-Emails $mail 1; $sentCc = Hyper-Emails $mail 2
          Hyper-Deliver $mail ([string]$a.delivery); $done = $true
        } catch { if (!$done) { Hyper-Discard $mail }; throw }
        $value = @{ delivery = [string]$a.delivery; subject = [string]$a.subject; to = @($sentTo); cc = @($sentCc) }
      }
      'mail.recipients' {
        $source = Hyper-MailResolve $a.id
        $mail = if ($a.replyAll) { $source.ReplyAll() } else { $source.Reply() }
        try { $value = Hyper-ReplyRecipients $mail } finally { Hyper-Discard $mail }
      }
      'mail.reply' {
        $account = Hyper-SendAccount ([string]$a.account); $source = Hyper-MailResolve $a.id
        Hyper-CheckVersion $source ([string]$a.version)
        $mail = if ($a.replyAll) { $source.ReplyAll() } else { $source.Reply() }; $done = $false
        try {
          $now = Hyper-ReplyRecipients $mail
          $got = @(@($now.to) + @($now.cc) | ForEach-Object { ([string]$_).ToLowerInvariant() } | Sort-Object) -join ';'
          $want = @(@($a.expect) | ForEach-Object { ([string]$_).ToLowerInvariant() } | Sort-Object) -join ';'
          if ($got -ne $want) { throw 'The reply would now go to other recipients than the ones approved; nothing was sent.' }
          $mail.SendUsingAccount = $account; Hyper-Prepend $mail ([string]$a.body)
          $sentTo = $now.to; $sentCc = $now.cc; $subject = [string]$mail.Subject
          Hyper-Deliver $mail ([string]$a.delivery); $done = $true
        } catch { if (!$done) { Hyper-Discard $mail }; throw }
        $value = @{ delivery = [string]$a.delivery; subject = $subject; to = @($sentTo); cc = @($sentCc) }
      }
      'mail.forward' {
        $account = Hyper-SendAccount ([string]$a.account); $source = Hyper-MailResolve $a.id
        Hyper-CheckVersion $source ([string]$a.version)
        $mail = $source.Forward(); $done = $false
        try {
          $mail.SendUsingAccount = $account
          Hyper-AddRecipients $mail $a.to 1; Hyper-AddRecipients $mail $a.cc 2; Hyper-Resolved $mail; Hyper-Prepend $mail ([string]$a.body)
          $sentTo = Hyper-Emails $mail 1; $sentCc = Hyper-Emails $mail 2; $subject = [string]$mail.Subject
          Hyper-Deliver $mail ([string]$a.delivery); $done = $true
        } catch { if (!$done) { Hyper-Discard $mail }; throw }
        $value = @{ delivery = [string]$a.delivery; subject = $subject; to = @($sentTo); cc = @($sentCc) }
      }
      'meeting.respond' {
        $account = Hyper-SendAccount ([string]$a.account)
        $first = $null; try { $first = $ns.GetItemFromID($a.id.Split('|')[0], $ns.DefaultStore.StoreID) } catch { throw 'That meeting is no longer in your mailbox.' }
        # The appointment is never added back here: answering must not recreate a meeting that was removed meanwhile.
        if ([int]$first.Class -eq 26) { $item = Hyper-Resolve $a.id }
        elseif ([int]$first.Class -eq 53) { $item = $first.GetAssociatedAppointment($false); if ($null -eq $item) { throw 'This invitation is no longer in your calendar; nothing was sent.' } }
        else { throw 'Only meeting invitations can be answered.' }
        if ([int]$item.MeetingStatus -in @(5, 7)) { throw 'This meeting was cancelled.' }
        if ([int]$item.MeetingStatus -ne 3) { throw 'You organize this meeting, so there is no invitation to answer.' }
        if ((Hyper-Utc $item.LastModificationTime) -ne [string]$a.expect) { throw 'The meeting changed after it was approved; nothing was sent.' }
        $code = switch ($a.response) { 'accept' { 3 } 'tentative' { 2 } 'decline' { 4 } default { throw 'Invalid response.' } }
        $subject = [string]$item.Subject
        $reply = $item.Respond($code, $true, $false); $done = $false
        try {
          $reply.SendUsingAccount = $account
          $text = [string]$a.comment
          if ($a.proposed) {
            # A counter-proposal as Outlook writes one (PSETID_Appointment proposed start/end, duration, flag); the
            # time is also written in the text so the organizer sees it on any client.
            $start = Hyper-Date $a.proposed.start; $end = Hyper-Date $a.proposed.end; $culture = [Globalization.CultureInfo]::InvariantCulture
            $line = 'Proposed new time: ' + $start.ToString('ddd d MMM yyyy HH:mm', $culture) + ' - ' + $(if ($end.Date -eq $start.Date) { $end.ToString('HH:mm', $culture) } else { $end.ToString('ddd d MMM yyyy HH:mm', $culture) }) + ' (' + [TimeZoneInfo]::Local.Id + ')'
            $text = if ($text) { $line + [Environment]::NewLine + [Environment]::NewLine + $text } else { $line }
            $base = 'http://schemas.microsoft.com/mapi/id/{00062002-0000-0000-C000-000000000046}/'; $props = $reply.PropertyAccessor
            $props.SetProperty($base + '82500040', $props.LocalTimeToUTC($start)); $props.SetProperty($base + '82510040', $props.LocalTimeToUTC($end))
            $props.SetProperty($base + '82560003', [int]($end - $start).TotalMinutes); $props.SetProperty($base + '8257000B', $true)
            $reply.Subject = 'New Time Proposed: ' + $subject
          }
          if ($text) { $reply.Body = $text }
          Hyper-Deliver $reply ([string]$a.delivery); $done = $true
        } catch { if (!$done) { Hyper-Discard $reply }; throw }
        # As in the calendar view: a sent decline removes the meeting; otherwise the new answer is kept.
        try { if ($a.response -eq 'decline' -and $a.delivery -eq 'send') { $item.Delete() } else { $item.Save() } } catch {}
        $value = @{ delivery = [string]$a.delivery; response = [string]$a.response; subject = $subject }
      }
      'open' { $item = Hyper-Resolve $a.id; $item.Display() }
      default { throw 'Unknown Outlook operation.' }
    }
    $reply = @{ id = [string]$request.id; ok = $true; value = $value }
  } catch {
    $reason = $_.Exception.Message
    if (Hyper-Disconnected $_.Exception) { Reset-Hyper; $reason = 'Outlook disconnected. Open Outlook to reconnect. RPC_E_DISCONNECTED: ' + $reason }
    if ($request.op -eq 'status') { $reply = @{ id = [string]$request.id; ok = $true; value = @{ available = $false; userName = ''; email = ''; reason = $reason } }; Reset-Hyper }
    elseif ($HyperCommitted -and $reason -ne 'hyper_conflict') { $reply = @{ id = [string]$request.id; ok = $false; kind = 'unknown'; message = ('Outlook failed after it began saving or sending, so the change may have happened. Check Outlook before trying again. ' + $reason) } }
    else { $reply = @{ id = [string]$request.id; ok = $false; kind = $(if ($reason -eq 'hyper_conflict') { 'conflict' } else { 'state' }); message = $reason } }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $reply -Depth 10 -Compress))
}
`;
