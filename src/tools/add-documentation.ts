import OpenAI from 'openai';
import { URLProcessor, URLProcessingError } from './url-processor.js';
import { ContentFetcher, ContentFetchError } from './content-fetcher.js';
import { TextChunker } from './text-chunker.js';
import { QdrantWrapper, QdrantError } from './qdrant-client.js';

export class AddDocumentationError extends Error {
  constructor(message: string, public readonly step: string) {
    super(message);
    this.name = 'AddDocumentationError';
  }
}

export interface AddDocumentationResult {
  url: string;
  title: string;
  chunks: number;
  wordCount: number;
}

export class AddDocumentationTool {
  private openai: OpenAI;
  private qdrant: QdrantWrapper;

  constructor(openaiApiKey: string, qdrantUrl?: string) {
    if (!openaiApiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    this.qdrant = new QdrantWrapper(qdrantUrl);
  }

  /**
   * Adds a document to the RAG system
   * @param url URL of the document to add
   * @returns Result of the operation
   */
  async addDocument(url: string): Promise<AddDocumentationResult> {
    try {
      // Check Qdrant health
      const isHealthy = await this.qdrant.isHealthy();
      if (!isHealthy) {
        throw new AddDocumentationError(
          'Qdrant server is not available',
          'health_check'
        );
      }

      // Initialize collection if needed
      await this.qdrant.initializeCollection();

      // Process URL
      const processedUrl = URLProcessor.processURL(url);
      if (!processedUrl.isValid) {
        throw new AddDocumentationError('Invalid URL format', 'url_validation');
      }

      // Check if document already exists
      const exists = await this.qdrant.documentExists(processedUrl.normalizedUrl);
      if (exists) {
        // Remove existing document before adding new version
        await this.qdrant.removeDocument(processedUrl.normalizedUrl);
      }

      // Fetch content
      const content = await ContentFetcher.fetchContent(processedUrl.normalizedUrl);

      // Chunk content
      const chunks = TextChunker.chunkText(content.content, {
        maxChunkSize: 1500, // Leave room for metadata in context window
        minChunkSize: 100,
        overlap: 200,
        respectCodeBlocks: true,
      });

      // Generate embeddings for each chunk
      const embeddings = await this.generateEmbeddings(
        chunks.map(chunk => chunk.content)
      );

      // Store in Qdrant
      await this.qdrant.storeDocumentChunks(chunks, embeddings, {
        url: processedUrl.normalizedUrl,
        title: content.title,
        domain: processedUrl.domain,
        timestamp: content.timestamp,
        contentType: content.metadata.contentType,
        wordCount: content.metadata.wordCount,
        hasCode: content.metadata.hasCode,
      });

      return {
        url: processedUrl.normalizedUrl,
        title: content.title,
        chunks: chunks.length,
        wordCount: content.metadata.wordCount,
      };
    } catch (error) {
      if (
        error instanceof URLProcessingError ||
        error instanceof ContentFetchError ||
        error instanceof QdrantError ||
        error instanceof AddDocumentationError
      ) {
        throw error;
      }

      throw new AddDocumentationError(
        `Unexpected error: ${(error as Error).message}`,
        'unknown'
      );
    }
  }

  /**
   * Generates embeddings for text chunks using OpenAI's API
   * @param chunks Array of text chunks
   * @returns Array of embeddings
   */
  private async generateEmbeddings(chunks: string[]): Promise<number[][]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: chunks,
      });

      return response.data.map(item => item.embedding);
    } catch (error) {
      throw new AddDocumentationError(
        `Failed to generate embeddings: ${(error as Error).message}`,
        'embedding_generation'
      );
    }
  }
}
