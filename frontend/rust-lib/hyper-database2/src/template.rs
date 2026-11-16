use collab_database::database::{gen_database_id, gen_row_id, timestamp};
use collab_database::entity::{CreateDatabaseParams, CreateViewParams};
use collab_database::fields::select_type_option::{
  SelectOption, SelectOptionColor, SingleSelectTypeOption,
};
use collab_database::rows::CreateRowParams;
use collab_database::views::{DatabaseLayout, LayoutSettings};

use crate::entities::FieldType;
use crate::services::field::FieldBuilder;
use crate::services::field_settings::default_field_settings_for_fields;
use crate::services::setting::{BoardLayoutSetting, CalendarLayoutSetting};

pub fn make_default_grid(view_id: &str, name: &str) -> CreateDatabaseParams {
  let database_id = gen_database_id();
  let timestamp = timestamp();

  let text_field = FieldBuilder::from_field_type(FieldType::RichText)
    .name("Name")
    .primary(true)
    .build();

  let single_select = FieldBuilder::from_field_type(FieldType::SingleSelect)
    .name("Type")
    .build();

  let checkbox_field = FieldBuilder::from_field_type(FieldType::Checkbox)
    .name("Done")
    .build();

  let fields = vec![text_field, single_select, checkbox_field];

  let field_settings = default_field_settings_for_fields(&fields, DatabaseLayout::Grid);

  CreateDatabaseParams {
    database_id: database_id.clone(),
    views: vec![CreateViewParams {
      database_id: database_id.clone(),
      view_id: view_id.to_string(),
      name: name.to_string(),
      layout: DatabaseLayout::Grid,
      layout_settings: Default::default(),
      filters: vec![],
      group_settings: vec![],
      sorts: vec![],
      field_settings,
      created_at: timestamp,
      modified_at: timestamp,
      ..Default::default()
    }],
    rows: vec![
      CreateRowParams::new(gen_row_id(), database_id.clone()),
      CreateRowParams::new(gen_row_id(), database_id.clone()),
      CreateRowParams::new(gen_row_id(), database_id.clone()),
    ],
    fields,
  }
}

pub fn make_default_board(view_id: &str, name: &str) -> CreateDatabaseParams {
  let database_id = gen_database_id();
  let timestamp = timestamp();

  // text
  let text_field = FieldBuilder::from_field_type(FieldType::RichText)
    .name("Description")
    .primary(true)
    .build();

  // single select: the board groups (No status / To Do / Doing / Done) come from these options
  let to_do_option = SelectOption::with_color("To Do", SelectOptionColor::Purple);
  let doing_option = SelectOption::with_color("Doing", SelectOptionColor::Orange);
  let done_option = SelectOption::with_color("Done", SelectOptionColor::Yellow);
  let mut single_select_type_option = SingleSelectTypeOption::default();
  single_select_type_option
    .options
    .extend(vec![to_do_option, doing_option, done_option]);
  let single_select = FieldBuilder::new(FieldType::SingleSelect, single_select_type_option)
    .name("Status")
    .build();

  let fields = vec![text_field, single_select];

  let field_settings = default_field_settings_for_fields(&fields, DatabaseLayout::Board);

  let mut layout_settings = LayoutSettings::default();
  layout_settings.insert(DatabaseLayout::Board, BoardLayoutSetting::new().into());

  CreateDatabaseParams {
    database_id: database_id.clone(),
    views: vec![CreateViewParams {
      database_id,
      view_id: view_id.to_string(),
      name: name.to_string(),
      layout: DatabaseLayout::Board,
      layout_settings,
      filters: vec![],
      group_settings: vec![],
      sorts: vec![],
      field_settings,
      created_at: timestamp,
      modified_at: timestamp,
      ..Default::default()
    }],
    rows: vec![],
    fields,
  }
}

pub fn make_default_calendar(view_id: &str, name: &str) -> CreateDatabaseParams {
  let database_id = gen_database_id();
  let timestamp = timestamp();

  // text
  let text_field = FieldBuilder::from_field_type(FieldType::RichText)
    .name("Title")
    .primary(true)
    .build();

  // date
  let date_field = FieldBuilder::from_field_type(FieldType::DateTime)
    .name("Date")
    .build();
  let date_field_id = date_field.id.clone();

  // multi select
  let multi_select_field = FieldBuilder::from_field_type(FieldType::MultiSelect)
    .name("Tags")
    .build();

  let fields = vec![text_field, date_field, multi_select_field];

  let field_settings = default_field_settings_for_fields(&fields, DatabaseLayout::Calendar);

  let mut layout_settings = LayoutSettings::default();
  layout_settings.insert(
    DatabaseLayout::Calendar,
    CalendarLayoutSetting::new(date_field_id).into(),
  );

  CreateDatabaseParams {
    database_id: database_id.clone(),
    views: vec![CreateViewParams {
      database_id,
      view_id: view_id.to_string(),
      name: name.to_string(),
      layout: DatabaseLayout::Calendar,
      layout_settings,
      filters: vec![],
      group_settings: vec![],
      sorts: vec![],
      field_settings,
      created_at: timestamp,
      modified_at: timestamp,
      ..Default::default()
    }],
    rows: vec![],
    fields,
  }
}

#[cfg(test)]
mod tests {
  use collab_database::views::DatabaseLayout;

  use super::make_default_board;

  #[test]
  fn default_board_starts_without_rows() {
    let params = make_default_board("view_id", "Board");

    assert!(params.rows.is_empty());
    assert_eq!(params.views.len(), 1);
    assert_eq!(params.views[0].layout, DatabaseLayout::Board);
    assert_eq!(params.fields.len(), 2);
  }
}
