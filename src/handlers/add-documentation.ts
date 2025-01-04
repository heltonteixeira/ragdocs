import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { BaseHandler } from './base-handler.js';
import { ApiClient } from '../api-client.js';
import { DocumentChunk, ToolResult } from '../types.js';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { FileContentFetcher, FileContentFetchError } from '../tools/file-content-fetcher.js';
import { ContentFetcher, ContentFetchError } from '../tools/content-fetcher.js';
const COLLECTION_NAME = 'documentation';
const BATCH_SIZE = 100;

export class AddDocumentationHandler extends BaseHandler {
  constructor(server: Server, apiClient: ApiClient) {
    super(server, apiClient);
  }

  private handleQdrantError(error: unknown): void {
    if (error instanceof Error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Qdrant operation failed: ${error.message}`
      );
    }
    throw new McpError(ErrorCode.InternalError, 'Unknown Qdrant error');
  }

  private handleContentFetchError(error: Error, source: string): void {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to fetch content from ${source}: ${error.message}`
    );
  }

  private handleBrowserError(error: Error, source: string): void {
    throw new McpError(
      ErrorCode.InternalError,
      `Browser error while processing ${source}: ${error.message}`
    );
  }

  private handleUnexpectedError(error: unknown, source: string): void {
    if (error instanceof Error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Unexpected error while processing ${source}: ${error.message}`
      );
    }
    throw new McpError(ErrorCode.InternalError, `Unknown error while processing ${source}`);
  }

  async handle(args: any): Promise<ToolResult> {
    if (!args.url || typeof args.url !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Please provide a valid URL or file path in the "url" parameter'
      );
    }

    // Validate file path format if provided
    if (args.url.startsWith('file://')) {
      const filePath = args.url.slice(7);
      if (!filePath || !filePath.trim()) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid file path format. Must be file:// followed by a valid path'
        );
      }
    }

    // Validate content if provided
    if (args.content && typeof args.content !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Content parameter must be a string if provided'
      );
    }

    try {
      const chunks = await this.fetchAndProcessUrl(args.url, args.content);

      // Batch process chunks for better performance
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const points = await Promise.all(
          batch.map(async (chunk) => {
            const embedding = await this.apiClient.getEmbeddings(chunk.text);
            return {
              id: this.generatePointId(),
              vector: embedding,
              payload: {
                ...chunk,
                _type: 'DocumentChunk' as const,
              } as Record<string, unknown>,
            };
          })
        );

        try {
          await this.apiClient.qdrantClient.upsert(COLLECTION_NAME, {
            wait: true,
            points,
          });
        } catch (error) {
          this.handleQdrantError(error);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully added content from ${args.url} (${chunks.length} chunks processed in ${Math.ceil(chunks.length / BATCH_SIZE)} batches)`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return {
        content: [
          {
            type: 'text',
            text: `Failed to add documentation: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async fetchAndProcessUrl(source: string, content?: string): Promise<DocumentChunk[]> {
    const isUrl = source.startsWith('http://') || source.startsWith('https://') || source.startsWith('file://');

    try {
      if (isUrl) {
        await this.apiClient.initBrowser();
        const page = await this.apiClient.browser.newPage();

        try {
          await page.goto(source, { waitUntil: 'networkidle' });
          const content = await page.content();
          const $ = cheerio.load(content);

          // Remove script tags, style tags, and comments
          $('script').remove();
          $('style').remove();
          $('noscript').remove();

          // Extract main content
          const title = $('title').text() || source;
          const mainContent = $('main, article, .content, .documentation, body').text();

          // Split content into chunks
          const chunks = this.chunkText(mainContent, 1000);

          return chunks.map(chunk => ({
            text: chunk,
            url: source,
            title,
            timestamp: new Date(),
          }));
        } finally {
          await page.close();
        }
      } else {
        // Handle local or remote file content
        const fileContent = await FileContentFetcher.fetchContent(source, content);
        const chunks = this.chunkText(fileContent.content, 1000);

        return chunks.map(chunk => ({
          text: chunk,
          url: source,
          title: fileContent.title,
          timestamp: new Date(fileContent.timestamp),
        }));
      }
    } catch (error) {
      // Handle content fetch errors with specific error types
      if (error instanceof FileContentFetchError || error instanceof ContentFetchError) {
        this.handleContentFetchError(error, source);
      }

      // Handle browser-related errors with specific error handling
      if (error instanceof Error && error.message.includes('browser')) {
        this.handleBrowserError(error, source);
      }

      // Handle any other unexpected errors with detailed context
      this.handleUnexpectedError(error, source);
    }
    return []; // Ensure we always return a DocumentChunk array
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    
    for (const word of words) {
      currentChunk.push(word);
      const currentLength = currentChunk.join(' ').length;
      
      if (currentLength >= maxChunkSize) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
      }
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }
    
    return chunks;
  }

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
