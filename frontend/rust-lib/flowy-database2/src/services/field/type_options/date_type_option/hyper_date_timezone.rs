use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use chrono_tz::Tz;

/// A date field follows its named zone, or the legacy process-local zone when unset/unknown.
#[derive(Clone, Copy)]
pub(crate) enum HyperDateTimezone {
  Named(Tz),
  Local,
}

impl HyperDateTimezone {
  pub(crate) fn new(timezone_id: &str) -> Self {
    timezone_id.parse().map(Self::Named).unwrap_or(Self::Local)
  }

  pub(crate) fn local_datetime(self, timestamp: i64) -> Option<NaiveDateTime> {
    match self {
      Self::Named(zone) => DateTime::from_timestamp(timestamp, 0)
        .map(|instant| instant.with_timezone(&zone).naive_local()),
      Self::Local => Local
        .timestamp_opt(timestamp, 0)
        .single()
        .map(|date| date.naive_local()),
    }
  }

  pub(crate) fn date(self, timestamp: i64) -> Option<NaiveDate> {
    self.local_datetime(timestamp).map(|date| date.date())
  }

  /// User-directed moves must not silently normalize a missing or repeated clock time.
  pub(crate) fn timestamp(self, date: NaiveDateTime) -> Option<i64> {
    match self {
      Self::Named(zone) => zone
        .from_local_datetime(&date)
        .single()
        .map(|date| date.timestamp()),
      Self::Local => Local
        .from_local_datetime(&date)
        .single()
        .map(|date| date.timestamp()),
    }
  }

  /// A generated date-only default may use any valid clock time on its requested day.
  pub(crate) fn first_timestamp_on(self, day: NaiveDate) -> Option<i64> {
    for hour in 0..24 {
      let clock = day.and_hms_opt(hour, 0, 0)?;
      let timestamp = match self {
        Self::Named(zone) => zone.from_local_datetime(&clock).earliest(),
        Self::Local => {
          return (0..24).find_map(|hour| {
            Local
              .from_local_datetime(&day.and_hms_opt(hour, 0, 0)?)
              .earliest()
              .map(|date| date.timestamp())
          });
        },
      };
      if let Some(timestamp) = timestamp {
        return Some(timestamp.timestamp());
      }
    }
    None
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn hyper_date_timezone_rejects_gap_and_fold_for_explicit_clocks() {
    let zone = HyperDateTimezone::new("America/New_York");
    let gap = NaiveDate::from_ymd_opt(2026, 3, 8)
      .unwrap()
      .and_hms_opt(2, 30, 0)
      .unwrap();
    let fold = NaiveDate::from_ymd_opt(2026, 11, 1)
      .unwrap()
      .and_hms_opt(1, 30, 0)
      .unwrap();
    assert!(zone.timestamp(gap).is_none());
    assert!(zone.timestamp(fold).is_none());
    let midnight = zone.first_timestamp_on(gap.date()).unwrap();
    assert_eq!(zone.date(midnight), Some(gap.date()));
    assert!(
      HyperDateTimezone::new("Pacific/Apia")
        .first_timestamp_on(NaiveDate::from_ymd_opt(2011, 12, 30).unwrap())
        .is_none()
    );
  }
}
