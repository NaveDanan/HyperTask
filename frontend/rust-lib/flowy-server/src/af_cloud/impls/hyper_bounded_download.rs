use flowy_error::{FlowyError, FlowyResult};
use flowy_storage_pub::cloud::ObjectValue;
use reqwest::{Client, Request, redirect::Policy};
use std::time::Duration;
use uuid::Uuid;

const LIMIT: usize = 32 * 1024 * 1024;

fn failed(message: &str) -> FlowyError {
  FlowyError::internal().with_context(message)
}

/// Uses a request built by the native authenticated client. Credentials never
/// cross IPC, and redirects cannot forward the request to another location.
pub(super) async fn hyper_download_cloud_object(
  request: Request,
  server: &str,
  workspace_id: Uuid,
  maximum_bytes: usize,
) -> FlowyResult<ObjectValue> {
  if maximum_bytes == 0 || maximum_bytes > LIMIT {
    return Err(failed("Invalid attachment download limit"));
  }
  let target = request.url();
  let server = target
    .join(server)
    .map_err(|_| failed("Invalid attachment server"))?;
  let prefix = format!(
    "{}/api/file_storage/{}/",
    server.path().trim_end_matches('/'),
    workspace_id
  );
  let resource = target.path().strip_prefix(&prefix);
  if !matches!(target.scheme(), "http" | "https")
    || !target.username().is_empty()
    || target.password().is_some()
    || target.fragment().is_some()
    || target.origin() != server.origin()
    || !resource.is_some_and(|path| path.starts_with("blob/") || path.starts_with("v1/blob/"))
  {
    return Err(failed(
      "This attachment does not belong to the active server and workspace",
    ));
  }
  let client = Client::builder()
    .redirect(Policy::none())
    .timeout(Duration::from_secs(25))
    .build()
    .map_err(|_| failed("Could not initialize attachment download"))?;
  let mut response = client
    .execute(request)
    .await
    .map_err(|_| failed("Could not download the attachment"))?;
  if response.status().as_u16() != 200 {
    return Err(failed(&format!(
      "Attachment download failed (HTTP {})",
      response.status().as_u16()
    )));
  }
  if response
    .content_length()
    .is_some_and(|length| length > maximum_bytes as u64)
  {
    return Err(failed("The attachment exceeds the preview size limit"));
  }
  let mime = response
    .headers()
    .get("content-type")
    .and_then(|value| value.to_str().ok())
    .and_then(|value| value.parse().ok())
    .unwrap_or_else(|| "application/octet-stream".parse().unwrap());
  let mut bytes = Vec::new();
  while let Some(chunk) = response
    .chunk()
    .await
    .map_err(|_| failed("The attachment download was interrupted"))?
  {
    if chunk.len() > maximum_bytes.saturating_sub(bytes.len()) {
      return Err(failed("The attachment exceeds the preview size limit"));
    }
    bytes.extend_from_slice(&chunk);
  }
  if bytes.is_empty() {
    return Err(failed("The attachment is empty"));
  }
  Ok(ObjectValue {
    raw: bytes.into(),
    mime,
  })
}

#[cfg(test)]
mod hyper_download_tests {
  use super::*;
  use std::io::{Read, Write};
  use std::net::TcpListener;
  use std::thread;

  fn serve(response: Vec<u8>) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let thread = thread::spawn(move || {
      let (mut stream, _) = listener.accept().unwrap();
      stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
      let mut request = Vec::new();
      let mut buffer = [0; 1024];
      while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
        let count = stream.read(&mut buffer).unwrap();
        if count == 0 {
          break;
        }
        request.extend_from_slice(&buffer[..count]);
      }
      let _ = stream.write_all(&response);
      String::from_utf8(request).unwrap()
    });
    (base, thread)
  }

  #[tokio::test]
  async fn hyper_download_authenticates_only_the_expected_workspace_and_reads_complete_bytes() {
    let (server, thread) = serve(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nContent-Type: image/png\r\nConnection: close\r\n\r\ncontent".to_vec());
    let workspace = Uuid::new_v4();
    let request = Client::new()
      .get(format!(
        "{server}/api/file_storage/{workspace}/v1/blob/document/image"
      ))
      .bearer_auth("hyper-test-only-token")
      .build()
      .unwrap();
    let object = hyper_download_cloud_object(request, &server, workspace, 16)
      .await
      .unwrap();
    assert_eq!(object.raw.as_ref(), b"content");
    assert_eq!(object.mime.to_string(), "image/png");
    assert!(
      thread
        .join()
        .unwrap()
        .to_ascii_lowercase()
        .contains("authorization: bearer hyper-test-only-token")
    );
  }

  #[tokio::test]
  async fn hyper_download_rejects_other_origins_workspaces_and_paths_before_network() {
    let workspace = Uuid::new_v4();
    for target in [
      format!("http://127.0.0.1:8/api/file_storage/{workspace}/blob/image"),
      format!(
        "http://127.0.0.1:9/api/file_storage/{}/blob/image",
        Uuid::new_v4()
      ),
      "http://127.0.0.1:9/api/user/profile".to_string(),
      format!("http://127.0.0.1:9/api/file_storage/{workspace}/blob/image#fragment"),
    ] {
      let request = Client::new().get(target).build().unwrap();
      let error = hyper_download_cloud_object(request, "http://127.0.0.1:9", workspace, 16)
        .await
        .err()
        .unwrap();
      assert!(error.msg.contains("active server and workspace"));
    }
  }

  #[tokio::test]
  async fn hyper_download_never_follows_redirects_or_returns_an_http_error_body() {
    let (server, thread) = serve(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/private\r\nContent-Length: 12\r\nConnection: close\r\n\r\nsecret-error".to_vec());
    let workspace = Uuid::new_v4();
    let request = Client::new()
      .get(format!("{server}/api/file_storage/{workspace}/blob/image"))
      .build()
      .unwrap();
    let error = hyper_download_cloud_object(request, &server, workspace, 16)
      .await
      .err()
      .unwrap();
    assert!(error.msg.contains("HTTP 302"));
    assert!(!error.msg.contains("secret-error"));
    thread.join().unwrap();
  }

  #[tokio::test]
  async fn hyper_download_bounds_both_declared_and_chunked_content() {
    for response in [
      b"HTTP/1.1 200 OK\r\nContent-Length: 32\r\nConnection: close\r\n\r\n01234567890123456789012345678901".to_vec(),
      b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n10\r\n0123456789012345\r\n4\r\n6789\r\n0\r\n\r\n".to_vec(),
    ] {
      let (server, thread) = serve(response);
      let workspace = Uuid::new_v4();
      let request = Client::new().get(format!("{server}/api/file_storage/{workspace}/blob/image")).build().unwrap();
      let error = hyper_download_cloud_object(request, &server, workspace, 16).await.err().unwrap();
      assert!(error.msg.contains("size limit"));
      thread.join().unwrap();
    }
  }
}
