import ollama from 'ollama';
import OpenAI from 'openai';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export interface EmbeddingProvider {
  generateEmbeddings(text: string): Promise<number[]>;
  getVectorSize(): number;
}

export class OllamaProvider implements EmbeddingProvider {
  private model: string;

  constructor(model: string = 'nomic-embed-text') {
    this.model = model;
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    try {
      console.error('Generating Ollama embeddings for text:', text.substring(0, 50) + '...');
      const response = await ollama.embeddings({
        model: this.model,
        prompt: text
      });
      console.error('Successfully generated Ollama embeddings with size:', response.embedding.length);
      return response.embedding;
    } catch (error) {
      console.error('Ollama embedding error:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate embeddings with Ollama: ${error}`
      );
    }
  }

  getVectorSize(): number {
    // nomic-embed-text produces 768-dimensional vectors
    return 768;
  }
}

export class OpenAIProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    try {
      console.error('Generating OpenAI embeddings for text:', text.substring(0, 50) + '...');
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });
      const embedding = response.data[0].embedding;
      console.error('Successfully generated OpenAI embeddings with size:', embedding.length);
      return embedding;
    } catch (error) {
      console.error('OpenAI embedding error:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate embeddings with OpenAI: ${error}`
      );
    }
  }

  getVectorSize(): number {
    // text-embedding-3-small produces 1536-dimensional vectors
    return 1536;
  }
}

export class EmbeddingService {
  private provider: EmbeddingProvider;

  constructor(provider: EmbeddingProvider) {
    this.provider = provider;
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    return this.provider.generateEmbeddings(text);
  }

  getVectorSize(): number {
    return this.provider.getVectorSize();
  }

  static createFromConfig(config: {
    provider: 'ollama' | 'openai';
    apiKey?: string;
    model?: string;
  }): EmbeddingService {
    switch (config.provider) {
      case 'ollama':
        return new EmbeddingService(new OllamaProvider(config.model));
      case 'openai':
        if (!config.apiKey) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'OpenAI API key is required'
          );
        }
        return new EmbeddingService(new OpenAIProvider(config.apiKey, config.model));
      default:
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unknown embedding provider: ${config.provider}`
        );
    }
  }
}
