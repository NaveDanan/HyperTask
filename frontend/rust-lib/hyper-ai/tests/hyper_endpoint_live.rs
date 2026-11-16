use futures::StreamExt;
use hyper_ai::openai_endpoint::EndpointConfig;
use serde_json::json;

#[tokio::test]
#[ignore = "Uses the explicitly configured live endpoint and its saved credential"]
async fn hyper_saved_endpoint_streams_text() {
  let path = std::env::var("HYPER_ENDPOINT_CONFIG").expect("Set HYPER_ENDPOINT_CONFIG to the saved endpoint JSON path");
  let config = EndpointConfig::load(&format!("openai+file:{path}")).unwrap();
  let mut stream = config.stream(vec![json!({"role":"user","content":"Reply with OK."})]).await.unwrap();
  let mut text = String::new();
  while let Some(chunk) = stream.next().await { text.push_str(&chunk.unwrap()); }
  assert!(!text.trim().is_empty(), "The saved endpoint returned no streamed text");
}
