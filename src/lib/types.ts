// TypeScript interfaces for nostrsave data structures

/**
 * Single file entry in the index
 */
export interface FileEntry {
  file_hash: string;
  file_name: string;
  file_size: number;
  uploaded_at: number;
  encryption: 'nip44' | 'none';
}

/**
 * File index event content (Kind 30080)
 */
export interface FileIndex {
  version: number;
  entries: FileEntry[];
  archive_number: number;
  total_archives: number;
}

/**
 * Chunk info within a manifest
 */
export interface ChunkInfo {
  index: number;
  event_id: string;
  hash: string;
}

/**
 * Manifest event content (Kind 30079)
 */
export interface Manifest {
  version: number;
  file_name: string;
  file_hash: string;
  file_size: number;
  chunk_size: number;
  total_chunks: number;
  created_at: number;
  pubkey: string;
  encryption: 'nip44' | 'none';
  chunks: ChunkInfo[];
  relays: string[];
  mime_type?: string;
}

/**
 * Nostr event kinds used by nostrsave
 */
export const EVENT_KINDS = {
  CHUNK: 30078,
  MANIFEST: 30079,
  INDEX: 30080,
} as const;

/**
 * D-tag identifiers
 */
export const D_TAGS = {
  CURRENT_INDEX: 'nostrsave-index',
  archiveTag: (n: number) => `nostrsave-index-archive-${n}`,
} as const;
