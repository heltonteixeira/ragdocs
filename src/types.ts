import { DocumentMetadata } from './tools/qdrant-client.js';

/** 
 * Metadata specific to files including size, type and content information
 */
export interface FileMetadata {
  fileSize: number;
  fileType: string;
  lastModified: Date;
  contentType: string;
  wordCount: number;
  hasCode: boolean;
}

/**
 * Base document interface representing any document in the system
 */
export interface Document {
  url?: string;
  filePath?: string;
  content?: string;
  metadata: Partial<DocumentMetadata> & Partial<FileMetadata>;
}

/**
 * Specific interface for file-based content with required file metadata
 */
export interface FileContent extends Document {
  filePath: string;
  content?: string;
  metadata: Partial<DocumentMetadata> & FileMetadata;
}

/**
 * Represents a chunk of a document with basic metadata
 */
export interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  timestamp: Date;
}

export function isDocumentChunk(value: unknown): value is DocumentChunk {
  if (!value || typeof value !== 'object') return false;
  
  const chunk = value as Partial<DocumentChunk>;
  
  return typeof chunk.text === 'string' &&
         typeof chunk.url === 'string' &&
         typeof chunk.title === 'string' &&
         chunk.timestamp instanceof Date;
}

export interface DocumentPayload extends DocumentChunk {
  _type: 'DocumentChunk';
  fileSize?: number;
  fileType?: string;
  lastModified?: string;
  contentType?: string;
  wordCount?: number;
  hasCode?: boolean;
  [key: string]: unknown;
}

/**
 * Type guard to verify if an unknown object is a DocumentPayload
 */
export function isDocumentPayload(payload: unknown): payload is DocumentPayload {
  if (!isDocumentChunk(payload)) return false;
  
  const p = payload as Partial<DocumentPayload>;
  
  if (p._type !== 'DocumentChunk') return false;
  
  // Validate optional metadata fields if present
  if (p.fileSize !== undefined && typeof p.fileSize !== 'number') return false;
  if (p.fileType !== undefined && typeof p.fileType !== 'string') return false;
  if (p.contentType !== undefined && typeof p.contentType !== 'string') return false;
  if (p.wordCount !== undefined && typeof p.wordCount !== 'number') return false;
  if (p.hasCode !== undefined && typeof p.hasCode !== 'boolean') return false;
  
  return true;
}

/**
 * Type guard to verify if an unknown object is a FileContent
 */
export function isFileContent(content: unknown): content is FileContent {
  if (!content || typeof content !== 'object') return false;

  const c = content as Partial<FileContent>;

  // Check required fields
  if (typeof c.filePath !== 'string') return false;
  if (!c.content && !c.filePath) return false;

  // Validate metadata object exists
  if (!c.metadata || typeof c.metadata !== 'object') return false;

  const metadata = c.metadata as Partial<FileMetadata>;

  // Validate all required FileMetadata fields
  const hasRequiredMetadata = 
    typeof metadata.fileSize === 'number' &&
    typeof metadata.fileType === 'string' &&
    metadata.lastModified instanceof Date &&
    typeof metadata.contentType === 'string' &&
    typeof metadata.wordCount === 'number' &&
    typeof metadata.hasCode === 'boolean';
    
  return hasRequiredMetadata;
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
