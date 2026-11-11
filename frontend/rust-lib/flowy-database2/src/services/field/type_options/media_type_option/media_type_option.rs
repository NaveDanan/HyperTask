use crate::{
  entities::{
    FieldType, MediaCellChangeset, MediaCellDataPB, MediaFilterConditionPB, MediaFilterPB,
  },
  services::{
    cell::{CellDataChangeset, CellDataDecoder},
    field::{
      CellDataProtobufEncoder, TypeOption, TypeOptionCellData, TypeOptionCellDataCompare,
      TypeOptionCellDataFilter, TypeOptionTransform, default_order,
    },
    sort::SortCondition,
  },
};
use collab_database::fields::media_type_option::{MediaCellData, MediaTypeOption};
use collab_database::template::util::ToCellString;
use collab_database::{fields::Field, rows::Cell};
use flowy_error::FlowyResult;
use std::cmp::Ordering;

impl TypeOption for MediaTypeOption {
  type CellData = MediaCellData;
  type CellChangeset = MediaCellChangeset;
  type CellProtobufType = MediaCellDataPB;
  type CellFilter = MediaFilterPB;
}

impl TypeOptionTransform for MediaTypeOption {}

impl CellDataProtobufEncoder for MediaTypeOption {
  fn protobuf_encode(
    &self,
    cell_data: <Self as TypeOption>::CellData,
  ) -> <Self as TypeOption>::CellProtobufType {
    cell_data.into()
  }
}

impl CellDataDecoder for MediaTypeOption {
  fn decode_cell_with_transform(
    &self,
    _cell: &Cell,
    from_field_type: FieldType,
    _field: &Field,
  ) -> Option<<Self as TypeOption>::CellData> {
    match from_field_type {
      FieldType::RichText
      | FieldType::Number
      | FieldType::DateTime
      | FieldType::SingleSelect
      | FieldType::MultiSelect
      | FieldType::Checkbox
      | FieldType::URL
      | FieldType::Summary
      | FieldType::Translate
      | FieldType::Time
      | FieldType::Checklist
      | FieldType::LastEditedTime
      | FieldType::CreatedTime
      | FieldType::Relation
      | FieldType::Media => None,
    }
  }

  fn stringify_cell_data(&self, cell_data: <Self as TypeOption>::CellData) -> String {
    cell_data.to_cell_string()
  }
}

impl CellDataChangeset for MediaTypeOption {
  fn apply_changeset(
    &self,
    changeset: <Self as TypeOption>::CellChangeset,
    cell: Option<Cell>,
  ) -> FlowyResult<(Cell, <Self as TypeOption>::CellData)> {
    if cell.is_none() {
      let cell_data = MediaCellData {
        files: changeset.inserted_files,
      };
      return Ok((cell_data.clone().into(), cell_data));
    }

    let cell_data: MediaCellData = MediaCellData::from(&cell.unwrap());
    let mut files = cell_data.files.clone();
    for removed_id in changeset.removed_ids.iter() {
      if let Some(index) = files.iter().position(|file| file.id == removed_id.clone()) {
        files.remove(index);
      }
    }

    for inserted in changeset.inserted_files.iter() {
      if !files.iter().any(|file| file.id == inserted.id) {
        files.push(inserted.clone())
      }
    }

    let cell_data = MediaCellData { files };

    Ok((Cell::from(cell_data.clone()), cell_data))
  }
}

impl TypeOptionCellDataFilter for MediaTypeOption {
  fn apply_filter(
    &self,
    filter: &<Self as TypeOption>::CellFilter,
    cell_data: &<Self as TypeOption>::CellData,
  ) -> bool {
    match filter.condition {
      MediaFilterConditionPB::MediaIsEmpty => cell_data.files.is_empty(),
      MediaFilterConditionPB::MediaIsNotEmpty => !cell_data.files.is_empty(),
    }
  }
}

impl TypeOptionCellDataCompare for MediaTypeOption {
  fn apply_cmp(
    &self,
    cell_data: &<Self as TypeOption>::CellData,
    other_cell_data: &<Self as TypeOption>::CellData,
    _sort_condition: SortCondition,
  ) -> Ordering {
    match (cell_data.files.is_empty(), other_cell_data.is_cell_empty()) {
      (true, true) => Ordering::Equal,
      (true, false) => Ordering::Greater,
      (false, true) => Ordering::Less,
      (false, false) => default_order(),
    }
  }
}

#[cfg(test)]
mod hyper_presence_tests {
  use super::*;

  #[test]
  fn hyper_presence_media_uses_attachment_records_even_without_display_names() {
    let mut attached = MediaCellData::default();
    attached.files.push(Default::default());
    attached.files[0].id = "stored-attachment".into();
    attached.files[0].url = "https://example.invalid/no-fetch".into();
    let empty = MediaCellData::default();
    for hide_file_names in [false, true] {
      let option = MediaTypeOption { hide_file_names };
      for (condition, empty_visible, attached_visible) in [
        (MediaFilterConditionPB::MediaIsEmpty, true, false),
        (MediaFilterConditionPB::MediaIsNotEmpty, false, true),
      ] {
        let filter = MediaFilterPB {
          condition,
          content: String::new(),
        };
        assert_eq!(option.apply_filter(&filter, &empty), empty_visible);
        assert_eq!(option.apply_filter(&filter, &attached), attached_visible);
      }
    }
  }

  #[test]
  fn hyper_presence_media_empty_condition_matches_after_removing_the_final_reference() {
    let option = MediaTypeOption::default();
    let filter = MediaFilterPB {
      condition: MediaFilterConditionPB::MediaIsEmpty,
      content: String::new(),
    };
    let mut data = MediaCellData::default();
    data.files.push(Default::default());
    assert!(!option.apply_filter(&filter, &data));
    data.files.clear();
    assert!(option.apply_filter(&filter, &data));
  }
}
