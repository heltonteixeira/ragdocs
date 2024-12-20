import { QdrantClient } from '@qdrant/js-client-rest';
import { chromium } from 'playwright';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { EmbeddingService } from './embeddings.js';
import { QdrantWrapper } from './tools/qdrant-client.js';
import { Document } from './types.js';

export interface QdrantCollectionConfig {
  params: {
    vectors: {
      size: number;
      distance: string;
    };
  };
}

export interface QdrantCollectionInfo {
  config: QdrantCollectionConfig;
}

export class ApiClient {
  qdrantClient: QdrantClient;
  private embeddingService: EmbeddingService;
  readonly qdrant: QdrantWrapper;
  browser: any;

  constructor(config: {
    embeddingConfig: {
      provider: 'ollama' | 'openai';
      apiKey?: string;
      model?: string;
    };
    qdrantUrl?: string;
    qdrantApiKey?: string;
  }) {
    this.embeddingService = EmbeddingService.createFromConfig(config.embeddingConfig);

    this.qdrant = new QdrantWrapper(config.qdrantUrl, config.qdrantApiKey);
    this.qdrantClient = this.qdrant.client;
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch();
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getEmbeddings(text: string): Promise<number[]> {
    return this.embeddingService.generateEmbeddings(text);
  }

  get embeddings(): EmbeddingService {
    return this.embeddingService;
  }

  async initCollection(collectionName: string) {
    try {
      const collections = await this.qdrantClient.getCollections();
      const exists = collections.collections.some(c => c.name === collectionName);

      const requiredVectorSize = this.embeddingService.getVectorSize();

      if (!exists) {
        console.error(`Creating new collection with vector size ${requiredVectorSize}`);
        await this.createCollection(collectionName, requiredVectorSize);
        return;
      }

      // Verify vector size of existing collection
      const collectionInfo = await this.qdrantClient.getCollection(collectionName) as QdrantCollectionInfo;
      const currentVectorSize = collectionInfo.config?.params?.vectors?.size;

      if (!currentVectorSize) {
        console.error('Could not determine current vector size, recreating collection...');
        await this.recreateCollection(collectionName, requiredVectorSize);
        return;
      }

      if (currentVectorSize !== requiredVectorSize) {
        console.error(`Vector size mismatch: collection=${currentVectorSize}, required=${requiredVectorSize}`);
        await this.recreateCollection(collectionName, requiredVectorSize);
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized')) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Failed to authenticate with Qdrant. Please check your API key.'
          );
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
          throw new McpError(
            ErrorCode.InternalError,
            'Failed to connect to Qdrant. Please check your QDRANT_URL.'
          );
        }
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize Qdrant collection: ${error}`
      );
    }
  }

  private async createCollection(collectionName: string, vectorSize: number) {
    await this.qdrantClient.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
      optimizers_config: {
        default_segment_number: 2,
        memmap_threshold: 20000,
      },
      replication_factor: 2,
    });

    // Create indexes for efficient filtering
    await this.qdrantClient.createPayloadIndex(collectionName, {
      field_name: 'url',
      field_schema: 'keyword',
    });

    await this.qdrantClient.createPayloadIndex(collectionName, {
      field_name: 'timestamp',
      field_schema: 'datetime',
    });
  }

  private async recreateCollection(collectionName: string, vectorSize: number) {
    try {
      console.error('Recreating collection with new vector size...');
      await this.qdrantClient.deleteCollection(collectionName);
      await this.createCollection(collectionName, vectorSize);
      console.error(`Collection recreated with new vector size ${vectorSize}`);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to recreate collection: ${error}`
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.qdrantClient.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  async addDocument(doc: Document): Promise<void> {
    try {
      // Check if document already exists
      if (await this.qdrant.documentExists(doc.url)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Document with URL ${doc.url} already exists`
        );
      }

      // Generate embeddings for the content
      const embedding = await this.embeddingService.generateEmbeddings(doc.content);

      // Store document in Qdrant
      await this.qdrant.storeDocumentChunks(
        [{
          content: doc.content,
          index: 0,
          metadata: {
            startPosition: 0,
            endPosition: doc.content.length,
            isCodeBlock: /```/.test(doc.content)
          }
        }],
        [embedding],
        {
          url: doc.url,
          title: doc.metadata.title || '',
          domain: new URL(doc.url).hostname,
          timestamp: new Date().toISOString(),
          contentType: doc.metadata.contentType || 'text/plain',
          wordCount: doc.content.split(/\s+/).length,
          hasCode: /```|\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bvar\b/.test(doc.content),
        }
      );
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to add document: ${error}`
      );
    }
  }

  async deleteDocument(url: string): Promise<void> {
    try {
      await this.qdrant.removeDocument(url);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete document: ${error}`
      );
    }
  }
}
