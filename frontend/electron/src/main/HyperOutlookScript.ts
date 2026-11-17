export const HyperOutlookScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$outlook = $null; $ns = $null; $calendar = $null
function Connect-Hyper {
  if ($null -ne $calendar) { return }
  try {
    $script:outlook = New-Object -ComObject Outlook.Application
    $script:ns = $outlook.GetNamespace('MAPI')
    $script:calendar = $ns.GetDefaultFolder(9)
  } catch { $script:calendar = $null; throw 'Classic Outlook for Windows is required. Run HyperTask and Outlook as the same Windows user without elevation.' }
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
  $categories = @(); if (!$private) { $categories = @(Hyper-Categories $item) }
  return @{
    id = $key; subject = $(if ($private) { 'Private' } elseif ($item.Subject) { [string]$item.Subject } else { 'Untitled' })
    start = $(if ($allDay) { $item.Start.ToString('yyyy-MM-dd') } else { Hyper-Utc $item.Start })
    end = $(if ($allDay) { $item.End.ToString('yyyy-MM-dd') } else { Hyper-Utc $item.End })
    allDay = $allDay; location = $(if ($private) { '' } else { [string]$item.Location }); body = $body
    organizer = $(if ($private) { '' } else { [string]$item.Organizer }); isOrganizer = ([int]$item.MeetingStatus -in @(0,1))
    responseStatus = [int]$item.ResponseStatus; attendees = @($people); attendeeCount = $count; busyStatus = [int]$item.BusyStatus
    isRecurring = [bool]$item.IsRecurring; recurrenceState = $recurrence; isCancelled = ([int]$item.MeetingStatus -in @(5,7)); isPrivate = $private
    joinUrl = $join; categories = @($categories); lastModified = (Hyper-Utc $item.LastModificationTime)
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
function Hyper-Categories($item) { return @(([string]$item.Categories).Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
# Outlook has one master category list; HyperTask keeps its colour category's Outlook colour in step with the colour the user chose.
function Hyper-Category([string]$name, [int]$color) {
  $categories = $ns.Categories
  for ($i = 1; $i -le $categories.Count; $i++) {
    $category = $categories.Item($i)
    if ([string]$category.Name -eq $name) { if ([int]$category.Color -ne $color) { $category.Color = $color }; return }
  }
  [void]$categories.Add($name, $color)
}
# The chosen colour goes first (Outlook colours an event by its first category); other HyperTask colours and the user's own categories are kept.
function Hyper-Color($item, $color) {
  $owned = @($color.owned); $names = @(Hyper-Categories $item | Where-Object { $owned -notcontains $_ })
  if ($color.name) { Hyper-Category ([string]$color.name) ([int]$color.outlook); $names = @([string]$color.name) + $names }
  $item.Categories = $names -join ', '
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
  if ($names -contains 'color') { Hyper-Color $item $patch.color }
  $item.AllDayEvent = $allDay; $item.Start = $start; $item.End = $end
}

# Directory operations use AD independently of Outlook/calendar availability. No mail folders are accessed.
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
  try {
    if (!$script:ns) { $script:outlook = New-Object -ComObject Outlook.Application; $script:ns = $outlook.GetNamespace('MAPI') }
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
  $request = $null
  try {
    $request = ConvertFrom-Json -InputObject $line; $a = $request.args; $value = $null
    if ($request.op -notlike 'people.*') { Connect-Hyper }
    switch ($request.op) {
      'people.search' { $value = @(Hyper-People $a.query ([Math]::Min(20, [int]$a.limit)) $false) }
      'people.lookup' { $found = @(Hyper-People $a.email 1 $true); $value = if ($found.Count) { $found[0] } else { $null } }
      'status' {
        $email = ''; try { $email = [string]$ns.Accounts.Item(1).SmtpAddress } catch {}
        $value = @{ available = $true; userName = [string]$ns.CurrentUser.Name; email = $email }
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
        $item = $outlook.CreateItem(1)
        Hyper-Fields $item $a
        if ($a.attendees.Count -gt 0) {
          $item.MeetingStatus = 1
          foreach ($email in $a.attendees) { [void]$item.Recipients.Add($email) }
          if (!$item.Recipients.ResolveAll()) { throw 'An attendee could not be resolved.' }
          $item.Send()
        } else { $item.Save() }
        $value = Hyper-Map $item
      }
      'update' {
        $item = Hyper-Resolve $a.id
        # A colour-only change is the user's own category: invitations can be coloured too, and it saves without re-sending the meeting.
        $content = @($a.patch.PSObject.Properties.Name | Where-Object { $_ -ne 'color' }).Count -gt 0
        if ($content) { Hyper-Own $item; Hyper-CheckSend $item $a }
        elseif ([int]$item.RecurrenceState -eq 1) { throw 'Open the series in Outlook. Changes here apply to one occurrence only.' }
        if ((Hyper-Utc $item.LastModificationTime) -ne $a.expectedLastModified) { throw 'hyper_conflict' }
        if ($content) { Hyper-Fields $item $a.patch } else { Hyper-Color $item $a.patch.color }
        $item.Save()
        if ($content -and $item.Recipients.Count -gt 0) { $item.Send() }
        $value = Hyper-Map $item
      }
      'delete' {
        $item = Hyper-Resolve $a.id; Hyper-Own $item; Hyper-CheckSend $item $a
        if ($item.Recipients.Count -gt 0) { $item.MeetingStatus = 5; $item.Send() }
        $item.Delete()
      }
      'respond' {
        $item = Hyper-Resolve $a.id
        if ([int]$item.MeetingStatus -ne 3 -or [int]$item.RecurrenceState -eq 1) { throw 'Only received meeting occurrences can be responded to.' }
        $code = switch ($a.response) { 'accept' { 3 } 'tentative' { 2 } 'decline' { 4 } default { throw 'Invalid response.' } }
        $message = $item.Respond($code, $true, $false)
        if ($a.send) { $message.Send() } else { $message.Close(1) }
        if ($a.response -eq 'decline') { $item.Delete() } else { $item.Save() }
      }
      'open' { $item = Hyper-Resolve $a.id; $item.Display() }
      default { throw 'Unknown Outlook operation.' }
    }
    $reply = @{ id = [string]$request.id; ok = $true; value = $value }
  } catch {
    $reason = $_.Exception.Message
    if ($request.op -eq 'status') { $reply = @{ id = [string]$request.id; ok = $true; value = @{ available = $false; userName = ''; email = ''; reason = $reason } }; $calendar = $null }
    else { $reply = @{ id = [string]$request.id; ok = $false; kind = $(if ($reason -eq 'hyper_conflict') { 'conflict' } else { 'state' }); message = $reason } }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $reply -Depth 10 -Compress))
}
`;
