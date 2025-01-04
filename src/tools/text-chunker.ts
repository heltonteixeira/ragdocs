export interface ChunkingStrategy {
  chunk(text: string, options: ChunkOptions): TextChunk[];
}

export enum FileType {
  TEXT = 'text',
  MARKDOWN = 'markdown',
  PDF = 'pdf',
  DOCX = 'docx'
}

/**
 * Options for configuring text chunking behavior
 */
export interface ChunkOptions {
  /** Maximum size of each chunk in characters */
  maxChunkSize: number;
  /** Minimum size of each chunk in characters */
  minChunkSize: number;
  /** Number of characters to overlap between chunks */
  overlap: number;
  /** Number of words to overlap between chunks */
  overlapWords?: number;
  /** Whether to preserve code blocks as single chunks */
  respectCodeBlocks?: boolean;
  /** Type of file being processed */
  fileType?: FileType;
  /** Whether to preserve document structure */
  preserveStructure?: boolean;
}

/**
 * Represents a chunk of text with associated metadata
 */
export interface TextChunk {
  /** The actual text content of the chunk */
  content: string;
  /** Sequential index of the chunk */
  index: number;
  /** Metadata describing the chunk's properties and context */
  metadata: {
    /** Starting character position in the original text */
    startPosition: number;
    /** Ending character position in the original text */
    endPosition: number;
    /** Indicates if the chunk contains code block content */
    isCodeBlock?: boolean;
    /** The type of file from which the chunk was extracted */
    fileType?: FileType;
    /** Additional structural metadata depending on file type */
    structureMetadata?: {
      /** Section or content headings present in the chunk */
      headings?: string[];
      /** Page numbers for PDF content */
      pageNumbers?: number[];
      /** Character positions of paragraph breaks */
      paragraphBreaks?: number[];
    };
  };
}

export class TextChunker {
  private static readonly DEFAULT_OPTIONS: ChunkOptions = {
    maxChunkSize: 1000,
    minChunkSize: 100,
    overlap: 200,
    overlapWords: 20,
    respectCodeBlocks: true,
  };

  private static validateText(text: string): void {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text must be a non-empty string');
    }
  }

  static chunkText(text: string, options?: Partial<ChunkOptions>): TextChunk[] {
    this.validateText(text);
    const opts = this.validateOptions(options || {});
    const strategy = this.getChunkingStrategy(opts.fileType || FileType.TEXT);

    if (opts.respectCodeBlocks && (opts.fileType === FileType.TEXT || opts.fileType === FileType.MARKDOWN)) {
      const segments = this.separateCodeBlocks(text);
      const chunks: TextChunk[] = [];
      let currentPosition = 0;

      for (const segment of segments) {
        const segmentChunks = segment.isCodeBlock
          ? this.chunkSegment(segment.content, opts, currentPosition, chunks.length, true)
          : strategy.chunk(segment.content, opts);

        chunks.push(...segmentChunks);
        currentPosition += segment.content.length;
      }

      return chunks;
    }

    return strategy.chunk(text, opts);
  }

  private static separateCodeBlocks(text: string): Array<{ content: string; isCodeBlock: boolean }> {
    const segments: Array<{ content: string; isCodeBlock: boolean }> = [];
    const codeBlockRegex = /```[\s\S]*?```/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          content: text.slice(lastIndex, match.index),
          isCodeBlock: false,
        });
      }

      segments.push({
        content: match[0],
        isCodeBlock: true,
      });

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({
        content: text.slice(lastIndex),
        isCodeBlock: false,
      });
    }

    return segments;
  }

  static chunkSegment(
    text: string,
    options: ChunkOptions,
    startPosition: number,
    startIndex: number,
    isCodeBlock: boolean
  ): TextChunk[] {
    const chunks: TextChunk[] = [];
    let currentChunk = '';
    let currentPosition = 0;

    const blocks = isCodeBlock
      ? [text]
      : text
          .split(/(?<=\.|\?|\!|\n)\s+/)
          .filter(Boolean)
          .map(block => block.trim());

    for (const block of blocks) {
      if (
        currentChunk &&
        currentChunk.length + block.length > options.maxChunkSize &&
        currentChunk.length >= options.minChunkSize
      ) {
        chunks.push({
          content: currentChunk,
          index: startIndex + chunks.length,
          metadata: {
            startPosition: startPosition + currentPosition - currentChunk.length,
            endPosition: startPosition + currentPosition,
            isCodeBlock,
          },
        });

        const words = currentChunk.split(/\s+/);
        const overlapWordCount = options.overlapWords || Math.ceil(options.overlap / 10);
        const overlapWords = words.slice(-overlapWordCount);
        currentChunk = overlapWords.join(' ') + ' ' + block;
      } else {
        currentChunk = currentChunk
          ? currentChunk + ' ' + block
          : block;
      }

      currentPosition += block.length + 1;
    }

    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        index: startIndex + chunks.length,
        metadata: {
          startPosition: startPosition + currentPosition - currentChunk.length,
          endPosition: startPosition + currentPosition,
          isCodeBlock,
        },
      });
    }

    return chunks;
  }

  private static validateOptions(options: Partial<ChunkOptions>): ChunkOptions {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    if (opts.maxChunkSize < opts.minChunkSize) {
      throw new Error('maxChunkSize must be greater than minChunkSize');
    }

    if (opts.overlap >= opts.maxChunkSize) {
      throw new Error('overlap must be less than maxChunkSize');
    }

    if (opts.minChunkSize <= 0 || opts.maxChunkSize <= 0 || opts.overlap < 0) {
      throw new Error('chunk sizes and overlap must be positive numbers');
    }

    if (opts.fileType && !Object.values(FileType).includes(opts.fileType)) {
      throw new Error('Invalid file type specified');
    }

    return opts;
  }

  private static getChunkingStrategy(fileType: FileType): ChunkingStrategy {
    switch (fileType) {
      case FileType.PDF:
        return new PDFChunkingStrategy();
      case FileType.DOCX:
        return new DocxChunkingStrategy();
      default:
        return new DefaultChunkingStrategy();
    }
  }
}

class DefaultChunkingStrategy implements ChunkingStrategy {
  chunk(text: string, options: ChunkOptions): TextChunk[] {
    return TextChunker.chunkSegment(text, options, 0, 0, false);
  }
}

class PDFChunkingStrategy implements ChunkingStrategy {
  chunk(text: string, options: ChunkOptions): TextChunk[] {
    const chunks: TextChunk[] = [];
    const pages = text.split(/\f/);
    let currentIndex = 0;

    pages.forEach((page, pageNum) => {
      const pageChunks = TextChunker.chunkSegment(
        page,
        options,
        currentIndex,
        chunks.length,
        false
      );
      
      pageChunks.forEach(chunk => {
        chunk.metadata.structureMetadata = {
          ...chunk.metadata.structureMetadata,
          pageNumbers: [pageNum + 1]
        };
      });
      
      chunks.push(...pageChunks);
      currentIndex += page.length;
    });

    return chunks;
  }
}

class DocxChunkingStrategy implements ChunkingStrategy {
  chunk(text: string, options: ChunkOptions): TextChunk[] {
    const chunks: TextChunk[] = [];
    const paragraphs = text.split(/\n{2,}/);
    let currentIndex = 0;

    paragraphs.forEach((para, index) => {
      if (para.trim()) {
        const paraChunks = TextChunker.chunkSegment(
          para,
          options,
          currentIndex,
          chunks.length,
          false
        );

        paraChunks.forEach(chunk => {
          chunk.metadata.structureMetadata = {
            ...chunk.metadata.structureMetadata,
            paragraphBreaks: [index]
          };
        });

        chunks.push(...paraChunks);
        currentIndex += para.length + 2; // +2 for paragraph breaks
      }
    });

    return chunks;
  }
}
