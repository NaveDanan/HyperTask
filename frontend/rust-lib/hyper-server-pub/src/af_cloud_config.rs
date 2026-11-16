use std::fmt::Display;

use serde::{Deserialize, Serialize};

use hyper_error::{ErrorCode, HyperError};

pub const HYPERTASK_CLOUD_BASE_URL: &str = "HYPERTASK_CLOUD_ENV_HYPERTASK_CLOUD_BASE_URL";
pub const HYPERTASK_CLOUD_WS_BASE_URL: &str = "HYPERTASK_CLOUD_ENV_HYPERTASK_CLOUD_WS_BASE_URL";
pub const HYPERTASK_CLOUD_GOTRUE_URL: &str = "HYPERTASK_CLOUD_ENV_HYPERTASK_CLOUD_GOTRUE_URL";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AFCloudConfiguration {
  pub base_url: String,
  pub ws_base_url: String,
  pub gotrue_url: String,
}

impl Display for AFCloudConfiguration {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_fmt(format_args!(
      "base_url: {}, ws_base_url: {}, gotrue_url: {}",
      self.base_url, self.ws_base_url, self.gotrue_url,
    ))
  }
}

impl AFCloudConfiguration {
  pub fn from_env() -> Result<Self, HyperError> {
    let base_url = std::env::var(HYPERTASK_CLOUD_BASE_URL).map_err(|_| {
      HyperError::new(
        ErrorCode::InvalidAuthConfig,
        "Missing HYPERTASK_CLOUD_BASE_URL",
      )
    })?;

    let ws_base_url = std::env::var(HYPERTASK_CLOUD_WS_BASE_URL).map_err(|_| {
      HyperError::new(
        ErrorCode::InvalidAuthConfig,
        "Missing HYPERTASK_CLOUD_WS_BASE_URL",
      )
    })?;

    let gotrue_url = std::env::var(HYPERTASK_CLOUD_GOTRUE_URL)
      .map_err(|_| HyperError::new(ErrorCode::InvalidAuthConfig, "Missing AF_CLOUD_GOTRUE_URL"))?;

    if base_url.is_empty() || ws_base_url.is_empty() || gotrue_url.is_empty() {
      return Err(HyperError::new(
        ErrorCode::InvalidAuthConfig,
        format!(
          "Invalid HYPERTASK_CLOUD_BASE_URL: {}, HYPERTASK_CLOUD_WS_BASE_URL: {}, HYPERTASK_CLOUD_GOTRUE_URL: {}",
          base_url, ws_base_url, gotrue_url,
        )),
      );
    }

    Ok(Self {
      base_url,
      ws_base_url,
      gotrue_url,
    })
  }

  /// Write the configuration to the environment variables.
  pub fn write_env(&self) {
    std::env::set_var(HYPERTASK_CLOUD_BASE_URL, &self.base_url);
    std::env::set_var(HYPERTASK_CLOUD_WS_BASE_URL, &self.ws_base_url);
    std::env::set_var(HYPERTASK_CLOUD_GOTRUE_URL, &self.gotrue_url);
  }
}
