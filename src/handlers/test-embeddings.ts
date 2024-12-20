import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { BaseHandler } from './base-handler.js';
import { ApiClient } from '../api-client.js';
import { ToolResult } from '../types.js';
import { EmbeddingService } from '../embeddings.js';

const COLLECTION_NAME = 'documentation';

export class TestEmbeddingsHandler extends BaseHandler {
  constructor(server: Server, apiClient: ApiClient) {
    super(server, apiClient);
  }

  async handle(args: any): Promise<ToolResult> {
    if (!args.text || typeof args.text !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Text is required');
    }

    try {
      // Create a new embedding service instance with the requested configuration
      const tempEmbeddingService = EmbeddingService.createFromConfig({
        provider: args.provider || 'ollama',
        apiKey: args.apiKey,
        model: args.model
      });

      const embedding = await tempEmbeddingService.generateEmbeddings(args.text);
      const provider = args.provider || 'ollama';
      const model = args.model || (provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small');

      // If test is successful, update the server's embedding service
      const newApiClient = new ApiClient({
        embeddingConfig: {
          provider: args.provider || 'ollama',
          apiKey: args.apiKey,
          model: args.model
        },
        qdrantUrl: process.env.QDRANT_URL,
        qdrantApiKey: process.env.QDRANT_API_KEY
      });

      // Initialize collection with new vector size
      await newApiClient.initCollection(COLLECTION_NAME);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully configured ${provider} embeddings (${model}).\nVector size: ${embedding.length}\nQdrant collection updated to match new vector size.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to test embeddings: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
}

export const testEmbeddingsSchema = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'Text to generate embeddings for',
    },
    provider: {
      type: 'string',
      description: 'Embedding provider to use (ollama or openai)',
      enum: ['ollama', 'openai'],
      default: 'ollama',
    },
    apiKey: {
      type: 'string',
      description: 'OpenAI API key (required if provider is openai)',
    },
    model: {
      type: 'string',
      description: 'Model to use for embeddings',
    },
  },
  required: ['text'],
} as const;
