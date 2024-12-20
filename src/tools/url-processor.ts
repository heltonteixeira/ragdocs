import { URL } from 'url';

export class URLProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'URLProcessingError';
  }
}

export interface ProcessedURL {
  originalUrl: string;
  normalizedUrl: string;
  domain: string;
  path: string;
  isValid: boolean;
}

export class URLProcessor {
  /**
   * Validates and normalizes a URL, extracting key components
   * @param urlString The URL string to process
   * @returns ProcessedURL object containing normalized URL and metadata
   * @throws URLProcessingError if URL is invalid
   */
  static processURL(urlString: string): ProcessedURL {
    try {
      // Trim whitespace and normalize
      const trimmedUrl = urlString.trim();
      
      // Add protocol if missing
      const urlWithProtocol = trimmedUrl.startsWith('http')
        ? trimmedUrl
        : `https://${trimmedUrl}`;

      // Parse URL
      const url = new URL(urlWithProtocol);

      // Normalize URL
      // - Convert to lowercase
      // - Remove trailing slashes
      // - Remove default ports
      // - Sort query parameters
      const normalizedUrl = this.normalizeURL(url);

      return {
        originalUrl: urlString,
        normalizedUrl,
        domain: url.hostname.toLowerCase(),
        path: url.pathname,
        isValid: true,
      };
    } catch (error) {
      throw new URLProcessingError(
        `Invalid URL "${urlString}": ${(error as Error).message}`
      );
    }
  }

  /**
   * Normalizes a URL to ensure consistent format
   * @param url URL object to normalize
   * @returns Normalized URL string
   */
  private static normalizeURL(url: URL): string {
    // Convert hostname to lowercase
    const hostname = url.hostname.toLowerCase();

    // Remove default ports
    const port = url.port === '80' || url.port === '443' ? '' : url.port;

    // Sort query parameters
    const searchParams = new URLSearchParams([...url.searchParams].sort());
    const search = searchParams.toString();

    // Construct normalized path (remove trailing slash except for root)
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    // Construct normalized URL
    let normalizedUrl = `${url.protocol}//${hostname}`;
    if (port) normalizedUrl += `:${port}`;
    normalizedUrl += path;
    if (search) normalizedUrl += `?${search}`;
    if (url.hash) normalizedUrl += url.hash;

    return normalizedUrl;
  }

  /**
   * Checks if a URL points to a valid web page
   * @param urlString URL to validate
   * @returns true if URL is valid and accessible
   */
  static isValidWebPage(urlString: string): boolean {
    try {
      const { protocol } = new URL(urlString);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Extracts the root domain from a URL
   * @param urlString URL to process
   * @returns Root domain string
   */
  static extractRootDomain(urlString: string): string {
    try {
      const { hostname } = new URL(urlString);
      const parts = hostname.split('.');
      if (parts.length <= 2) return hostname;
      
      // Handle special cases like co.uk, com.au
      const sld = parts[parts.length - 2];
      const tld = parts[parts.length - 1];
      if (sld.length <= 3 && tld.length <= 3 && parts.length > 2) {
        return parts.slice(-3).join('.');
      }
      
      return parts.slice(-2).join('.');
    } catch {
      throw new URLProcessingError(`Cannot extract domain from invalid URL: ${urlString}`);
    }
  }
}
