use crate::entities::{DateFilterConditionPB, DateFilterPB};
use crate::services::cell::insert_date_cell;
use crate::services::filter::PreFillCellsWithFilter;

use super::hyper_date_timezone::HyperDateTimezone;
use crate::entities::FieldType;
use bytes::Bytes;
use chrono::{DateTime, Duration, Local, NaiveDate, TimeZone};
use collab_database::fields::Field;
use collab_database::fields::date_type_option::DateCellData;
use collab_database::fields::date_type_option::DateTypeOption;
use collab_database::rows::Cell;
use collab_database::template::timestamp_parse::TimestampCellData;
use flowy_error::{FlowyResult, internal_error};

use crate::entities::DateCellDataPB;
use crate::services::cell::CellProtobufBlobParser;

impl DateFilterPB {
  /// Returns `None` if the DateFilterPB doesn't have the necessary data for
  /// the condition. For example, `start` and `end` timestamps for
  /// `DateFilterConditionPB::DateStartsBetween`.
  pub fn is_visible(&self, cell_data: &DateCellData) -> Option<bool> {
    if self.use_field_timezone {
      return self.is_visible_in_timezone(cell_data, "");
    }
    let strategy = self.get_strategy()?;

    let timestamp = if self.condition.is_filter_on_start_timestamp() {
      cell_data.timestamp
    } else {
      cell_data.end_timestamp.or(cell_data.timestamp)
    };

    Some(strategy.filter(timestamp))
  }

  pub fn is_visible_in_timezone(
    &self,
    cell_data: &DateCellData,
    timezone_id: &str,
  ) -> Option<bool> {
    if !self.use_field_timezone {
      return self.is_visible(cell_data);
    }
    let timestamp = if self.condition.is_filter_on_start_timestamp() {
      cell_data.timestamp
    } else {
      cell_data.end_timestamp.or(cell_data.timestamp)
    };
    Some(
      self
        .get_strategy()?
        .filter_zoned(timestamp, HyperDateTimezone::new(timezone_id)),
    )
  }

  pub fn is_timestamp_cell_data_visible(&self, cell_data: &TimestampCellData) -> Option<bool> {
    let strategy = self.get_strategy()?;

    Some(strategy.filter(cell_data.timestamp))
  }

  fn get_strategy(&self) -> Option<DateFilterStrategy> {
    let strategy = match self.condition {
      DateFilterConditionPB::DateStartsOn | DateFilterConditionPB::DateEndsOn => {
        DateFilterStrategy::On(self.timestamp?)
      },
      DateFilterConditionPB::DateStartsBefore | DateFilterConditionPB::DateEndsBefore => {
        DateFilterStrategy::Before(self.timestamp?)
      },
      DateFilterConditionPB::DateStartsAfter | DateFilterConditionPB::DateEndsAfter => {
        DateFilterStrategy::After(self.timestamp?)
      },
      DateFilterConditionPB::DateStartsOnOrBefore | DateFilterConditionPB::DateEndsOnOrBefore => {
        DateFilterStrategy::OnOrBefore(self.timestamp?)
      },
      DateFilterConditionPB::DateStartsOnOrAfter | DateFilterConditionPB::DateEndsOnOrAfter => {
        DateFilterStrategy::OnOrAfter(self.timestamp?)
      },
      DateFilterConditionPB::DateStartsBetween | DateFilterConditionPB::DateEndsBetween => {
        DateFilterStrategy::DateBetween {
          start: self.start?,
          end: self.end?,
        }
      },
      DateFilterConditionPB::DateStartIsEmpty | DateFilterConditionPB::DateEndIsEmpty => {
        DateFilterStrategy::Empty
      },
      DateFilterConditionPB::DateStartIsNotEmpty | DateFilterConditionPB::DateEndIsNotEmpty => {
        DateFilterStrategy::NotEmpty
      },
    };

    Some(strategy)
  }
}

#[inline]
fn naive_date_from_timestamp(timestamp: i64) -> Option<NaiveDate> {
  Local
    .timestamp_opt(timestamp, 0)
    .single()
    .map(|date_time| date_time.date_naive())
}

enum DateFilterStrategy {
  On(i64),
  Before(i64),
  After(i64),
  OnOrBefore(i64),
  OnOrAfter(i64),
  DateBetween { start: i64, end: i64 },
  Empty,
  NotEmpty,
}

impl DateFilterStrategy {
  fn filter_zoned(self, timestamp: Option<i64>, zone: HyperDateTimezone) -> bool {
    let cell = timestamp.and_then(|value| zone.date(value));
    let logical = |timestamp| DateTime::from_timestamp(timestamp, 0).map(|date| date.date_naive());
    let compare = |expected, predicate: fn(NaiveDate, NaiveDate) -> bool| {
      cell
        .zip(logical(expected))
        .is_some_and(|(actual, expected)| predicate(actual, expected))
    };
    match self {
      Self::On(expected) => compare(expected, |actual, expected| actual == expected),
      Self::Before(expected) => compare(expected, |actual, expected| actual < expected),
      Self::After(expected) => compare(expected, |actual, expected| actual > expected),
      Self::OnOrBefore(expected) => compare(expected, |actual, expected| actual <= expected),
      Self::OnOrAfter(expected) => compare(expected, |actual, expected| actual >= expected),
      Self::DateBetween { start, end } => cell
        .zip(logical(start))
        .zip(logical(end))
        .is_some_and(|((actual, start), end)| actual >= start && actual <= end),
      Self::Empty => cell.is_none(),
      Self::NotEmpty => cell.is_some(),
    }
  }

  fn filter(self, cell_data: Option<i64>) -> bool {
    match self {
      DateFilterStrategy::On(expected_timestamp) => cell_data.is_some_and(|timestamp| {
        let cell_date = naive_date_from_timestamp(timestamp);
        let expected_date = naive_date_from_timestamp(expected_timestamp);
        cell_date == expected_date
      }),
      DateFilterStrategy::Before(expected_timestamp) => cell_data.is_some_and(|timestamp| {
        let cell_date = naive_date_from_timestamp(timestamp);
        let expected_date = naive_date_from_timestamp(expected_timestamp);
        cell_date < expected_date
      }),
      DateFilterStrategy::After(expected_timestamp) => cell_data.is_some_and(|timestamp| {
        let cell_date = naive_date_from_timestamp(timestamp);
        let expected_date = naive_date_from_timestamp(expected_timestamp);
        cell_date > expected_date
      }),
      DateFilterStrategy::OnOrBefore(expected_timestamp) => cell_data.is_some_and(|timestamp| {
        let cell_date = naive_date_from_timestamp(timestamp);
        let expected_date = naive_date_from_timestamp(expected_timestamp);
        cell_date <= expected_date
      }),
      DateFilterStrategy::OnOrAfter(expected_timestamp) => cell_data.is_some_and(|timestamp| {
        let cell_date = naive_date_from_timestamp(timestamp);
        let expected_date = naive_date_from_timestamp(expected_timestamp);
        cell_date >= expected_date
      }),
      DateFilterStrategy::DateBetween { start, end } => cell_data.is_some_and(|timestamp| {
        let cell_date = naive_date_from_timestamp(timestamp);
        let expected_start_date = naive_date_from_timestamp(start);
        let expected_end_date = naive_date_from_timestamp(end);
        cell_date >= expected_start_date && cell_date <= expected_end_date
      }),
      DateFilterStrategy::Empty => match cell_data {
        None => true,
        Some(timestamp) if naive_date_from_timestamp(timestamp).is_none() => true,
        _ => false,
      },
      DateFilterStrategy::NotEmpty => {
        matches!(cell_data, Some(timestamp) if naive_date_from_timestamp(timestamp).is_some() )
      },
    }
  }
}

impl PreFillCellsWithFilter for DateFilterPB {
  fn get_compliant_cell(&self, field: &Field) -> Option<Cell> {
    if self.use_field_timezone {
      return self.get_zoned_compliant_cell(field);
    }
    let start_timestamp = match self.condition {
      DateFilterConditionPB::DateStartsOn
      | DateFilterConditionPB::DateStartsOnOrBefore
      | DateFilterConditionPB::DateStartsOnOrAfter
      | DateFilterConditionPB::DateEndsOn
      | DateFilterConditionPB::DateEndsOnOrBefore
      | DateFilterConditionPB::DateEndsOnOrAfter => self.timestamp,
      DateFilterConditionPB::DateStartsBefore | DateFilterConditionPB::DateEndsBefore => self
        .timestamp
        .and_then(|timestamp| {
          Local
            .timestamp_opt(timestamp, 0)
            .single()
            .map(|date| date.naive_local())
        })
        .and_then(|date_time| {
          let answer = date_time - Duration::days(1);
          Local
            .from_local_datetime(&answer)
            .single()
            .map(|date_time| date_time.timestamp())
        }),
      DateFilterConditionPB::DateStartsAfter | DateFilterConditionPB::DateEndsAfter => self
        .timestamp
        .and_then(|timestamp| {
          Local
            .timestamp_opt(timestamp, 0)
            .single()
            .map(|date| date.naive_local())
        })
        .and_then(|date_time| {
          let answer = date_time + Duration::days(1);
          Local
            .from_local_datetime(&answer)
            .single()
            .map(|date_time| date_time.timestamp())
        }),
      DateFilterConditionPB::DateStartsBetween | DateFilterConditionPB::DateEndsBetween => {
        self.start
      },
      _ => None,
    };

    start_timestamp.map(|timestamp| insert_date_cell(timestamp, None, None, field))
  }
}

impl DateFilterPB {
  fn get_zoned_compliant_cell(&self, field: &Field) -> Option<Cell> {
    use DateFilterConditionPB::*;
    let option = field
      .get_type_option::<DateTypeOption>(FieldType::DateTime)
      .unwrap_or_default();
    let zone = HyperDateTimezone::new(&option.timezone_id);
    let logical = |value| DateTime::from_timestamp(value, 0).map(|date| date.date_naive());
    let (mut day, direction, limit) = match self.condition {
      DateStartsOn | DateEndsOn => (logical(self.timestamp?)?, 0, None),
      DateStartsBefore | DateEndsBefore => (logical(self.timestamp?)?.pred_opt()?, -1, None),
      DateStartsAfter | DateEndsAfter => (logical(self.timestamp?)?.succ_opt()?, 1, None),
      DateStartsOnOrBefore | DateEndsOnOrBefore => (logical(self.timestamp?)?, -1, None),
      DateStartsOnOrAfter | DateEndsOnOrAfter => (logical(self.timestamp?)?, 1, None),
      DateStartsBetween | DateEndsBetween => (logical(self.start?)?, 1, Some(logical(self.end?)?)),
      DateStartIsNotEmpty | DateEndIsNotEmpty => {
        (zone.date(chrono::Utc::now().timestamp())?, 1, None)
      },
      DateStartIsEmpty | DateEndIsEmpty => return None,
    };
    // IANA's skipped dates are at most a day; the bound also protects malformed metadata.
    for _ in 0..7 {
      if limit.is_some_and(|end| day > end) {
        return None;
      }
      if let Some(timestamp) = zone.first_timestamp_on(day) {
        if self.is_visible_in_timezone(
          &DateCellData::from_timestamp(timestamp),
          &option.timezone_id,
        ) == Some(true)
        {
          return Some(insert_date_cell(timestamp, None, None, field));
        }
      }
      day = match direction {
        -1 => day.pred_opt()?,
        1 => day.succ_opt()?,
        _ => return None,
      };
    }
    None
  }
}

#[derive(Clone, Debug, Default)]
pub struct DateCellChangeset {
  pub timestamp: Option<i64>,
  pub end_timestamp: Option<i64>,
  pub include_time: Option<bool>,
  pub is_range: Option<bool>,
  pub clear_flag: Option<bool>,
  pub reminder_id: Option<String>,
}

pub struct DateCellDataParser();
impl CellProtobufBlobParser for DateCellDataParser {
  type Object = DateCellDataPB;

  fn parser(bytes: &Bytes) -> FlowyResult<Self::Object> {
    DateCellDataPB::try_from(bytes.as_ref()).map_err(internal_error)
  }
}

#[cfg(test)]
mod tests {
  use crate::entities::{DateFilterConditionPB, DateFilterPB};
  use collab_database::fields::date_type_option::DateCellData;

  fn to_cell_data(timestamp: Option<i64>, end_timestamp: Option<i64>) -> DateCellData {
    DateCellData {
      timestamp,
      end_timestamp,
      ..Default::default()
    }
  }

  #[test]
  fn date_filter_is_test() {
    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartsOn,
      timestamp: Some(1668387885),
      end: None,
      start: None,
    };

    for (start, end, is_visible) in [
      (Some(1668387885), None, true),
      (Some(1647251762), None, false),
      (None, None, false),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible
      );
    }

    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartsOn,
      timestamp: None,
      end: None,
      start: None,
    };

    for (start, end, is_visible) in [
      (Some(1668387885), None, true),
      (Some(1647251762), None, true),
      (None, None, true),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible
      );
    }
  }

  #[test]
  fn date_filter_before_test() {
    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartsBefore,
      timestamp: Some(1668387885),
      start: None,
      end: None,
    };

    for (start, end, is_visible) in [
      (Some(1668387884), None, false),
      (Some(1647251762), None, true),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible,
      );
    }
  }

  #[test]
  fn date_filter_before_or_on_test() {
    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartsOnOrBefore,
      timestamp: Some(1668387885),
      start: None,
      end: None,
    };

    for (start, end, is_visible) in [
      (Some(1668387884), None, true),
      (Some(1668387885), None, true),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible
      );
    }
  }
  #[test]
  fn date_filter_after_test() {
    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartsAfter,
      timestamp: Some(1668387885),
      start: None,
      end: None,
    };

    for (start, end, is_visible) in [
      (Some(1668387888), None, false),
      (Some(1668531885), None, true),
      (Some(0), None, false),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible
      );
    }
  }

  #[test]
  fn date_filter_within_test() {
    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartsBetween,
      start: Some(1668272685), // 11/13
      end: Some(1668618285),   // 11/17
      timestamp: None,
    };

    for (start, end, is_visible, msg) in [
      (Some(1668272685), None, true, "11/13"),
      (Some(1668359085), None, true, "11/14"),
      (Some(1668704685), None, false, "11/18"),
      (None, None, false, "empty"),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible,
        "{msg}"
      );
    }

    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartsBetween,
      start: None,
      end: Some(1668618285), // 11/17
      timestamp: None,
    };

    for (start, end, is_visible, msg) in [
      (Some(1668272685), None, true, "11/13"),
      (Some(1668359085), None, true, "11/14"),
      (Some(1668704685), None, true, "11/18"),
      (None, None, true, "empty"),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible,
        "{msg}"
      );
    }
  }

  #[test]
  fn date_filter_is_empty_test() {
    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateStartIsEmpty,
      start: None,
      end: None,
      timestamp: None,
    };

    for (start, end, is_visible) in [(None, None, true), (Some(123), None, false)] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible
      );
    }
  }

  #[test]
  fn date_filter_end_test() {
    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateEndsOnOrBefore,
      timestamp: Some(1668359085), // 11/14
      end: None,
      start: None,
    };

    for (start, end, is_visible, msg) in [
      (Some(1668272685), None, true, "11/13"),
      (Some(1668359085), None, true, "11/14"),
      (Some(1668704685), None, false, "11/18"),
      (None, None, false, "empty"),
      (Some(1668272685), Some(1668272685), true, "11/13"),
      (Some(1668272685), Some(1668359085), true, "11/14"),
      (Some(1668272685), Some(1668704685), false, "11/18"),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible,
        "{msg}"
      );
    }

    let filter = DateFilterPB {
      use_field_timezone: false,
      condition: DateFilterConditionPB::DateEndsOnOrBefore,
      timestamp: None,
      start: None,
      end: None,
    };

    for (start, end, is_visible, msg) in [
      (Some(1668272685), Some(1668272685), true, "11/13"),
      (Some(1668272685), Some(1668359085), true, "11/14"),
      (Some(1668272685), Some(1668704685), true, "11/18"),
      (None, None, true, "empty"),
    ] {
      assert_eq!(
        filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
        is_visible,
        "{msg}"
      );
    }
  }

  // #[test]
  // fn timezoned_filter_test() {
  //   let filter = DateFilterPB {
  //     condition: DateFilterConditionPB::DateStartsOn,
  //     timestamp: Some(1728975660), // Oct 15, 2024 00:00 PDT
  //     end: None,
  //     start: None,
  //   };
  //
  //   for (start, end, is_visible, msg) in [
  //     (
  //       Some(1728889200),
  //       None,
  //       false,
  //       "10/14/2024 00:00 PDT, 10/14/2024 07:00 GMT",
  //     ),
  //     (
  //       Some(1728889260),
  //       None,
  //       false,
  //       "10/14/2024 00:01 PDT, 10/14/2024 07:01 GMT",
  //     ),
  //     (
  //       Some(1728900000),
  //       None,
  //       false,
  //       "10/14/2024 03:00 PDT, 10/14/2024 10:00 GMT",
  //     ),
  //     (
  //       Some(1728921600),
  //       None,
  //       false,
  //       "10/14/2024 09:00 PDT, 10/14/2024 16:00 GMT",
  //     ),
  //     (
  //       Some(1728932400),
  //       None,
  //       false,
  //       "10/14/2024 12:00 PDT, 10/14/2024 19:00 GMT",
  //     ),
  //     (
  //       Some(1728943200),
  //       None,
  //       false,
  //       "10/14/2024 15:00 PDT, 10/14/2024 22:00 GMT",
  //     ),
  //     (
  //       Some(1728954000),
  //       None,
  //       false,
  //       "10/14/2024 18:00 PDT, 10/15/2024 01:00 GMT",
  //     ),
  //     (
  //       Some(1728964800),
  //       None,
  //       false,
  //       "10/14/2024 21:00 PDT, 10/15/2024 04:00 GMT",
  //     ),
  //     (
  //       Some(1728975540),
  //       None,
  //       false,
  //       "10/14/2024 23:59 PDT, 10/15/2024 06:59 GMT",
  //     ),
  //     (
  //       Some(1728975600),
  //       None,
  //       true,
  //       "10/15/2024 00:00 PDT, 10/15/2024 07:00 GMT",
  //     ),
  //     (
  //       Some(1728975660),
  //       None,
  //       true,
  //       "10/15/2024 00:01 PDT, 10/15/2024 07:01 GMT",
  //     ),
  //     (
  //       Some(1728986400),
  //       None,
  //       true,
  //       "10/15/2024 03:00 PDT, 10/15/2024 10:00 GMT",
  //     ),
  //     (
  //       Some(1729008000),
  //       None,
  //       true,
  //       "10/15/2024 09:00 PDT, 10/15/2024 16:00 GMT",
  //     ),
  //     (
  //       Some(1729018800),
  //       None,
  //       true,
  //       "10/15/2024 12:00 PDT, 10/15/2024 19:00 GMT",
  //     ),
  //     (
  //       Some(1729029600),
  //       None,
  //       true,
  //       "10/15/2024 15:00 PDT, 10/15/2024 22:00 GMT",
  //     ),
  //     (
  //       Some(1729040400),
  //       None,
  //       true,
  //       "10/15/2024 18:00 PDT, 10/16/2024 01:00 GMT",
  //     ),
  //     (
  //       Some(1729051200),
  //       None,
  //       true,
  //       "10/15/2024 21:00 PDT, 10/16/2024 04:00 GMT",
  //     ),
  //     (
  //       Some(1729061940),
  //       None,
  //       true,
  //       "10/15/2024 23:59 PDT, 10/16/2024 06:59 GMT",
  //     ),
  //     (
  //       Some(1729062000),
  //       None,
  //       false,
  //       "10/16/2024 00:00 PDT, 10/16/2024 07:00 GMT",
  //     ),
  //     (
  //       Some(1729062060),
  //       None,
  //       false,
  //       "10/16/2024 00:01 PDT, 10/16/2024 07:01 GMT",
  //     ),
  //     (
  //       Some(1729072800),
  //       None,
  //       false,
  //       "10/16/2024 03:00 PDT, 10/16/2024 10:00 GMT",
  //     ),
  //     (
  //       Some(1729094400),
  //       None,
  //       false,
  //       "10/16/2024 09:00 PDT, 10/16/2024 16:00 GMT",
  //     ),
  //     (
  //       Some(1729105200),
  //       None,
  //       false,
  //       "10/16/2024 12:00 PDT, 10/16/2024 19:00 GMT",
  //     ),
  //     (
  //       Some(1729116000),
  //       None,
  //       false,
  //       "10/16/2024 15:00 PDT, 10/16/2024 22:00 GMT",
  //     ),
  //     (
  //       Some(1729126800),
  //       None,
  //       false,
  //       "10/16/2024 18:00 PDT, 10/17/2024 01:00 GMT",
  //     ),
  //     (
  //       Some(1729137600),
  //       None,
  //       false,
  //       "10/16/2024 21:00 PDT, 10/17/2024 04:00 GMT",
  //     ),
  //     (
  //       Some(1729148340),
  //       None,
  //       false,
  //       "10/16/2024 23:59 PDT, 10/17/2024 06:59 GMT",
  //     ),
  //   ] {
  //     assert_eq!(
  //       filter.is_visible(&to_cell_data(start, end)).unwrap_or(true),
  //       is_visible,
  //       "{msg}"
  //     );
  //   }
  // }
}

#[cfg(test)]
mod hyper_zoned_tests {
  use super::*;
  use crate::services::field::FieldBuilder;
  use chrono::{TimeZone, Utc};
  use chrono_tz::{America::New_York, Asia::Kathmandu};
  fn token(y: i32, m: u32, d: u32) -> i64 {
    Utc
      .with_ymd_and_hms(y, m, d, 0, 0, 0)
      .single()
      .unwrap()
      .timestamp()
  }
  fn on(day: i64) -> DateFilterPB {
    DateFilterPB {
      condition: DateFilterConditionPB::DateStartsOn,
      timestamp: Some(day),
      use_field_timezone: true,
      ..Default::default()
    }
  }
  #[test]
  fn hyper_zoned_filter_keeps_logical_day_across_offsets_and_dst_folds() {
    let filter = on(token(2026, 11, 11));
    let ny = New_York
      .with_ymd_and_hms(2026, 11, 11, 23, 59, 0)
      .single()
      .unwrap()
      .timestamp();
    assert_eq!(
      filter.is_visible_in_timezone(&DateCellData::from_timestamp(ny), "America/New_York"),
      Some(true)
    );
    assert_eq!(
      filter.is_visible_in_timezone(&DateCellData::from_timestamp(ny), "UTC"),
      Some(false)
    );
    let ktm = Kathmandu
      .with_ymd_and_hms(2026, 11, 11, 0, 1, 0)
      .single()
      .unwrap()
      .timestamp();
    assert_eq!(
      filter.is_visible_in_timezone(&DateCellData::from_timestamp(ktm), "Asia/Kathmandu"),
      Some(true)
    );
    let fold = New_York.with_ymd_and_hms(2026, 11, 1, 1, 30, 0);
    for instant in [fold.earliest().unwrap(), fold.latest().unwrap()] {
      assert_eq!(
        on(token(2026, 11, 1)).is_visible_in_timezone(
          &DateCellData::from_timestamp(instant.timestamp()),
          "America/New_York"
        ),
        Some(true)
      );
    }
  }
  #[test]
  fn hyper_zoned_filter_end_and_between_use_zoned_cells_but_utc_criteria() {
    let source = DateCellData {
      timestamp: Some(token(2026, 11, 1)),
      end_timestamp: Some(
        New_York
          .with_ymd_and_hms(2026, 11, 30, 23, 59, 0)
          .single()
          .unwrap()
          .timestamp(),
      ),
      is_range: true,
      ..Default::default()
    };
    let filter = DateFilterPB {
      condition: DateFilterConditionPB::DateEndsBetween,
      start: Some(token(2026, 11, 1)),
      end: Some(token(2026, 11, 30)),
      use_field_timezone: true,
      ..Default::default()
    };
    assert_eq!(
      filter.is_visible_in_timezone(&source, "America/New_York"),
      Some(true)
    );
    assert_eq!(filter.is_visible_in_timezone(&source, "UTC"), Some(false));
    let legacy = DateFilterPB {
      use_field_timezone: false,
      ..filter
    };
    assert_eq!(
      legacy.is_visible_in_timezone(&source, "America/New_York"),
      legacy.is_visible(&source)
    );
  }
  #[test]
  fn hyper_zoned_filter_prefill_is_compliant_across_gaps_and_skipped_dates() {
    let option = DateTypeOption {
      timezone_id: "America/New_York".into(),
      ..Default::default()
    };
    let field = FieldBuilder::new(FieldType::DateTime, option).build();
    for condition in [
      DateFilterConditionPB::DateStartsOn,
      DateFilterConditionPB::DateStartsBefore,
      DateFilterConditionPB::DateStartsAfter,
      DateFilterConditionPB::DateStartsOnOrBefore,
      DateFilterConditionPB::DateStartsOnOrAfter,
    ] {
      let filter = DateFilterPB {
        condition,
        ..on(token(2026, 3, 8))
      };
      let cell = filter.get_compliant_cell(&field).unwrap();
      assert_eq!(
        filter.is_visible_in_timezone(&DateCellData::from(&cell), "America/New_York"),
        Some(true)
      );
    }
    let field = FieldBuilder::new(
      FieldType::DateTime,
      DateTypeOption {
        timezone_id: "Pacific/Apia".into(),
        ..Default::default()
      },
    )
    .build();
    assert!(on(token(2011, 12, 30)).get_compliant_cell(&field).is_none());
    let filter = DateFilterPB {
      condition: DateFilterConditionPB::DateStartsAfter,
      ..on(token(2011, 12, 29))
    };
    let cell = filter.get_compliant_cell(&field).unwrap();
    assert_eq!(
      filter.is_visible_in_timezone(&DateCellData::from(&cell), "Pacific/Apia"),
      Some(true)
    );
  }
}
