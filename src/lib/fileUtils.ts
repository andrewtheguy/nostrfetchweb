import { fetchManifest, fetchChunks, DEFAULT_INDEX_RELAYS, createPool } from './nostr';
import { base64ToUint8Array } from './crypto';

export interface FileFetchResult {
    data: Uint8Array;
    mimeType: string;
    fileName: string;
}

// Basic MIME type mapping
function getMimeTypeFromName(fileName: string): string | null {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    const map: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mp3': 'audio/mpeg',
        'aac': 'audio/aac',
        'm4a': 'audio/mp4',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'json': 'application/json',
        'js': 'text/javascript',
        'ts': 'text/typescript',
        'css': 'text/css',
        'html': 'text/html'
    };

    return map[ext] || null;
}

export async function fetchFileBytes(
    pubkey: string,
    fileHash: string,
    onProgress?: (progress: number) => void,
    abortSignal?: AbortSignal
): Promise<FileFetchResult> {
    if (abortSignal?.aborted) throw new Error('Aborted');
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

        // Fetch chunks (now cached by chunk in nostr.ts)
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
            mimeType: manifest.mime_type || getMimeTypeFromName(manifest.file_name) || 'application/octet-stream',
            fileName: manifest.file_name
        };
    } finally {
        pool.close(DEFAULT_INDEX_RELAYS);
    }
}
