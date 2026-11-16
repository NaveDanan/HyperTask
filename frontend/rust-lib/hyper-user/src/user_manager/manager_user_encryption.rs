use crate::services::cloud_config::get_encrypt_secret;
use crate::user_manager::UserManager;
use hyper_error::{ErrorCode, HyperError, HyperResult};
use lib_infra::encryption::{decrypt_text, encrypt_text};

impl UserManager {
  pub fn generate_encryption_sign(&self, uid: i64, encrypt_secret: &str) -> HyperResult<String> {
    let encrypt_sign = encrypt_text(uid.to_string(), encrypt_secret)?;
    Ok(encrypt_sign)
  }

  pub fn check_encryption_sign(&self, uid: i64, encrypt_sign: &str) -> HyperResult<()> {
    let store_preference = self
      .get_store_preferences()
      .upgrade()
      .ok_or(HyperError::new(
        ErrorCode::Internal,
        "Failed to get store preference",
      ))?;

    let encrypt_secret = get_encrypt_secret(uid, &store_preference).ok_or(HyperError::new(
      ErrorCode::Internal,
      "Encrypt secret is not set",
    ))?;

    self.check_encryption_sign_with_secret(uid, encrypt_sign, &encrypt_secret)
  }

  pub fn check_encryption_sign_with_secret(
    &self,
    uid: i64,
    encrypt_sign: &str,
    encryption_secret: &str,
  ) -> HyperResult<()> {
    let decrypt_str = decrypt_text(encrypt_sign, encryption_secret)
      .map_err(|_| HyperError::new(ErrorCode::InvalidEncryptSecret, "Invalid decryption secret"))?;
    if uid.to_string() == decrypt_str {
      Ok(())
    } else {
      Err(ErrorCode::InvalidEncryptSecret.into())
    }
  }
}
