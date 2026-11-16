//! Core initialization configuration and `hypertask.yaml` handling.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use hyper_server_pub::af_cloud_config::AFCloudConfiguration;
use hyper_server_pub::AuthenticatorType;

#[derive(Deserialize, Debug)]
pub struct HypertaskConfiguration {
  /// The root path of the application
  pub root: String,
  pub app_version: String,
  /// This path will be used to store the user data
  pub custom_app_path: String,
  pub origin_app_path: String,
  pub device_id: String,
  pub platform: String,
  pub authenticator_type: AuthenticatorType,
  pub(crate) hypertask_cloud_config: AFCloudConfiguration,
  #[serde(default)]
  pub(crate) envs: HashMap<String, String>,
}

impl HypertaskConfiguration {
  pub fn write_env(&self) {
    self.authenticator_type.write_env();
    self.hypertask_cloud_config.write_env();

    for (k, v) in self.envs.iter() {
      std::env::set_var(k, v);
    }
  }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HypertaskYamlConfiguration {
  cloud_config: Vec<AFCloudConfiguration>,
}

pub fn save_hypertask_cloud_config(
  root: impl AsRef<Path>,
  new_config: &AFCloudConfiguration,
) -> Result<(), Box<dyn std::error::Error>> {
  let file_path = root.as_ref().join("hypertask.yaml");
  let mut config = read_yaml_file(&file_path).unwrap_or_default();

  if !config
    .cloud_config
    .iter()
    .any(|c| c.base_url == new_config.base_url)
  {
    config.cloud_config.push(new_config.clone());
    write_yaml_file(&file_path, &config)?;
  }
  Ok(())
}

fn read_yaml_file(
  file_path: impl AsRef<Path>,
) -> Result<HypertaskYamlConfiguration, Box<dyn std::error::Error>> {
  let mut file = File::open(file_path)?;
  let mut contents = String::new();
  file.read_to_string(&mut contents)?;
  let config: HypertaskYamlConfiguration = serde_yaml::from_str(&contents)?;
  Ok(config)
}

fn write_yaml_file(
  file_path: impl AsRef<Path>,
  config: &HypertaskYamlConfiguration,
) -> Result<(), Box<dyn std::error::Error>> {
  let yaml_string = serde_yaml::to_string(config)?;
  let mut file = OpenOptions::new()
    .create(true)
    .write(true)
    .truncate(true)
    .open(file_path)?;
  file.write_all(yaml_string.as_bytes())?;
  Ok(())
}
