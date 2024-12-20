# RagDocs MCP Server

A Model Context Protocol (MCP) server that provides RAG (Retrieval-Augmented Generation) capabilities using Qdrant vector database and Ollama/OpenAI embeddings. This server enables semantic search and management of documentation through vector similarity.

## Features

- Add documentation with metadata
- Semantic search through documents
- List and organize documentation
- Delete documents
- Support for both Ollama (free) and OpenAI (paid) embeddings
- Automatic text chunking and embedding generation
- Vector storage with Qdrant

## Prerequisites

- Node.js 16 or higher
- One of the following Qdrant setups:
  - Local instance using Docker (free)
  - Qdrant Cloud account with API key (managed service)
- One of the following for embeddings:
  - Ollama running locally (default, free)
  - OpenAI API key (optional, paid)

## Available Tools

### 1. add_document
Add a document to the RAG system.

Parameters:
- `url` (required): Document URL/identifier
- `content` (required): Document content
- `metadata` (optional): Document metadata
  - `title`: Document title
  - `contentType`: Content type (e.g., "text/markdown")

### 2. search_documents
Search through stored documents using semantic similarity.

Parameters:
- `query` (required): Natural language search query
- `options` (optional):
  - `limit`: Maximum number of results (1-20, default: 5)
  - `scoreThreshold`: Minimum similarity score (0-1, default: 0.7)
  - `filters`:
    - `domain`: Filter by domain
    - `hasCode`: Filter for documents containing code
    - `after`: Filter for documents after date (ISO format)
    - `before`: Filter for documents before date (ISO format)

### 3. list_documents
List all stored documents with pagination and grouping options.

Parameters (all optional):
- `page`: Page number (default: 1)
- `pageSize`: Number of documents per page (1-100, default: 20)
- `groupByDomain`: Group documents by domain (default: false)
- `sortBy`: Sort field ("timestamp", "title", or "domain")
- `sortOrder`: Sort order ("asc" or "desc")

### 4. delete_document
Delete a document from the RAG system.

Parameters:
- `url` (required): URL of the document to delete

## Installation

```bash
npm install -g @mcpservers/ragdocs
```

## MCP Server Configuration

```json
{
  "mcpServers": {
    "ragdocs": {
      "command": "node",
      "args": ["@mcpservers/ragdocs"],
      "env": {
        "QDRANT_URL": "http://127.0.0.1:6333",
        "EMBEDDING_PROVIDER": "ollama"
      }
    }
  }
}
```

Using Qdrant Cloud:
```json
{
  "mcpServers": {
    "ragdocs": {
      "command": "node",
      "args": ["@mcpservers/ragdocs"],
      "env": {
        "QDRANT_URL": "https://your-cluster-url.qdrant.tech",
        "QDRANT_API_KEY": "your-qdrant-api-key",
        "EMBEDDING_PROVIDER": "ollama"
      }
    }
  }
}
```

Using OpenAI:
```json
{
  "mcpServers": {
    "ragdocs": {
      "command": "node",
      "args": ["@mcpservers/ragdocs"],
      "env": {
        "QDRANT_URL": "http://127.0.0.1:6333",
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Environment Variables

- `QDRANT_URL`: URL of your Qdrant instance
  - For local: "http://127.0.0.1:6333" (default)
  - For cloud: "https://your-cluster-url.qdrant.tech"
- `QDRANT_API_KEY`: API key for Qdrant Cloud (required when using cloud instance)
- `EMBEDDING_PROVIDER`: Choice of embedding provider ("ollama" or "openai", default: "ollama")
- `OPENAI_API_KEY`: OpenAI API key (required if using OpenAI)
- `EMBEDDING_MODEL`: Model to use for embeddings
  - For Ollama: defaults to "nomic-embed-text"
  - For OpenAI: defaults to "text-embedding-3-small"

## License

MIT
