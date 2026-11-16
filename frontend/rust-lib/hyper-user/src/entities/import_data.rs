use hyper_derive::ProtoBuf;
use lib_infra::validator_fn::required_not_empty_str;
use validator::Validate;

#[derive(ProtoBuf, Validate, Default)]
pub struct ImportHypertaskDataPB {
  #[pb(index = 1)]
  #[validate(custom(function = "required_not_empty_str"))]
  pub path: String,

  #[pb(index = 2, one_of)]
  pub import_container_name: Option<String>,

  #[pb(index = 3, one_of)]
  pub parent_view_id: Option<String>,
}
