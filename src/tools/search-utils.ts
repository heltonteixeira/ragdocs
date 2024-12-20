import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { DocumentMetadata } from './qdrant-client.js';

export interface SearchResult {
  url: string;
  title: string;
  domain: string;
  timestamp: string;
  score: number;
  snippet: string;
  metadata: Partial<DocumentMetadata>;
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

/**
 * Extracts a relevant snippet around the most relevant content
 */
export function extractSnippet(content: string, maxLength: number = 300): string {
  // If content is shorter than maxLength, return it as is
  if (content.length <= maxLength) {
    return content;
  }

  // Find a good breaking point near the middle
  const middle = Math.floor(content.length / 2);
  const radius = Math.floor(maxLength / 2);
  
  let start = Math.max(0, middle - radius);
  let end = Math.min(content.length, middle + radius);

  // Adjust to avoid breaking words
  while (start > 0 && /\S/.test(content[start - 1])) start--;
  while (end < content.length && /\S/.test(content[end])) end++;

  let snippet = content.slice(start, end).trim();

  // Add ellipsis if we're not at the boundaries
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Normalizes scores to be between 0 and 1
 */
export function normalizeScore(score: number): number {
  // Qdrant uses cosine similarity which is already between -1 and 1
  // Convert to 0-1 range
  return (score + 1) / 2;
}

/**
 * Formats search results as markdown
 */
export function formatResultsAsMarkdown(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No matching documents found.';
  }

  return results
    .map((result, index) => {
      const score = (result.score * 100).toFixed(1);
      return `
### ${index + 1}. ${result.title} (${score}% match)
**URL:** ${result.url}
**Domain:** ${result.domain}
**Date:** ${new Date(result.timestamp).toLocaleDateString()}

${result.snippet}
`;
    })
    .join('\n---\n');
}

/**
 * Validates search options
 */
export function validateSearchOptions(options: SearchOptions): void {
  if (options.limit !== undefined && (options.limit < 1 || options.limit > 20)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Limit must be between 1 and 20'
    );
  }

  if (
    options.scoreThreshold !== undefined &&
    (options.scoreThreshold < 0 || options.scoreThreshold > 1)
  ) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Score threshold must be between 0 and 1'
    );
  }

  if (options.filters?.after && isNaN(Date.parse(options.filters.after))) {
    throw new McpError(ErrorCode.InvalidRequest, 'Invalid after date format');
  }

  if (options.filters?.before && isNaN(Date.parse(options.filters.before))) {
    throw new McpError(ErrorCode.InvalidRequest, 'Invalid before date format');
  }
}
