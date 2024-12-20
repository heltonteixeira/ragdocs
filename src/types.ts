import { DocumentMetadata } from './tools/qdrant-client.js';

export interface Document {
  url: string;
  content: string;
  metadata: Partial<DocumentMetadata>;
}

export interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  timestamp: string;
}

export interface DocumentPayload extends DocumentChunk {
  _type: 'DocumentChunk';
  [key: string]: unknown;
}

export function isDocumentPayload(payload: unknown): payload is DocumentPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<DocumentPayload>;
  return (
    p._type === 'DocumentChunk' &&
    typeof p.text === 'string' &&
    typeof p.url === 'string' &&
    typeof p.title === 'string' &&
    typeof p.timestamp === 'string'
  );
}

export interface SearchOptions {
  limit?: number;
  scoreThreshold?: number;
  filters?: {
    domain?: string;
    hasCode?: boolean;
    after?: string;
    before?: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export interface ToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

export interface RagDocsConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  openaiApiKey: string;
  collectionName: string;
}
