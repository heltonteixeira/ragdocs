import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';

export class ContentFetchError extends Error {
  constructor(message: string, public readonly url: string) {
    super(message);
    this.name = 'ContentFetchError';
  }
}

export interface FetchedContent {
  url: string;
  title: string;
  content: string;
  timestamp: string;
  metadata: {
    domain: string;
    contentType: string;
    wordCount: number;
    hasCode: boolean;
  };
}

export class ContentFetcher {
  private static readonly TIMEOUT = 30000; // 30 seconds
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 1000; // 1 second

  /**
   * Fetches and processes content from a URL
   * @param url URL to fetch content from
   * @returns Processed content with metadata
   */
  static async fetchContent(url: string): Promise<FetchedContent> {
    let retries = 0;
    let lastError: Error | null = null;

    while (retries < this.MAX_RETRIES) {
      try {
        const response = await axios.get(url, {
          timeout: this.TIMEOUT,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RagDocsBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });

        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('html')) {
          throw new ContentFetchError('Unsupported content type: ' + contentType, url);
        }

        return this.processHtmlContent(url, response.data);
      } catch (error) {
        lastError = error as Error;
        if (error instanceof AxiosError && error.response?.status === 404) {
          throw new ContentFetchError('Page not found', url);
        }
        retries++;
        if (retries < this.MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
        }
      }
    }

    throw new ContentFetchError(
      `Failed to fetch content after ${this.MAX_RETRIES} attempts: ${lastError?.message}`,
      url
    );
  }

  /**
   * Processes HTML content to extract relevant text and metadata
   * @param url Original URL
   * @param html Raw HTML content
   * @returns Processed content with metadata
   */
  private static processHtmlContent(url: string, html: string): FetchedContent {
    const $ = cheerio.load(html);

    // Remove unwanted elements
    this.removeUnwantedElements($);

    // Extract title
    const title = $('title').text().trim() || 
                 $('h1').first().text().trim() || 
                 'Untitled Document';

    // Extract main content
    const mainContent = this.extractMainContent($);

    // Check for code blocks
    const hasCode = $('pre, code').length > 0 || 
                   mainContent.includes('```') ||
                   /\`[^\`]+\`/.test(mainContent);

    // Count words
    const wordCount = mainContent.split(/\s+/).filter(Boolean).length;

    return {
      url,
      title,
      content: mainContent,
      timestamp: new Date().toISOString(),
      metadata: {
        domain: new URL(url).hostname,
        contentType: 'text/html',
        wordCount,
        hasCode,
      },
    };
  }

  /**
   * Removes unwanted elements from the HTML
   * @param $ Cheerio instance
   */
  private static removeUnwantedElements($: cheerio.CheerioAPI): void {
    // Remove common non-content elements
    const selectorsToRemove = [
      'script',
      'style',
      'nav',
      'header',
      'footer',
      'iframe',
      '.advertisement',
      '.ads',
      '#comments',
      '.comments',
      '.social-share',
      '.related-posts',
      'aside',
    ];

    $(selectorsToRemove.join(', ')).remove();
  }

  /**
   * Extracts main content from the HTML
   * @param $ Cheerio instance
   * @returns Extracted and cleaned content
   */
  private static extractMainContent($: cheerio.CheerioAPI): string {
    // Try to find main content container
    const mainSelectors = [
      'article',
      'main',
      '.main-content',
      '#main-content',
      '.post-content',
      '.article-content',
      '.entry-content',
    ];

    let $content = $();
    for (const selector of mainSelectors) {
      $content = $(selector);
      if ($content.length > 0) break;
    }

    // Fallback to body if no main content container found
    if ($content.length === 0) {
      $content = $('body');
    }

    // Extract text content
    const text = $content
      .find('h1, h2, h3, h4, h5, h6, p, li, pre, code')
      .map((_, el) => {
        const $el = $(el);
        // Preserve code blocks
        if ($el.is('pre, code')) {
          return '\n```\n' + $el.text() + '\n```\n';
        }
        return $el.text();
      })
      .get()
      .join('\n')
      .trim();

    // Clean up the text
    return this.cleanText(text);
  }

  /**
   * Cleans extracted text content
   * @param text Raw text content
   * @returns Cleaned text
   */
  private static cleanText(text: string): string {
    return text
      .replace(/[\r\n]+/g, '\n') // Normalize line endings
      .replace(/\n\s+\n/g, '\n\n') // Remove excess whitespace between paragraphs
      .replace(/\s+/g, ' ') // Normalize whitespace within paragraphs
      .split('\n') // Split into lines
      .map(line => line.trim()) // Trim each line
      .filter(Boolean) // Remove empty lines
      .join('\n') // Rejoin with newlines
      .trim(); // Final trim
  }
}
