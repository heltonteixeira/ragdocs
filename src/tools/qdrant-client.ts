import { QdrantClient } from '@qdrant/js-client-rest';
import { TextChunk } from './text-chunker.js';

export interface DocumentMetadata {
  url: string;
  title: string;
  domain: string;
  timestamp: string;
  contentType: string;
  wordCount: number;
  hasCode: boolean;
  chunkIndex: number;
  totalChunks: number;
}

export class QdrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QdrantError';
  }
}

export class QdrantWrapper {
  public client: QdrantClient;
  private readonly collectionName = 'documentation';
  private readonly vectorSize = 768; // Ollama nomic-embed-text size

  constructor(url?: string, apiKey?: string) {
    this.client = new QdrantClient({
      url: url || 'http://localhost:6333',
      apiKey: apiKey,
      timeout: 10000 // Add timeout to help debug connection issues
    });
  }

  /**
   * Initializes the Qdrant collection if it doesn't exist
   */
  async initializeCollection(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === this.collectionName);

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });

        // Create indexes for efficient filtering
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'url',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'domain',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'timestamp',
          field_schema: 'datetime',
        });
      }
    } catch (error) {
      console.error('Qdrant initialization error:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
      }
      throw new QdrantError(
        `Failed to initialize Qdrant collection: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Stores document chunks in the Qdrant collection
   * @param chunks Text chunks to store
   * @param embeddings Corresponding embeddings for each chunk
   * @param metadata Document metadata
   */
  async storeDocumentChunks(
    chunks: TextChunk[],
    embeddings: number[][],
    metadata: Omit<DocumentMetadata, 'chunkIndex' | 'totalChunks'>
  ): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new QdrantError('Number of chunks does not match number of embeddings');
    }

    try {
      const points = chunks.map((chunk, index) => ({
        id: this.generatePointId(metadata.url, chunk.index),
        vector: embeddings[index],
        payload: {
          ...metadata,
          content: chunk.content,
          chunkIndex: chunk.index,
          totalChunks: chunks.length,
          chunkMetadata: chunk.metadata,
        },
      }));

      await this.client.upsert(this.collectionName, {
        wait: true,
        points,
      });
    } catch (error) {
      throw new QdrantError(
        `Failed to store document chunks: ${(error as Error).message}`
      );
    }
  }

  /**
   * Checks if a document already exists in the collection
   * @param url Document URL
   * @returns true if document exists
   */
  private validateUrl(url: string): void {
    try {
      new URL(url);
    } catch (error) {
      throw new QdrantError('Invalid URL format');
    }
  }

  async documentExists(url: string): Promise<boolean> {
    try {
      this.validateUrl(url);
      const response = await this.client.scroll(this.collectionName, {
        filter: {
          must: [
            {
              key: 'url',
              match: {
                value: url,
              },
            },
          ],
        },
        limit: 1,
      });

      return response.points.length > 0;
    } catch (error) {
      throw new QdrantError(
        `Failed to check document existence: ${(error as Error).message}`
      );
    }
  }

  /**
   * Removes a document and all its chunks from the collection
   * @param url Document URL
   */
  async removeDocument(url: string): Promise<void> {
    try {
      this.validateUrl(url);
      await this.client.delete(this.collectionName, {
        filter: {
          must: [
            {
              key: 'url',
              match: {
                value: url,
              },
            },
          ],
        },
        wait: true,
      });
    } catch (error) {
      throw new QdrantError(
        `Failed to remove document: ${(error as Error).message}`
      );
    }
  }

  /**
   * Generates a unique point ID for a chunk
   * @param url Document URL
   * @param chunkIndex Chunk index
   * @returns Unique point ID
   */
  private generatePointId(url: string, chunkIndex: number): number {
    // Create a hash of the URL + chunk index
    const str = `${url}:${chunkIndex}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Gets the health status of the Qdrant server
   * @returns true if server is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists all documents with pagination support
   * @param options Listing options including pagination and filtering
   * @returns Array of document metadata with pagination info
   */
  async listDocuments(options: {
    offset?: number;
    limit?: number;
    domain?: string;
    sortBy?: 'timestamp' | 'title' | 'domain';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ total: number; documents: DocumentMetadata[] }> {
    const filter: any = {
      must: [
        {
          key: 'chunkIndex',
          match: { value: 0 }, // Only get first chunk to avoid duplicates
        },
      ],
    };

    if (options.domain) {
      filter.must.push({
        key: 'domain',
        match: { value: options.domain },
      });
    }

    try {
      // Get total count first
      const countResponse = await this.client.count(this.collectionName, {
        filter,
      });

      // Then get paginated results
      const response = await this.client.scroll(this.collectionName, {
        filter,
        limit: options.limit || 20,
        offset: options.offset || 0,
        with_payload: true,
        with_vector: false,
      });

      const documents = response.points.map(point => {
        const payload = point.payload as any;
        return {
          url: String(payload.url),
          title: String(payload.title),
          domain: String(payload.domain),
          timestamp: String(payload.timestamp),
          contentType: String(payload.contentType),
          wordCount: Number(payload.wordCount),
          hasCode: Boolean(payload.hasCode),
          chunkIndex: Number(payload.chunkIndex),
          totalChunks: Number(payload.totalChunks),
        };
      });

      return {
        total: countResponse.count,
        documents,
      };
    } catch (error) {
      throw new QdrantError(
        `Failed to list documents: ${(error as Error).message}`
      );
    }
  }

  /**
   * Performs a semantic search using vector similarity
   * @param queryVector Query embedding vector
   * @param options Search options
   * @returns Array of search results with scores
   */
  async searchSimilar(
    queryVector: number[],
    options: {
      limit?: number;
      scoreThreshold?: number;
      filters?: {
        domain?: string;
        hasCode?: boolean;
        after?: string;
        before?: string;
      };
    } = {}
  ): Promise<Array<DocumentMetadata & { score: number; content: string }>> {
    const limit = options.limit || 5;
    const scoreThreshold = options.scoreThreshold || 0.7;
    const filter: any = { must: [] };

    // Add filters if specified
    if (options.filters?.domain) {
      filter.must.push({
        key: 'domain',
        match: { value: options.filters.domain },
      });
    }

    if (options.filters?.hasCode !== undefined) {
      filter.must.push({
        key: 'hasCode',
        match: { value: options.filters.hasCode },
      });
    }

    if (options.filters?.after) {
      filter.must.push({
        key: 'timestamp',
        range: { gte: options.filters.after },
      });
    }

    if (options.filters?.before) {
      filter.must.push({
        key: 'timestamp',
        range: { lte: options.filters.before },
      });
    }

    try {
      const response = await this.client.search(this.collectionName, {
        vector: queryVector,
        limit: Math.ceil(limit * 1.5), // Request extra results for post-filtering
        score_threshold: scoreThreshold,
        filter: filter.must.length > 0 ? filter : undefined,
        with_payload: true,
      });

      return response
        .map(hit => {
          const payload = hit.payload as any;
          if (!payload || typeof payload !== 'object') {
            throw new QdrantError('Invalid payload structure in search result');
          }
          
          // Extract and validate required fields
          const result = {
            score: hit.score || 0,
            url: String(payload.url),
            title: String(payload.title),
            domain: String(payload.domain),
            timestamp: String(payload.timestamp),
            contentType: String(payload.contentType),
            wordCount: Number(payload.wordCount),
            hasCode: Boolean(payload.hasCode),
            chunkIndex: Number(payload.chunkIndex),
            totalChunks: Number(payload.totalChunks),
            content: String(payload.content),
          };

          // Validate all fields are present and of correct type
          if (Object.values(result).some(v => v === undefined)) {
            throw new QdrantError('Missing required fields in search result');
          }

          return result;
        })
        .slice(0, limit); // Return only requested number of results
    } catch (error) {
      throw new QdrantError(
        `Failed to perform search: ${(error as Error).message}`
      );
    }
  }
}
