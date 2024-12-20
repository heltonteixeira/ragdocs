declare module 'ollama' {
  export interface EmbeddingsRequest {
    model: string;
    prompt: string;
    options?: Record<string, any>;
  }

  export interface EmbeddingsResponse {
    embedding: number[];
  }

  const ollama: {
    embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse>;
  };

  export default ollama;
}
