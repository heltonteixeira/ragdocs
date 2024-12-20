export interface ChunkOptions {
  maxChunkSize: number;
  minChunkSize: number;
  overlap: number;
  respectCodeBlocks?: boolean;
}

export interface TextChunk {
  content: string;
  index: number;
  metadata: {
    startPosition: number;
    endPosition: number;
    isCodeBlock?: boolean;
  };
}

export class TextChunker {
  private static readonly DEFAULT_OPTIONS: ChunkOptions = {
    maxChunkSize: 1000,
    minChunkSize: 100,
    overlap: 200,
    respectCodeBlocks: true,
  };

  /**
   * Splits text into chunks while preserving context and natural boundaries
   * @param text Text to split into chunks
   * @param options Chunking options
   * @returns Array of text chunks with metadata
   */
  static chunkText(text: string, options?: Partial<ChunkOptions>): TextChunk[] {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const chunks: TextChunk[] = [];
    
    // First, separate code blocks from regular text
    const segments = this.separateCodeBlocks(text);
    let currentPosition = 0;
    let chunkIndex = 0;

    for (const segment of segments) {
      if (segment.isCodeBlock && opts.respectCodeBlocks) {
        // Keep code blocks as single chunks if they're not too large
        if (segment.content.length <= opts.maxChunkSize * 1.5) {
          chunks.push({
            content: segment.content,
            index: chunkIndex++,
            metadata: {
              startPosition: currentPosition,
              endPosition: currentPosition + segment.content.length,
              isCodeBlock: true,
            },
          });
          currentPosition += segment.content.length;
          continue;
        }
      }

      // Process regular text or large code blocks
      const segmentChunks = this.chunkSegment(
        segment.content,
        opts,
        currentPosition,
        chunkIndex,
        segment.isCodeBlock
      );

      chunks.push(...segmentChunks);
      chunkIndex += segmentChunks.length;
      currentPosition += segment.content.length;
    }

    return chunks;
  }

  /**
   * Separates code blocks from regular text
   * @param text Input text
   * @returns Array of text segments with code block flags
   */
  private static separateCodeBlocks(text: string): Array<{ content: string; isCodeBlock: boolean }> {
    const segments: Array<{ content: string; isCodeBlock: boolean }> = [];
    const codeBlockRegex = /```[\s\S]*?```/g;
    
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    
    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        segments.push({
          content: text.slice(lastIndex, match.index),
          isCodeBlock: false,
        });
      }
      
      // Add code block
      segments.push({
        content: match[0],
        isCodeBlock: true,
      });
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      segments.push({
        content: text.slice(lastIndex),
        isCodeBlock: false,
      });
    }
    
    return segments;
  }

  /**
   * Chunks a single segment of text
   * @param text Text segment to chunk
   * @param options Chunking options
   * @param startPosition Starting position in original text
   * @param startIndex Starting chunk index
   * @param isCodeBlock Whether this is a code block
   * @returns Array of chunks
   */
  private static chunkSegment(
    text: string,
    options: ChunkOptions,
    startPosition: number,
    startIndex: number,
    isCodeBlock: boolean
  ): TextChunk[] {
    const chunks: TextChunk[] = [];
    let currentChunk = '';
    let currentPosition = 0;

    // Split into sentences/paragraphs first
    const blocks = isCodeBlock
      ? [text] // Keep code blocks together
      : text
          .split(/(?<=\.|\?|\!|\n)\s+/)
          .filter(Boolean)
          .map(block => block.trim());

    for (const block of blocks) {
      // If adding this block would exceed max size, start new chunk
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
        
        // Start new chunk with overlap
        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(-Math.ceil(options.overlap / 10)); // Approximate words for overlap
        currentChunk = overlapWords.join(' ') + ' ' + block;
      } else {
        currentChunk = currentChunk
          ? currentChunk + ' ' + block
          : block;
      }
      
      currentPosition += block.length + 1; // +1 for the space
    }

    // Add final chunk if not empty
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

  /**
   * Validates chunk options and sets defaults
   * @param options User-provided options
   * @returns Validated options
   */
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
    
    return opts;
  }
}
