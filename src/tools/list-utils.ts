import { DocumentMetadata } from './qdrant-client.js';

export interface ListOptions {
  page?: number;
  pageSize?: number;
  groupByDomain?: boolean;
  sortBy?: 'timestamp' | 'title' | 'domain';
  sortOrder?: 'asc' | 'desc';
}

export interface ListResult {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  documents: DocumentGroup[];
}

export interface DocumentGroup {
  domain?: string;
  documents: DocumentMetadata[];
}

export class ListUtils {
  /**
   * Groups documents by domain
   */
  static groupByDomain(documents: DocumentMetadata[]): DocumentGroup[] {
    const groupedMap = new Map<string, DocumentMetadata[]>();
    
    for (const doc of documents) {
      const domain = doc.domain;
      if (!groupedMap.has(domain)) {
        groupedMap.set(domain, []);
      }
      groupedMap.get(domain)!.push(doc);
    }

    return Array.from(groupedMap.entries()).map(([domain, docs]) => ({
      domain,
      documents: docs
    }));
  }

  /**
   * Sorts documents based on specified criteria
   */
  static sortDocuments(
    documents: DocumentMetadata[],
    sortBy: 'timestamp' | 'title' | 'domain' = 'timestamp',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): DocumentMetadata[] {
    return [...documents].sort((a, b) => {
      let comparison: number;
      switch (sortBy) {
        case 'timestamp':
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'domain':
          comparison = a.domain.localeCompare(b.domain);
          break;
        default:
          comparison = 0;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }

  /**
   * Formats the list result as markdown
   */
  static formatAsMarkdown(result: ListResult): string {
    const lines: string[] = [];
    
    // Add header with pagination info
    lines.push(`# Documentation List`);
    lines.push(`Page ${result.page} of ${result.totalPages} (${result.total} total documents)\n`);

    // Add documents grouped by domain
    for (const group of result.documents) {
      if (group.domain) {
        lines.push(`## ${group.domain}`);
      }

      for (const doc of group.documents) {
        const date = new Date(doc.timestamp).toLocaleDateString();
        lines.push(`- [${doc.title}](${doc.url})`);
        lines.push(`  - Added: ${date}`);
        lines.push(`  - Type: ${doc.contentType}`);
        lines.push(`  - Words: ${doc.wordCount}`);
        if (doc.hasCode) {
          lines.push(`  - Contains code snippets`);
        }
        lines.push(``);
      }
    }

    return lines.join('\n');
  }

  /**
   * Calculates pagination details
   */
  static getPaginationDetails(
    total: number,
    page: number = 1,
    pageSize: number = 20
  ): { offset: number; limit: number; totalPages: number } {
    const totalPages = Math.ceil(total / pageSize);
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const offset = (currentPage - 1) * pageSize;
    
    return {
      offset,
      limit: pageSize,
      totalPages
    };
  }
}
