import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { FetchedContent } from './content-fetcher.js';
import { TextChunker } from './text-chunker.js';

export interface FetchedFileContent extends FetchedContent {
  metadata: {
    domain: string;
    contentType: string;
    wordCount: number;
    hasCode: boolean;
    fileSize: number;
    fileType: string;
    lastModified: string;
  };
}

export class FileContentFetchError extends Error {
  constructor(message: string, public readonly path: string) {
    super(message);
    this.name = 'FileContentFetchError';
  }
}

export class FileContentFetcher {
  private static readonly TIMEOUT = 30000; // 30 seconds
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 1000; // 1 second
  private static readonly SUPPORTED_EXTENSIONS: string[] = process.env.SUPPORTED_EXTENSIONS
    ? process.env.SUPPORTED_EXTENSIONS.split(',')
    : ['.txt', '.md', '.pdf', '.docx'];
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  private static async retryOperation<T>(
    operation: () => Promise<T>,
    errorHandler?: (error: Error) => void | Promise<void>
  ): Promise<T> {
    let retries = 0;
    let lastError: Error | null = null;

    while (retries < this.MAX_RETRIES) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (errorHandler) {
          await errorHandler(lastError);
        }
        retries++;
        if (retries < this.MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
        }
      }
    }

    throw lastError;
  }

  static async fetchContent(filePath: string, content?: string): Promise<FetchedFileContent> {
    if (content) {
      const fileExtension = path.extname(filePath).toLowerCase();
      const stats = {
        size: Buffer.byteLength(content),
        mtime: new Date()
      };
      return this.processFileContent(filePath, content, stats);
    }
    
    const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://');
    return isUrl ? this.fetchRemoteFile(filePath) : this.fetchLocalFile(filePath);
  }

  private static async fetchLocalFile(filePath: string): Promise<FetchedFileContent> {
    let retries = 0;
    let lastError: Error | null = null;

    while (retries < this.MAX_RETRIES) {
      try {
        const stats = await fs.stat(filePath);
        const fileExtension = path.extname(filePath).toLowerCase();

        if (!this.SUPPORTED_EXTENSIONS.includes(fileExtension)) {
          throw new FileContentFetchError(`Unsupported file type: ${fileExtension}`, filePath);
        }

        if (stats.size > this.MAX_FILE_SIZE) {
          throw new FileContentFetchError(`File size exceeds maximum limit of ${this.MAX_FILE_SIZE} bytes`, filePath);
        }

        const buffer = await fs.readFile(filePath);
        if (!this.isValidUtf8(buffer)) {
          throw new FileContentFetchError('File encoding is not valid UTF-8', filePath);
        }

        const content = buffer.toString('utf-8');
        return await this.processFileContent(filePath, content, stats);
      } catch (error) {
        lastError = error as Error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new FileContentFetchError('File not found', filePath);
        }
        retries++;
        if (retries < this.MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
        }
      }
    }

    throw new FileContentFetchError(
      `Failed to fetch content after ${this.MAX_RETRIES} attempts: ${lastError?.message}`,
      filePath
    );
  }

  private static async fetchRemoteFile(url: string): Promise<FetchedFileContent> {
    return this.retryOperation(async () => {
      const response = await axios.get(url, {
        timeout: this.TIMEOUT,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RagDocsBot/1.0)',
        },
      });

      if (response.data.byteLength > this.MAX_FILE_SIZE) {
        throw new FileContentFetchError(`File size exceeds maximum limit of ${this.MAX_FILE_SIZE} bytes`, url);
      }

      if (!this.isValidUtf8(response.data)) {
        throw new FileContentFetchError('File encoding is not valid UTF-8', url);
      }

      const content = response.data.toString('utf-8');
      const fileExtension = path.extname(url).toLowerCase();
      
      if (!this.SUPPORTED_EXTENSIONS.includes(fileExtension)) {
        throw new FileContentFetchError(`Unsupported file type: ${fileExtension}`, url);
      }

      const stats = {
        size: response.headers['content-length'] 
          ? parseInt(response.headers['content-length']) 
          : Buffer.byteLength(response.data),
        mtime: response.headers['last-modified'] 
          ? new Date(response.headers['last-modified']) 
          : new Date(),
      };

      return await this.processFileContent(url, content, stats);
    }, (error) => {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new FileContentFetchError('File not found', url);
      }
    });
  }

  private static async processFileContent(
    filePath: string,
    content: string,
    stats: { size: number; mtime: Date }
  ): Promise<FetchedFileContent> {
    const fileExtension = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://');
    const domain = isUrl ? new URL(filePath).hostname : 
                 filePath.startsWith('./') || filePath.startsWith('../') ? 'local' : 'direct';

    const hasCode = fileExtension === '.md' ? 
      content.includes('```') || /\`[^\`]+\`/.test(content) :
      false;

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    const processedContent = await this.processContentByType(content, fileExtension);

    return {
      url: filePath,
      title: fileName,
      content: processedContent,
      timestamp: stats.mtime.toISOString(),
      metadata: {
        domain,
        contentType: this.getContentType(fileExtension),
        wordCount,
        hasCode,
        fileSize: stats.size,
        fileType: fileExtension.slice(1),
        lastModified: stats.mtime.toISOString(),
      },
    };
  }

  private static async processContentByType(content: string, fileExtension: string): Promise<string> {
    switch (fileExtension) {
      case '.md':
        return this.processMarkdownContent(content);
      case '.txt':
        return this.processTextContent(content);
      case '.pdf':
        return await this.processPdfContent(content);
      case '.docx':
        return await this.processDocxContent(content);
      default:
        return content;
    }
  }

  private static isValidUtf8(buffer: Buffer): boolean {
    try {
      buffer.toString('utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private static async processPdfContent(content: string): Promise<string> {
    try {
      const pdfParse = await import('pdf-parse');
      const buffer = Buffer.from(content);
      const { text } = await pdfParse.default(buffer);
      return text;
    } catch (error) {
      throw new FileContentFetchError('Failed to parse PDF content', '');
    }
  }

  private static async processDocxContent(content: string): Promise<string> {
    try {
      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: Buffer.from(content) });
      return result.value;
    } catch (error) {
      throw new FileContentFetchError('Failed to parse DOCX content', '');
    }
  }

  private static processMarkdownContent(content: string): string {
    return content
      .replace(/[\r\n]+/g, '\n')
      .replace(/\n\s+\n/g, '\n\n')
      .trim();
  }

  private static processTextContent(content: string): string {
    return content
      .replace(/[\r\n]+/g, '\n')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s+]|[\s+]$/g, '')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  private static getContentType(fileExtension: string): string {
    const contentTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return contentTypes[fileExtension] || 'application/octet-stream';
  }
}
