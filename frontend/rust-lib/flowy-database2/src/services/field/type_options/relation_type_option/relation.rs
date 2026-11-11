use std::cmp::Ordering;

use collab_database::fields::relation_type_option::RelationTypeOption;

use collab_database::rows::Cell;
use collab_database::template::relation_parse::RelationCellData;
use collab_database::template::util::ToCellString;
use flowy_error::FlowyResult;

use crate::entities::{RelationCellDataPB, RelationFilterPB};
use crate::services::cell::{CellDataChangeset, CellDataDecoder};
use crate::services::field::{
  CellDataProtobufEncoder, TypeOption, TypeOptionCellDataCompare, TypeOptionCellDataFilter,
  TypeOptionTransform, default_order,
};
use crate::services::sort::SortCondition;

use super::RelationCellChangeset;

impl TypeOption for RelationTypeOption {
  type CellData = RelationCellData;
  type CellChangeset = RelationCellChangeset;
  type CellProtobufType = RelationCellDataPB;
  type CellFilter = RelationFilterPB;
}

impl CellDataChangeset for RelationTypeOption {
  fn apply_changeset(
    &self,
    changeset: RelationCellChangeset,
    cell: Option<Cell>,
  ) -> FlowyResult<(Cell, RelationCellData)> {
    if cell.is_none() {
      let cell_data = RelationCellData {
        row_ids: changeset.inserted_row_ids,
      };
      return Ok(((cell_data.clone()).into(), cell_data));
    }

    let cell_data: RelationCellData = cell.as_ref().unwrap().into();
    let mut row_ids = cell_data.row_ids.clone();
    for inserted in changeset.inserted_row_ids.iter() {
      if !row_ids.iter().any(|row_id| row_id == inserted) {
        row_ids.push(inserted.clone())
      }
    }
    for removed_id in changeset.removed_row_ids.iter() {
      if let Some(index) = row_ids.iter().position(|row_id| row_id == removed_id) {
        row_ids.remove(index);
      }
    }

    let cell_data = RelationCellData { row_ids };

    Ok(((cell_data.clone()).into(), cell_data))
  }
}

impl CellDataDecoder for RelationTypeOption {
  fn stringify_cell_data(&self, cell_data: RelationCellData) -> String {
    cell_data.to_cell_string()
  }
}

impl TypeOptionCellDataCompare for RelationTypeOption {
  fn apply_cmp(
    &self,
    _cell_data: &RelationCellData,
    _other_cell_data: &RelationCellData,
    _sort_condition: SortCondition,
  ) -> Ordering {
    default_order()
  }
}

impl TypeOptionCellDataFilter for RelationTypeOption {
  fn apply_filter(&self, filter: &RelationFilterPB, cell_data: &RelationCellData) -> bool {
    match filter.condition {
      0 => cell_data.row_ids.is_empty(),
      1 => !cell_data.row_ids.is_empty(),
      // Preserve the prior visibility of unsupported saved conditions. Their
      // controls remain read-only until the app understands the operator.
      _ => true,
    }
  }
}

impl TypeOptionTransform for RelationTypeOption {}

impl CellDataProtobufEncoder for RelationTypeOption {
  fn protobuf_encode(&self, cell_data: RelationCellData) -> RelationCellDataPB {
    cell_data.into()
  }
}

#[cfg(test)]
mod hyper_presence_tests {
  use super::*;
  use crate::services::filter::ParseFilterData;

  #[test]
  fn hyper_presence_relation_uses_stored_references_instead_of_visible_titles() {
    let option = RelationTypeOption::default();
    let empty = RelationCellData::default();
    let linked = RelationCellData {
      row_ids: vec!["unavailable-related-row".to_string().into()],
    };
    for (condition, empty_visible, linked_visible) in [(0, true, false), (1, false, true)] {
      let filter = RelationFilterPB::parse(condition, String::new());
      assert_eq!(filter.condition, i64::from(condition));
      assert_eq!(option.apply_filter(&filter, &empty), empty_visible);
      assert_eq!(option.apply_filter(&filter, &linked), linked_visible);
    }
  }

  #[test]
  fn hyper_presence_relation_preserves_unknown_conditions_without_reinterpreting_them() {
    let option = RelationTypeOption::default();
    let filter = RelationFilterPB::parse(255, String::new());
    assert_eq!(filter.condition, 255);
    assert!(option.apply_filter(&filter, &RelationCellData::default()));
    assert!(option.apply_filter(
      &filter,
      &RelationCellData {
        row_ids: vec!["stored-reference".to_string().into()],
      }
    ));
  }
}
