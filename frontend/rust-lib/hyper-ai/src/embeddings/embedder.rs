use crate::embeddings::indexer::EmbeddingModel;
use hyper_error::HyperResult;
use ollama_rs::Ollama;
use ollama_rs::generation::embeddings::GenerateEmbeddingsResponse;
use ollama_rs::generation::embeddings::request::GenerateEmbeddingsRequest;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub enum Embedder {
  Ollama(OllamaEmbedder),
}

impl Embedder {
  pub async fn embed(
    &self,
    request: GenerateEmbeddingsRequest,
  ) -> HyperResult<GenerateEmbeddingsResponse> {
    match self {
      Embedder::Ollama(ollama) => ollama.embed(request).await,
    }
  }

  pub fn model(&self) -> EmbeddingModel {
    EmbeddingModel::NomicEmbedText
  }
}

#[derive(Debug, Clone)]
pub struct OllamaEmbedder {
  pub ollama: Arc<Ollama>,
}

impl OllamaEmbedder {
  pub async fn embed(
    &self,
    request: GenerateEmbeddingsRequest,
  ) -> HyperResult<GenerateEmbeddingsResponse> {
    let resp = self.ollama.generate_embeddings(request).await?;
    Ok(resp)
  }
}
