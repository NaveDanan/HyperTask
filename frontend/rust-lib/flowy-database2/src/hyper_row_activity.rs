//! Current visible readers pin actual row instances independently of the idle row cache.
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, Weak};

use collab::lock::RwLock;
use collab_database::rows::{DatabaseRow, RowId};
use flowy_error::{FlowyError, FlowyResult};
use uuid::Uuid;

use crate::entities::HyperRowActivityAckPB;

pub(crate) const MAX_ACTIVITY_ROWS: usize = 512;
const MAX_EDITOR_ROWS: usize = 4096;
const MAX_EDITOR_ACTIVITIES: usize = 64;
// Released revisions must not be evicted and later replayed as new activations.
const MAX_REVISION_RECORDS: usize = 8192;

type RowArc = Arc<RwLock<DatabaseRow>>;

#[derive(Default)]
struct Activity {
  revision: u64,
  requested: HashSet<RowId>,
  desired: HashSet<RowId>,
  validating: bool,
  finished: bool,
  closed: bool,
}

struct ViewContext {
  token: Uuid,
  activities: HashMap<Uuid, Activity>,
}

#[derive(Default)]
struct State {
  views: HashMap<String, ViewContext>,
  pins: HashMap<RowId, Option<RowArc>>,
  inactive: Vec<(RowId, RowArc)>,
}

#[derive(Default)]
pub(crate) struct HyperRowActivities {
  state: Mutex<State>,
}

#[derive(Clone)]
pub(crate) struct HyperRowReservation {
  pub view: String,
  pub context: Uuid,
  pub activity: Uuid,
  pub revision: u64,
  pub rows: HashSet<RowId>,
}

pub(crate) enum HyperRowRequest {
  Current(HyperRowReservation),
  Ack(HyperRowActivityAckPB),
}

pub(crate) fn changed() -> FlowyError {
  FlowyError::invalid_data()
    .with_context("This dataset view changed. Reopen it to resume live updates.")
}

fn capacity() -> FlowyError {
  FlowyError::invalid_data().with_context(
    "Too many dataset readers are active. Close another dataset pane before trying again.",
  )
}

fn records_full() -> FlowyError {
  FlowyError::invalid_data().with_context(
    "Too many dataset reader sessions have accumulated. Close all panes of this dataset and reopen it.",
  )
}

impl HyperRowReservation {
  pub fn ack(&self) -> HyperRowActivityAckPB {
    HyperRowActivityAckPB {
      context_id: self.context.to_string(),
      activity_id: self.activity.to_string(),
      revision: self.revision,
    }
  }
}

impl HyperRowActivities {
  pub fn open(&self, view: &str) -> FlowyResult<Uuid> {
    let mut state = self.state.lock().map_err(|_| changed())?;
    Ok(
      state
        .views
        .entry(view.to_string())
        .or_insert_with(|| ViewContext {
          token: Uuid::new_v4(),
          activities: HashMap::new(),
        })
        .token,
    )
  }

  pub fn matches(&self, view: &str, context: &Uuid) -> bool {
    self.state.lock().ok().is_some_and(|state| {
      state
        .views
        .get(view)
        .is_some_and(|current| current.token == *context)
    })
  }

  pub fn begin(
    &self,
    view: String,
    context: Uuid,
    activity: Uuid,
    revision: u64,
    rows: HashSet<RowId>,
  ) -> FlowyResult<HyperRowRequest> {
    if revision == 0 || rows.len() > MAX_ACTIVITY_ROWS {
      return Err(capacity());
    }
    let reservation = HyperRowReservation {
      view,
      context,
      activity,
      revision,
      rows,
    };
    let mut state = self.state.lock().map_err(|_| changed())?;
    let Some(current) = state
      .views
      .get(&reservation.view)
      .filter(|view| view.token == context)
    else {
      return Err(changed());
    };
    if let Some(previous) = current.activities.get(&activity) {
      if previous.closed {
        return Err(changed());
      }
      if revision < previous.revision {
        let mut ack = reservation.ack();
        ack.revision = previous.revision;
        return Ok(HyperRowRequest::Ack(ack));
      }
      if revision == previous.revision {
        return if previous.requested == reservation.rows && previous.finished {
          Ok(HyperRowRequest::Ack(reservation.ack()))
        } else {
          Err(changed())
        };
      }
    }
    let records = state
      .views
      .values()
      .map(|view| view.activities.len())
      .sum::<usize>();
    let exists = current.activities.contains_key(&activity);
    if !exists && records >= MAX_REVISION_RECORDS {
      return Err(records_full());
    }
    let active = state
      .views
      .values()
      .flat_map(|view| {
        view
          .activities
          .iter()
          .map(move |(id, value)| (view.token, *id, value))
      })
      .filter(|(token, id, value)| (*token != context || *id != activity) && !value.closed)
      .count();
    if active >= MAX_EDITOR_ACTIVITIES {
      return Err(capacity());
    }
    let value = state
      .views
      .get_mut(&reservation.view)
      .unwrap()
      .activities
      .entry(activity)
      .or_default();
    value.revision = revision;
    value.requested = reservation.rows.clone();
    value.validating = true;
    value.finished = false;
    Ok(HyperRowRequest::Current(reservation))
  }

  /// Terminal disposal reserves its revision synchronously, including when an
  /// older activation is still waiting. Closed IDs remain tombstones until the
  /// final live pane of this view ends, so delayed requests cannot re-enroll.
  pub fn close(
    &self,
    view: String,
    context: Uuid,
    activity: Uuid,
    revision: u64,
  ) -> FlowyResult<HyperRowActivityAckPB> {
    if revision == 0 {
      return Err(changed());
    }
    let request = HyperRowReservation {
      view,
      context,
      activity,
      revision,
      rows: HashSet::new(),
    };
    let mut state = self.state.lock().map_err(|_| changed())?;
    let records = state
      .views
      .values()
      .map(|view| view.activities.len())
      .sum::<usize>();
    let Some(current) = state
      .views
      .get_mut(&request.view)
      .filter(|view| view.token == context)
    else {
      return Ok(request.ack());
    };
    if let Some(previous) = current.activities.get(&activity) {
      if revision < previous.revision {
        let mut ack = request.ack();
        ack.revision = previous.revision;
        return Ok(ack);
      }
      if revision == previous.revision && !previous.closed {
        return Err(changed());
      }
    }
    // An unknown activation can still be awaiting membership validation before
    // begin(). Its terminal intent needs a tombstone too. Never acknowledge a
    // close we cannot retain: another view may free capacity before it resumes.
    if !current.activities.contains_key(&activity) && records >= MAX_REVISION_RECORDS {
      return Err(records_full());
    }
    current.activities.insert(
      activity,
      Activity {
        revision,
        closed: true,
        finished: true,
        ..Default::default()
      },
    );
    if current.activities.values().all(|value| value.closed) {
      state.views.remove(&request.view);
    }
    let union = desired_union(&state);
    collect_inactive(&mut state, &union);
    Ok(request.ack())
  }

  /// Membership is validated before replacing the old desired set.
  pub fn accept(
    &self,
    request: &HyperRowReservation,
    cached: HashMap<RowId, RowArc>,
  ) -> FlowyResult<()> {
    let mut state = self.state.lock().map_err(|_| changed())?;
    let current = state
      .views
      .get(&request.view)
      .filter(|view| view.token == request.context)
      .and_then(|view| view.activities.get(&request.activity))
      .filter(|value| value.revision == request.revision)
      .ok_or_else(changed)?;
    if !current.validating {
      return Err(changed());
    }
    let mut union = HashSet::new();
    for view in state.views.values() {
      for (id, activity) in &view.activities {
        if view.token != request.context || *id != request.activity {
          union.extend(activity.desired.iter().cloned());
        }
      }
    }
    union.extend(request.rows.iter().cloned());
    if union.len() > MAX_EDITOR_ROWS {
      return Err(capacity());
    }
    let value = state
      .views
      .get_mut(&request.view)
      .unwrap()
      .activities
      .get_mut(&request.activity)
      .unwrap();
    value.desired = request.rows.clone();
    value.validating = false;
    collect_inactive(&mut state, &union);
    for id in union {
      let entry = state.pins.entry(id.clone()).or_default();
      if entry.is_none() {
        *entry = cached.get(&id).cloned();
      }
    }
    Ok(())
  }

  pub fn validation_failed(&self, request: &HyperRowReservation) {
    if let Ok(mut state) = self.state.lock() {
      if let Some(value) = state
        .views
        .get_mut(&request.view)
        .filter(|view| view.token == request.context)
        .and_then(|view| view.activities.get_mut(&request.activity))
        .filter(|value| value.revision == request.revision)
      {
        value.validating = false;
      }
    }
  }

  pub fn current(&self, request: &HyperRowReservation, row: Option<&RowId>) -> bool {
    self.state.lock().ok().is_some_and(|state| {
      state
        .views
        .get(&request.view)
        .filter(|view| view.token == request.context)
        .and_then(|view| view.activities.get(&request.activity))
        .is_some_and(|value| {
          value.revision == request.revision
            && !value.validating
            && row.is_none_or(|id| value.desired.contains(id))
        })
    })
  }

  pub fn attach(&self, request: &HyperRowReservation, id: &RowId, row: RowArc) -> FlowyResult<()> {
    let mut state = self.state.lock().map_err(|_| changed())?;
    if !state
      .views
      .get(&request.view)
      .filter(|view| view.token == request.context)
      .and_then(|view| view.activities.get(&request.activity))
      .is_some_and(|value| {
        value.revision == request.revision && !value.validating && value.desired.contains(id)
      })
    {
      return Err(changed());
    }
    let previous = state
      .pins
      .get_mut(id)
      .ok_or_else(changed)?
      .replace(row.clone());
    if let Some(previous) = previous {
      if !Arc::ptr_eq(&previous, &row) {
        state.inactive.push((id.clone(), previous));
      }
    }
    Ok(())
  }

  pub fn pinned(&self, id: &str, row: &Weak<RwLock<DatabaseRow>>) -> bool {
    // Failure retains a plugin rather than detaching a possibly active reader.
    self
      .state
      .lock()
      .map(|state| {
        state
          .pins
          .get(&RowId::from(id.to_string()))
          .and_then(Option::as_ref)
          .is_some_and(|active| Weak::ptr_eq(&Arc::downgrade(active), row))
      })
      .unwrap_or(true)
  }

  pub fn retire(&self, view: &str) -> FlowyResult<()> {
    let mut state = self.state.lock().map_err(|_| changed())?;
    state.views.remove(view);
    let union: HashSet<_> = state
      .views
      .values()
      .flat_map(|view| view.activities.values())
      .flat_map(|value| value.desired.iter().cloned())
      .collect();
    collect_inactive(&mut state, &union);
    Ok(())
  }

  pub fn finish(&self, request: &HyperRowReservation) -> FlowyResult<()> {
    let mut state = self.state.lock().map_err(|_| changed())?;
    let value = state
      .views
      .get_mut(&request.view)
      .filter(|view| view.token == request.context)
      .and_then(|view| view.activities.get_mut(&request.activity))
      .filter(|value| value.revision == request.revision)
      .ok_or_else(changed)?;
    value.finished = true;
    Ok(())
  }

  pub fn take_inactive(&self) -> FlowyResult<Vec<(RowId, RowArc)>> {
    Ok(std::mem::take(
      &mut self.state.lock().map_err(|_| changed())?.inactive,
    ))
  }

  pub fn latest(&self, request: &HyperRowReservation) -> FlowyResult<HyperRowActivityAckPB> {
    let state = self.state.lock().map_err(|_| changed())?;
    let value = state
      .views
      .get(&request.view)
      .filter(|view| view.token == request.context)
      .and_then(|view| view.activities.get(&request.activity))
      .ok_or_else(changed)?;
    let mut ack = request.ack();
    ack.revision = value.revision;
    Ok(ack)
  }

  pub fn invalidate(&self) {
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.views.clear();
    state.pins.clear();
    state.inactive.clear();
  }

  pub fn clear(&self) {
    if let Ok(mut state) = self.state.lock() {
      state.views.clear();
      let pins = std::mem::take(&mut state.pins);
      state.inactive.extend(
        pins
          .into_iter()
          .filter_map(|(id, value)| value.map(|row| (id, row))),
      );
    }
  }
}

fn collect_inactive(state: &mut State, union: &HashSet<RowId>) {
  let removed = state
    .pins
    .keys()
    .filter(|id| !union.contains(*id))
    .cloned()
    .collect::<Vec<_>>();
  for id in removed {
    if let Some(Some(row)) = state.pins.remove(&id) {
      state.inactive.push((id, row));
    }
  }
}

fn desired_union(state: &State) -> HashSet<RowId> {
  state
    .views
    .values()
    .flat_map(|view| view.activities.values())
    .flat_map(|value| value.desired.iter().cloned())
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;
  fn begin(
    registry: &HyperRowActivities,
    view: &str,
    token: Uuid,
    id: Uuid,
    revision: u64,
    rows: HashSet<RowId>,
  ) -> HyperRowReservation {
    match registry
      .begin(view.into(), token, id, revision, rows)
      .unwrap()
    {
      HyperRowRequest::Current(value) => value,
      _ => panic!("expected a new revision"),
    }
  }
  #[test]
  fn hyper_row_activity_total_row_bound_is_an_error_and_overlapping_sets_still_work() {
    let registry = HyperRowActivities::default();
    let view = Uuid::new_v4().to_string();
    let token = registry.open(&view).unwrap();
    let mut first = HashSet::new();
    for index in 0..8 {
      let rows = (0..512)
        .map(|_| RowId::from(Uuid::new_v4().to_string()))
        .collect::<HashSet<_>>();
      if index == 0 {
        first = rows.clone();
      }
      let request = begin(&registry, &view, token, Uuid::new_v4(), 1, rows);
      registry.accept(&request, HashMap::new()).unwrap();
      registry.finish(&request).unwrap();
    }
    let id = Uuid::new_v4();
    let too_many = begin(
      &registry,
      &view,
      token,
      id,
      1,
      HashSet::from([Uuid::new_v4().to_string().into()]),
    );
    assert!(registry.accept(&too_many, HashMap::new()).is_err());
    registry.validation_failed(&too_many);
    assert_eq!(registry.state.lock().unwrap().pins.len(), 4096);
    let overlap = begin(&registry, &view, token, id, 2, first);
    registry.accept(&overlap, HashMap::new()).unwrap();
    registry.finish(&overlap).unwrap();
    assert_eq!(registry.state.lock().unwrap().pins.len(), 4096);
  }
  #[test]
  fn hyper_row_activity_activity_bound_includes_empty_panes_and_terminal_close_retires_context() {
    let registry = HyperRowActivities::default();
    let view = Uuid::new_v4().to_string();
    let token = registry.open(&view).unwrap();
    let rows = HashSet::from([Uuid::new_v4().to_string().into()]);
    let mut ids = vec![];
    for _ in 0..64 {
      let id = Uuid::new_v4();
      ids.push(id);
      let request = begin(&registry, &view, token, id, 1, HashSet::new());
      registry.accept(&request, HashMap::new()).unwrap();
      registry.finish(&request).unwrap();
    }
    assert!(
      registry
        .begin(view.clone(), token, Uuid::new_v4(), 1, rows.clone())
        .is_err()
    );
    registry.close(view.clone(), token, ids[0], 2).unwrap();
    assert!(
      registry
        .begin(view.clone(), token, ids[0], 3, rows.clone())
        .is_err()
    );
    let fresh_id = Uuid::new_v4();
    let fresh = begin(&registry, &view, token, fresh_id, 1, rows);
    registry.accept(&fresh, HashMap::new()).unwrap();
    registry.finish(&fresh).unwrap();
    for id in ids.into_iter().skip(1) {
      registry.close(view.clone(), token, id, 2).unwrap();
    }
    assert!(registry.matches(&view, &token));
    registry.close(view.clone(), token, fresh_id, 2).unwrap();
    assert!(!registry.matches(&view, &token));
    assert!(registry.state.lock().unwrap().views.is_empty());
    assert!(
      registry
        .begin(view.clone(), token, Uuid::new_v4(), 1, HashSet::new())
        .is_err()
    );
    registry.close(view.clone(), token, fresh_id, 3).unwrap();
    assert_ne!(registry.open(&view).unwrap(), token);
  }

  #[test]
  fn hyper_row_activity_disposal_before_first_activation_and_protective_limit_keep_replay_safe() {
    let registry = HyperRowActivities::default();
    let view = Uuid::new_v4().to_string();
    let token = registry.open(&view).unwrap();
    let alive = Uuid::new_v4();
    let request = begin(&registry, &view, token, alive, 1, HashSet::new());
    registry.accept(&request, HashMap::new()).unwrap();
    registry.finish(&request).unwrap();
    let delayed = Uuid::new_v4();
    registry.close(view.clone(), token, delayed, 2).unwrap();
    assert!(
      registry
        .begin(view.clone(), token, delayed, 1, HashSet::new())
        .is_err()
    );
    for _ in 0..100 {
      let id = Uuid::new_v4();
      let request = begin(&registry, &view, token, id, 1, HashSet::new());
      registry.accept(&request, HashMap::new()).unwrap();
      registry.finish(&request).unwrap();
      registry.close(view.clone(), token, id, 2).unwrap();
    }
    // Fill only the protected tombstone boundary directly; the preceding real
    // lifecycle loop exercises registration/disposal without timing or TTLs.
    {
      let mut state = registry.state.lock().unwrap();
      let entries = &mut state.views.get_mut(&view).unwrap().activities;
      while entries.len() < MAX_REVISION_RECORDS {
        entries.insert(
          Uuid::new_v4(),
          Activity {
            revision: 2,
            closed: true,
            finished: true,
            ..Default::default()
          },
        );
      }
    }
    let error = registry
      .begin(view.clone(), token, Uuid::new_v4(), 1, HashSet::new())
      .err()
      .unwrap();
    assert!(error.msg.contains("Close all panes"));
    assert!(
      registry
        .close(view.clone(), token, Uuid::new_v4(), 2)
        .is_err()
    );
    registry.close(view.clone(), token, alive, 2).unwrap();
    assert!(registry.state.lock().unwrap().views.is_empty());
    let new_token = registry.open(&view).unwrap();
    let request = begin(
      &registry,
      &view,
      new_token,
      Uuid::new_v4(),
      1,
      HashSet::new(),
    );
    registry.accept(&request, HashMap::new()).unwrap();
    registry.finish(&request).unwrap();
    assert!(
      registry
        .begin(view.clone(), token, alive, 3, HashSet::new())
        .is_err()
    );
    registry.close(view.clone(), token, alive, 4).unwrap();
    assert!(registry.matches(&view, &new_token));
  }

  #[test]
  fn hyper_row_activity_full_registry_never_acknowledges_unrecorded_terminal_intent() {
    let registry = HyperRowActivities::default();
    let first = Uuid::new_v4().to_string();
    let other = Uuid::new_v4().to_string();
    let first_context = registry.open(&first).unwrap();
    let other_context = registry.open(&other).unwrap();
    let alive = Uuid::new_v4();
    let request = begin(&registry, &first, first_context, alive, 1, HashSet::new());
    registry.accept(&request, HashMap::new()).unwrap();
    registry.finish(&request).unwrap();
    {
      let mut state = registry.state.lock().unwrap();
      let entries = &mut state.views.get_mut(&other).unwrap().activities;
      for _ in 1..MAX_REVISION_RECORDS {
        entries.insert(
          Uuid::new_v4(),
          Activity {
            revision: 2,
            closed: true,
            finished: true,
            ..Default::default()
          },
        );
      }
    }
    // The activation is still validating membership, so it has no record yet.
    let pending = Uuid::new_v4();
    assert!(
      registry
        .close(first.clone(), first_context, pending, 2)
        .is_err()
    );
    registry.retire(&other).unwrap();
    assert!(!registry.matches(&other, &other_context));
    // Because the close returned an error, its caller retains terminal intent
    // and sends cleanup after the older activation settles.
    let rows = HashSet::from([Uuid::new_v4().to_string().into()]);
    let late = begin(&registry, &first, first_context, pending, 1, rows);
    registry.accept(&late, HashMap::new()).unwrap();
    registry.finish(&late).unwrap();
    assert_eq!(registry.state.lock().unwrap().pins.len(), 1);
    registry
      .close(first.clone(), first_context, pending, 2)
      .unwrap();
    assert!(registry.state.lock().unwrap().pins.is_empty());
    assert!(
      registry
        .begin(first.clone(), first_context, pending, 3, HashSet::new())
        .is_err()
    );
    assert!(registry.matches(&first, &first_context));
    registry.close(first, first_context, alive, 2).unwrap();
    assert!(registry.state.lock().unwrap().views.is_empty());
  }
}
