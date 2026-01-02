/**
 * Nostr protocol utilities for fetching nostrsave data
 */

import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';
import { EVENT_KINDS, D_TAGS, type FileIndex, type Manifest, type ChunkInfo } from './types';

/**
 * Default relays for index data
 * These are commonly used nostr relays that support parameterized replaceable events
 */
export const DEFAULT_INDEX_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
];

/**
 * Create a SimplePool with recommended settings
 */
export function createPool(): SimplePool {
    return new SimplePool();
}

/**
 * Calculate d-tag for a specific page number
 * Page 1 = current index
 * Page N > 1 = archive (total_archives + 2 - page)
 */
export function getDTagForPage(page: number, totalArchives: number): string {
    if (page === 1) {
        return D_TAGS.CURRENT_INDEX;
    }
    const archiveNumber = totalArchives + 2 - page;
    return D_TAGS.archiveTag(archiveNumber);
}

/**
 * Fetch file index for a specific page
 * Page 1 is the current index, subsequent pages are archives
 */
export async function fetchFileIndex(
    pool: SimplePool,
    relays: string[],
    pubkey: string,
    page: number = 1
): Promise<FileIndex | null> {
    // For page 1, we need to first fetch to get total_archives
    // For other pages, we need to know total_archives to calculate the correct d-tag

    if (page === 1) {
        // Fetch current index
        const filter: Filter = {
            kinds: [EVENT_KINDS.INDEX],
            authors: [pubkey],
            '#d': [D_TAGS.CURRENT_INDEX],
            limit: 1,
        };

        const events = await pool.querySync(relays, filter);
        if (events.length === 0) return null;

        // Get most recent event
        const event = events.reduce((a, b) =>
            a.created_at > b.created_at ? a : b
        );

        try {
            return JSON.parse(event.content) as FileIndex;
        } catch {
            console.error('Failed to parse index content');
            return null;
        }
    } else {
        // For archive pages, we need to fetch page 1 first to get total_archives
        const currentIndex = await fetchFileIndex(pool, relays, pubkey, 1);
        if (!currentIndex) return null;

        const dTag = getDTagForPage(page, currentIndex.total_archives);

        const filter: Filter = {
            kinds: [EVENT_KINDS.INDEX],
            authors: [pubkey],
            '#d': [dTag],
            limit: 1,
        };

        const events = await pool.querySync(relays, filter);
        if (events.length === 0) return null;

        const event = events.reduce((a, b) =>
            a.created_at > b.created_at ? a : b
        );

        try {
            return JSON.parse(event.content) as FileIndex;
        } catch {
            console.error('Failed to parse archive content');
            return null;
        }
    }
}

/**
 * Fetch manifest for a specific file
 */
export async function fetchManifest(
    pool: SimplePool,
    relays: string[],
    pubkey: string,
    fileHash: string
): Promise<Manifest | null> {
    console.log('[fetchManifest] Querying for:', { fileHash, pubkey, relays });

    const filters: Filter[] = [
        {
            kinds: [EVENT_KINDS.MANIFEST],
            authors: [pubkey],
            '#x': [fileHash],
            limit: 1,
        },
        {
            kinds: [EVENT_KINDS.MANIFEST],
            authors: [pubkey],
            '#d': [fileHash],
            limit: 1,
        },
    ];

    let events: Awaited<ReturnType<typeof pool.querySync>> = [];
    for (const filter of filters) {
        console.log('[fetchManifest] Filter:', filter);
        events = await pool.querySync(relays, filter);
        console.log('[fetchManifest] Got events:', events.length);
        if (events.length > 0) break;
    }

    if (events.length === 0) return null;

    const event = events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b
    );

    try {
        const manifest = JSON.parse(event.content) as Manifest;
        console.log('[fetchManifest] Parsed manifest:', {
            file_name: manifest.file_name,
            total_chunks: manifest.total_chunks,
            relays: manifest.relays,
            encryption: manifest.encryption,
        });
        return manifest;
    } catch {
        console.error('Failed to parse manifest content');
        return null;
    }
}

/**
 * Chunk event with content
 */
export interface ChunkEvent {
    index: number;
    content: string;
    encryption: string;
}

const CHUNK_ID_BATCH_SIZE = 200;

function parseChunkIndexFromTags(tags: string[][]): number | null {
    const chunkTag = tags.find(t => t[0] === 'chunk');
    if (chunkTag && chunkTag[1]) {
        const index = parseInt(chunkTag[1], 10);
        if (!Number.isNaN(index)) return index;
    }

    const dTag = tags.find(t => t[0] === 'd')?.[1];
    if (!dTag) return null;

    const parts = dTag.split(':');
    const indexStr = parts[parts.length - 1];
    const index = parseInt(indexStr, 10);
    return Number.isNaN(index) ? null : index;
}

/**
 * Fetch all chunks for a file
 * Returns chunks in order by index
 */
export async function fetchChunks(
    pool: SimplePool,
    relays: string[],
    pubkey: string,
    fileHash: string,
    totalChunks: number,
    onProgress?: (fetched: number, total: number) => void,
    chunkInfos?: ChunkInfo[]
): Promise<ChunkEvent[]> {
    const chunksByIndex = new Map<number, ChunkEvent>();
    const seenEventIds = new Set<string>();

    console.log('[fetchChunks] Querying for:', { fileHash, pubkey, relays, totalChunks });

    const indexByEventId = new Map<string, number>();
    if (chunkInfos && chunkInfos.length > 0) {
        for (const info of chunkInfos) {
            if (info?.event_id) indexByEventId.set(info.event_id, info.index);
        }
    }

    if (indexByEventId.size > 0) {
        console.log('[fetchChunks] Using manifest event ids:', indexByEventId.size);
        const ids = Array.from(indexByEventId.keys());

        for (let i = 0; i < ids.length; i += CHUNK_ID_BATCH_SIZE) {
            const batch = ids.slice(i, i + CHUNK_ID_BATCH_SIZE);
            const filter: Filter = {
                kinds: [EVENT_KINDS.CHUNK],
                authors: [pubkey],
                ids: batch,
            };
            console.log('[fetchChunks] Filter (ids batch):', filter);

            const events = await pool.querySync(relays, filter);
            console.log('[fetchChunks] Got events (ids batch):', events.length);

            for (const event of events) {
                if (seenEventIds.has(event.id)) continue;
                seenEventIds.add(event.id);

                const parsedIndex = parseChunkIndexFromTags(event.tags);
                const index = parsedIndex ?? indexByEventId.get(event.id);
                if (index == null) continue;

                // Get encryption type from tags
                const encryptionTag = event.tags.find(t => t[0] === 'encryption');
                const encryption = encryptionTag?.[1] || 'none';

                if (!chunksByIndex.has(index)) {
                    chunksByIndex.set(index, {
                        index,
                        content: event.content,
                        encryption,
                    });
                    onProgress?.(chunksByIndex.size, totalChunks);
                }
            }
        }
    }

    if (chunksByIndex.size < totalChunks) {
        // Fetch remaining chunks for this file using the x tag
        const filter: Filter = {
            kinds: [EVENT_KINDS.CHUNK],
            authors: [pubkey],
            '#x': [fileHash],
        };
        console.log('[fetchChunks] Filter (fallback #x):', filter);

        const events = await pool.querySync(relays, filter);
        console.log('[fetchChunks] Got events (fallback #x):', events.length);

        if (events.length > 0) {
            console.log('[fetchChunks] First event tags (fallback #x):', events[0].tags);
        }

        for (const event of events) {
            if (seenEventIds.has(event.id)) continue;
            seenEventIds.add(event.id);

            const index = parseChunkIndexFromTags(event.tags);
            if (index == null) continue;

            // Get encryption type from tags
            const encryptionTag = event.tags.find(t => t[0] === 'encryption');
            const encryption = encryptionTag?.[1] || 'none';

            if (!chunksByIndex.has(index)) {
                chunksByIndex.set(index, {
                    index,
                    content: event.content,
                    encryption,
                });
                onProgress?.(chunksByIndex.size, totalChunks);
            }
        }
    }

    // Sort by index
    const chunks = Array.from(chunksByIndex.values()).sort((a, b) => a.index - b.index);

    console.log('[fetchChunks] Returning chunks:', chunks.length);
    return chunks;
}

/**
 * Close pool and clean up connections
 */
export function closePool(pool: SimplePool): void {
    pool.close(DEFAULT_INDEX_RELAYS);
}
