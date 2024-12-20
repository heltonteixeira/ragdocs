import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { ToolResult } from '../types.js';

export abstract class BaseHandler {
  constructor(
    protected readonly server: Server,
    protected readonly apiClient: ApiClient
  ) {}

  abstract handle(args: any): Promise<ToolResult>;
}
