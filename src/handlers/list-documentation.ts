import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { BaseHandler } from './base-handler.js';
import { QdrantWrapper } from '../tools/qdrant-client.js';
import { ListOptions, ListResult, ListUtils } from '../tools/list-utils.js';
import { ToolResult } from '../types.js';
import { ApiClient } from '../api-client.js';

export class ListDocumentationHandler extends BaseHandler {
  protected server: Server;
  protected apiClient: ApiClient;

  constructor(server: Server, apiClient: ApiClient) {
    super(server, apiClient);
    this.server = server;
    this.apiClient = apiClient;
  }

  async handle(args: ListOptions): Promise<ToolResult> {
    try {
      // Ensure Qdrant is initialized
      await this.apiClient.qdrant.initializeCollection();

      // Set default values
      const page = args.page || 1;
      const pageSize = args.pageSize || 20;
      const sortBy = args.sortBy || 'timestamp';
      const sortOrder = args.sortOrder || 'desc';

      // Get documents with pagination
      const { total, documents } = await this.apiClient.qdrant.listDocuments({
        offset: (page - 1) * pageSize,
        limit: pageSize,
        sortBy,
        sortOrder,
      });

      // Calculate pagination details
      const { totalPages } = ListUtils.getPaginationDetails(total, page, pageSize);

      // Sort documents if needed
      const sortedDocs = ListUtils.sortDocuments(documents, sortBy, sortOrder);

      // Group by domain if requested
      const groupedDocs = args.groupByDomain
        ? ListUtils.groupByDomain(sortedDocs)
        : [{ documents: sortedDocs }];

      // Prepare result
      const result: ListResult = {
        total,
        page,
        pageSize,
        totalPages,
        documents: groupedDocs,
      };

      // Format as markdown
      const markdown = ListUtils.formatAsMarkdown(result);

      return {
        content: [
          {
            type: 'text',
            text: markdown,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list documentation: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
