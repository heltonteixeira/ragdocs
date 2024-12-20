import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { QdrantWrapper } from '../tools/qdrant-client.js';
import { EmbeddingService } from '../embeddings.js';
import {
  SearchOptions,
  SearchResult,
  validateSearchOptions,
  extractSnippet,
  normalizeScore,
  formatResultsAsMarkdown,
} from '../tools/search-utils.js';

interface SearchDocumentationArgs {
  query: string;
  options?: SearchOptions;
}

export class SearchDocumentationHandler extends BaseHandler {
  private qdrant: QdrantWrapper;
  private embeddings: EmbeddingService;

  constructor(
    qdrant: QdrantWrapper,
    embeddings: EmbeddingService,
    ...args: ConstructorParameters<typeof BaseHandler>
  ) {
    super(...args);
    this.qdrant = qdrant;
    this.embeddings = embeddings;
  }

  async handle(args: SearchDocumentationArgs) {
    // Validate input
    if (!args.query?.trim()) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Query string is required'
      );
    }

    // Validate search options if provided
    if (args.options) {
      validateSearchOptions(args.options);
    }

    try {
      // Generate embeddings for the query
      console.error('Generating embeddings for query:', args.query);
      const queryVector = await this.embeddings.generateEmbeddings(args.query);

      // Search for similar documents
      console.error('Searching for similar documents...');
      const searchResults = await this.qdrant.searchSimilar(queryVector, args.options);

      // Process and format results
      const formattedResults: SearchResult[] = searchResults.map(result => ({
        url: result.url,
        title: result.title,
        domain: result.domain,
        timestamp: result.timestamp,
        score: normalizeScore(result.score),
        snippet: extractSnippet(result.content),
        metadata: {
          contentType: result.contentType,
          wordCount: result.wordCount,
          hasCode: result.hasCode,
          chunkIndex: result.chunkIndex,
          totalChunks: result.totalChunks,
        },
      }));

      // Format results as markdown
      const markdown = formatResultsAsMarkdown(formattedResults);

      return {
        content: [
          {
            type: 'text',
            text: markdown,
          },
        ],
      };
    } catch (error) {
      console.error('Search error:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search documentation: ${error}`
      );
    }
  }
}
