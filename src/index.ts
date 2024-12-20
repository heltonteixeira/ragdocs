#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { ApiClient } from './api-client.js';
import { SearchDocumentationHandler } from './handlers/search-documentation.js';
import { ListDocumentationHandler } from './handlers/list-documentation.js';
import { ListOptions } from './tools/list-utils.js';
import { Document } from './types.js';

// Force using IP address to avoid hostname resolution issues
const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Test connection with direct axios call first
try {
  const response = await axios.get(`${QDRANT_URL}/collections`);
  console.error('Successfully connected to Qdrant:', response.data);
} catch (error) {
  console.error('Failed to connect to Qdrant:', error);
  throw new McpError(
    ErrorCode.InternalError,
    'Failed to establish initial connection to Qdrant server'
  );
}

const client = new ApiClient({
  qdrantUrl: QDRANT_URL,
  qdrantApiKey: QDRANT_API_KEY,
  embeddingConfig: {
    provider: EMBEDDING_PROVIDER as 'ollama' | 'openai',
    apiKey: OPENAI_API_KEY,
    model: EMBEDDING_PROVIDER === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'
  }
});

try {
  // Initialize Qdrant collection
  await client.qdrant.initializeCollection();
  console.error('Successfully initialized Qdrant collection');
} catch (error) {
  console.error('Failed to initialize Qdrant collection:', error);
  throw error;
}

class RagDocsServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'ragdocs',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'add_document',
          description: 'Add a document to the RAG system',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Document URL' },
              content: { type: 'string', description: 'Document content' },
              metadata: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Document title' },
                  contentType: { type: 'string', description: 'Content type (e.g., text/plain, text/markdown)' },
                },
                additionalProperties: true,
              },
            },
            required: ['url', 'content'],
          },
        },
        {
          name: 'search_documents',
          description: 'Search for documents using semantic similarity',
          inputSchema: {
            type: 'object',
            properties: {
              query: { 
                type: 'string', 
                description: 'Natural language search query' 
              },
              options: {
                type: 'object',
                description: 'Search options',
                properties: {
                  limit: { 
                    type: 'number', 
                    description: 'Maximum number of results (1-20)',
                    minimum: 1,
                    maximum: 20
                  },
                  scoreThreshold: {
                    type: 'number',
                    description: 'Minimum similarity score (0-1)',
                    minimum: 0,
                    maximum: 1
                  },
                  filters: {
                    type: 'object',
                    description: 'Optional filters',
                    properties: {
                      domain: {
                        type: 'string',
                        description: 'Filter by domain'
                      },
                      hasCode: {
                        type: 'boolean',
                        description: 'Filter for documents containing code'
                      },
                      after: {
                        type: 'string',
                        description: 'Filter for documents after date (ISO format)'
                      },
                      before: {
                        type: 'string',
                        description: 'Filter for documents before date (ISO format)'
                      }
                    }
                  }
                }
              }
            },
            required: ['query'],
          },
        },
        {
          name: 'delete_document',
          description: 'Delete a document from the RAG system',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Document URL to delete' },
            },
            required: ['url'],
          },
        },
        {
          name: 'list_documents',
          description: 'List all stored documents with pagination and grouping options',
          inputSchema: {
            type: 'object',
            properties: {
              page: {
                type: 'number',
                description: 'Page number (default: 1)',
                minimum: 1
              },
              pageSize: {
                type: 'number',
                description: 'Number of documents per page (default: 20)',
                minimum: 1,
                maximum: 100
              },
              groupByDomain: {
                type: 'boolean',
                description: 'Group documents by domain (default: false)'
              },
              sortBy: {
                type: 'string',
                description: 'Sort field (default: timestamp)',
                enum: ['timestamp', 'title', 'domain']
              },
              sortOrder: {
                type: 'string',
                description: 'Sort order (default: desc)',
                enum: ['asc', 'desc']
              }
            }
          }
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'add_document': {
            const args = request.params.arguments as Record<string, unknown>;
            if (!args || typeof args.url !== 'string' || typeof args.content !== 'string') {
              throw new Error('Invalid document format: url and content must be strings');
            }
            const doc: Document = {
              url: args.url,
              content: args.content,
              metadata: (args.metadata as Record<string, unknown>) || {}
            };
            await client.addDocument(doc);
            return {
              content: [{ type: 'text', text: `Document ${doc.url} added successfully` }],
            };
          }

          case 'search_documents': {
            const { query, options } = request.params.arguments as { 
              query: string; 
              options?: {
                limit?: number;
                scoreThreshold?: number;
                filters?: {
                  domain?: string;
                  hasCode?: boolean;
                  after?: string;
                  before?: string;
                };
              };
            };

            const searchHandler = new SearchDocumentationHandler(
              client.qdrant,
              client.embeddings,
              this.server,
              client
            );

            return await searchHandler.handle({ query, options });
          }

          case 'delete_document': {
            const { url } = request.params.arguments as { url: string };
            await client.deleteDocument(url);
            return {
              content: [{ type: 'text', text: `Document ${url} deleted successfully` }],
            };
          }

          case 'list_documents': {
            const args = request.params.arguments as ListOptions;
            const listHandler = new ListDocumentationHandler(this.server, client);
            return await listHandler.handle(args || {});
          }

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('[Tool Error]', errorMessage);
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('RagDocs MCP server running on stdio');
  }
}

const server = new RagDocsServer();
server.run().catch(console.error);
