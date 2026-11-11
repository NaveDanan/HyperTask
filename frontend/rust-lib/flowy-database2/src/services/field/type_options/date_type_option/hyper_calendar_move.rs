use super::date_filter::DateCellChangeset;
use super::hyper_date_timezone::HyperDateTimezone;
use chrono::DateTime;
use collab_database::fields::date_type_option::DateCellData;
use flowy_error::{ErrorCode, FlowyError, FlowyResult};

pub(crate) fn hyper_calendar_move(
  existing: &DateCellData,
  timezone_id: &str,
  timestamp: i64,
  explicit_end: Option<i64>,
) -> FlowyResult<DateCellChangeset> {
  let invalid = || {
    FlowyError::new(
      ErrorCode::InvalidParams,
      "Calendar range move requires valid, unambiguous paired dates",
    )
  };
  if !existing.reminder_id.is_empty() {
    return Err(FlowyError::new(
      ErrorCode::FieldInvalidOperation,
      "Move the reminder schedule together with its date",
    ));
  }
  if DateTime::from_timestamp(timestamp, 0).is_none() {
    return Err(invalid());
  }
  if !existing.is_range {
    if explicit_end.is_some() {
      return Err(invalid());
    }
    return Ok(DateCellChangeset {
      timestamp: Some(timestamp),
      ..Default::default()
    });
  }
  let start = existing.timestamp.ok_or_else(invalid)?;
  let end = existing.end_timestamp.ok_or_else(invalid)?;
  if end < start {
    return Err(invalid());
  }
  let zone = HyperDateTimezone::new(timezone_id);
  let end_timestamp = if let Some(end) = explicit_end {
    if DateTime::from_timestamp(end, 0).is_none() {
      return Err(invalid());
    }
    end
  } else {
    let old_start = zone.local_datetime(start).ok_or_else(invalid)?;
    let old_end = zone.local_datetime(end).ok_or_else(invalid)?;
    let new_start = zone.local_datetime(timestamp).ok_or_else(invalid)?;
    let days = old_end.date().signed_duration_since(old_start.date());
    let new_end = new_start
      .date()
      .checked_add_signed(days)
      .ok_or_else(invalid)?
      .and_time(old_end.time());
    zone.timestamp(new_end).ok_or_else(invalid)?
  };
  if end_timestamp < timestamp {
    return Err(invalid());
  }
  Ok(DateCellChangeset {
    timestamp: Some(timestamp),
    end_timestamp: Some(end_timestamp),
    ..Default::default()
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::TimeZone;
  use chrono_tz::America::New_York;
  fn instant(y: i32, m: u32, d: u32, h: u32, minute: u32) -> i64 {
    New_York
      .with_ymd_and_hms(y, m, d, h, minute, 5)
      .single()
      .unwrap()
      .timestamp()
  }
  #[test]
  fn hyper_calendar_move_keeps_calendar_span_across_dst() {
    let source = DateCellData {
      timestamp: Some(instant(2026, 3, 7, 0, 0)),
      end_timestamp: Some(instant(2026, 3, 9, 0, 0)),
      is_range: true,
      ..Default::default()
    };
    let moved = hyper_calendar_move(
      &source,
      "America/New_York",
      instant(2026, 3, 10, 0, 0),
      None,
    )
    .unwrap();
    assert_eq!(moved.end_timestamp, Some(instant(2026, 3, 12, 0, 0)));
    assert_eq!(
      moved.end_timestamp.unwrap() - moved.timestamp.unwrap(),
      48 * 3600
    );
    assert_eq!(
      source.end_timestamp.unwrap() - source.timestamp.unwrap(),
      47 * 3600
    );
  }
  #[test]
  fn hyper_calendar_move_rejects_unsafe_derivation_and_preserves_explicit_pairs() {
    let source = DateCellData {
      timestamp: Some(instant(2026, 3, 5, 1, 0)),
      end_timestamp: Some(instant(2026, 3, 6, 2, 30)),
      is_range: true,
      ..Default::default()
    };
    assert!(
      hyper_calendar_move(&source, "America/New_York", instant(2026, 3, 7, 1, 0), None).is_err()
    );
    let explicit = instant(2026, 3, 8, 3, 30);
    assert_eq!(
      hyper_calendar_move(
        &source,
        "America/New_York",
        instant(2026, 3, 7, 1, 0),
        Some(explicit)
      )
      .unwrap()
      .end_timestamp,
      Some(explicit)
    );
    assert!(
      hyper_calendar_move(
        &DateCellData {
          reminder_id: "existing".to_string(),
          ..source
        },
        "UTC",
        0,
        None
      )
      .is_err()
    );
    assert!(hyper_calendar_move(&DateCellData::default(), "UTC", 0, Some(3600)).is_err());
    assert_eq!(
      hyper_calendar_move(&DateCellData::default(), "UTC", 0, None)
        .unwrap()
        .timestamp,
      Some(0)
    );
  }
}
