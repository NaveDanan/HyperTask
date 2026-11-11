//! Exercises the actual native client authentication path without GoTrue or real settings.
use super::AFCloudFileStorageServiceImpl;
use crate::af_cloud::AFServer;
use client_api::{Client, ClientConfiguration};
use flowy_storage_pub::cloud::StorageCloudService;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

// Deliberately fake, non-JWT credentials. Never read persisted sessions in this fixture.
const FAKE_ACCESS_TOKEN: &str = "hyper-native-download-test-only-not-a-real-token";
const DEVICE: &str = "hyper-authenticated-download-fixture";
const VERSION: &str = "0.11.4";
const PNG: &[u8] = &[
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0,
  0, 54, 136, 73, 214, 0, 0, 0, 20, 73, 68, 65, 84, 120, 156, 99, 116, 139, 202, 99, 96, 96, 96,
  98, 96, 96, 64, 80, 0, 20, 54, 1, 20, 12, 148, 193, 56, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96,
  130,
];

struct FixtureServer(Arc<Client>);
impl AFServer for FixtureServer {
  fn get_client(&self) -> Option<Arc<Client>> {
    Some(self.0.clone())
  }
  fn try_get_client(&self) -> Result<Arc<Client>, anyhow::Error> {
    Ok(self.0.clone())
  }
}

fn client(server: &str, authenticated: bool) -> Arc<Client> {
  let client = Arc::new(Client::new(
    &format!("{server}/prefix"),
    "ws://127.0.0.1:9/unused",
    &format!("{server}/unused-gotrue"),
    DEVICE,
    ClientConfiguration::default(),
    VERSION,
  ));
  if authenticated {
    client
      .restore_token(
        &serde_json::json!({
          "access_token": FAKE_ACCESS_TOKEN,
          "token_type": "bearer",
          "expires_in": 3_153_600_000_i64,
          "expires_at": 4_102_444_800_i64,
          "refresh_token": "hyper-test-only-refresh-token-never-sent",
          "user": {
            "id": "00000000-0000-4000-8000-000000000007",
            "aud": "authenticated",
            "role": "authenticated",
            "email": "fixture@example.invalid",
            "phone": "",
            "app_metadata": {},
            "user_metadata": {},
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z"
          }
        })
        .to_string(),
      )
      .expect("restore the explicitly fake future token");
  }
  client
}

fn serve_png() -> (String, thread::JoinHandle<String>) {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  listener.set_nonblocking(true).unwrap();
  let base = format!("http://{}", listener.local_addr().unwrap());
  let worker = thread::spawn(move || {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut stream = loop {
      match listener.accept() {
        Ok((stream, _)) => break stream,
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
          assert!(
            Instant::now() < deadline,
            "native provider made no loopback request"
          );
          thread::sleep(Duration::from_millis(5));
        },
        Err(error) => panic!("loopback accept: {error}"),
      }
    };
    stream
      .set_read_timeout(Some(Duration::from_secs(5)))
      .unwrap();
    let mut request = Vec::new();
    let mut buffer = [0; 1024];
    while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
      let read = stream.read(&mut buffer).unwrap();
      assert!(
        read != 0 && request.len() + read < 16 * 1024,
        "invalid native fixture request"
      );
      request.extend_from_slice(&buffer[..read]);
    }
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", PNG.len()).unwrap();
    stream.write_all(PNG).unwrap();
    String::from_utf8(request).unwrap()
  });
  (base, worker)
}

#[tokio::test]
async fn hyper_download_authenticated_provider_builds_native_headers_and_reads_png() {
  let (server, worker) = serve_png();
  let workspace = Uuid::new_v4();
  let url = format!("{server}/prefix/api/file_storage/{workspace}/v1/blob/document/picture.png");
  let service = AFCloudFileStorageServiceImpl::new(FixtureServer(client(&server, true)), None);
  // No request or Authorization header is assembled by the test itself.
  let object = service
    .get_object_bounded(url, workspace, 1024)
    .await
    .unwrap();
  assert_eq!(object.raw.as_ref(), PNG);
  assert_eq!(object.mime.to_string(), "image/png");
  let request = worker.join().unwrap();
  let mut lines = request.split("\r\n");
  assert_eq!(
    lines.next().unwrap(),
    format!("GET /prefix/api/file_storage/{workspace}/v1/blob/document/picture.png HTTP/1.1")
  );
  let headers: BTreeMap<_, _> = lines
    .take_while(|line| !line.is_empty())
    .map(|line| {
      let (name, value) = line.split_once(':').unwrap();
      (name.to_ascii_lowercase(), value.trim().to_string())
    })
    .collect();
  assert_eq!(
    headers.get("authorization").unwrap(),
    &format!("Bearer {FAKE_ACCESS_TOKEN}")
  );
  assert_eq!(headers.get("device-id").unwrap(), DEVICE);
  assert_eq!(headers.get("client-version").unwrap(), VERSION);
  let timestamp = headers
    .get("client-timestamp")
    .unwrap()
    .parse::<i64>()
    .unwrap();
  assert!((timestamp - chrono::Utc::now().timestamp()).abs() < 30);
  assert!(!request.contains("hyper-test-only-refresh-token-never-sent"));
  assert!(!request.contains("unused-gotrue"));
}

#[tokio::test]
async fn hyper_download_authenticated_provider_requires_a_session_before_network() {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  listener.set_nonblocking(true).unwrap();
  let server = format!("http://{}", listener.local_addr().unwrap());
  let workspace = Uuid::new_v4();
  let service = AFCloudFileStorageServiceImpl::new(FixtureServer(client(&server, false)), None);
  assert!(
    service
      .get_object_bounded(
        format!("{server}/prefix/api/file_storage/{workspace}/blob/picture.png"),
        workspace,
        1024
      )
      .await
      .is_err()
  );
  assert!(
    matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
  );
}
