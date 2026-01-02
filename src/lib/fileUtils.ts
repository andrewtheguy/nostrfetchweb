import { fetchManifest, fetchChunks, DEFAULT_INDEX_RELAYS, createPool } from './nostr';
import { base64ToUint8Array } from './crypto';

export interface FileFetchResult {
    data: Uint8Array;
    mimeType: string;
    fileName: string;
}

/**
 * Fetch file content (unencrypted) from Nostr
 */
export async function fetchFileBytes(
    pubkey: string,
    fileHash: string,
    onProgress?: (progress: number) => void,
    abortSignal?: AbortSignal
): Promise<FileFetchResult> {
    const pool = createPool();

    try {
        // Fetch manifest
        const manifest = await fetchManifest(pool, DEFAULT_INDEX_RELAYS, pubkey, fileHash);
        if (!manifest) {
            throw new Error('Manifest not found');
        }

        if (abortSignal?.aborted) throw new Error('Aborted');

        // Use relays from manifest if available
        const dataRelays = manifest.relays?.length > 0 ? manifest.relays : DEFAULT_INDEX_RELAYS;

        // Fetch chunks
        const chunks = await fetchChunks(
            pool,
            dataRelays,
            pubkey,
            fileHash,
            manifest.total_chunks,
            (fetched, total) => {
                if (onProgress && !abortSignal?.aborted) {
                    onProgress(fetched / total);
                }
            },
            manifest.chunks
        );

        if (abortSignal?.aborted) throw new Error('Aborted');

        // Verify we got all chunks
        if (chunks.length !== manifest.total_chunks) {
            throw new Error(`Missing chunks: got ${chunks.length}/${manifest.total_chunks}`);
        }

        // Reassemble file - chunks are base64 encoded
        const parts: Uint8Array[] = chunks.map(chunk => base64ToUint8Array(chunk.content));
        const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
        const fileData = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
            fileData.set(part, offset);
            offset += part.length;
        }

        return {
            data: fileData,
            mimeType: manifest.mime_type || 'application/octet-stream',
            fileName: manifest.file_name
        };
    } finally {
        pool.close(DEFAULT_INDEX_RELAYS);
    }
}
