import { useState, useCallback, useRef } from 'react';
import type { FileEntry, Manifest } from '../lib/types';
import { createPool, fetchManifest, fetchChunks, DEFAULT_INDEX_RELAYS } from '../lib/nostr';
import { nsecToSecretKey, clearSecretKey, isValidNsec } from '../lib/keys';
import { decryptChunkBinary, base64ToUint8Array } from '../lib/crypto';
import './DownloadModal.css';

interface DownloadModalProps {
    file: FileEntry;
    pubkey: string;
    onClose: () => void;
}

type DownloadState =
    | { status: 'init' }
    | { status: 'fetching'; message: string; progress?: number }
    | { status: 'decrypting'; progress: number }
    | { status: 'complete' }
    | { status: 'error'; message: string };

export function DownloadModal({ file, pubkey, onClose }: DownloadModalProps) {
    const [state, setState] = useState<DownloadState>({ status: 'init' });
    const [nsecInput, setNsecInput] = useState('');
    const [nsecError, setNsecError] = useState<string | null>(null);
    const abortRef = useRef(false);

    const triggerDownload = useCallback((data: Uint8Array, filename: string) => {
        // Create ArrayBuffer slice for strict TypeScript compatibility
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const blob = new Blob([buffer]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, []);

    const downloadUnencrypted = useCallback(async () => {
        if (abortRef.current) return;

        setState({ status: 'fetching', message: 'Fetching manifest...' });
        const pool = createPool();

        try {
            // Fetch manifest
            const manifest = await fetchManifest(pool, DEFAULT_INDEX_RELAYS, pubkey, file.file_hash);
            if (!manifest) {
                setState({ status: 'error', message: 'Manifest not found' });
                return;
            }

            if (abortRef.current) return;

            // Use relays from manifest if available
            const dataRelays = manifest.relays?.length > 0 ? manifest.relays : DEFAULT_INDEX_RELAYS;

            // Fetch chunks
            setState({ status: 'fetching', message: 'Fetching file chunks...', progress: 0 });
            const chunks = await fetchChunks(
                pool,
                dataRelays,
                pubkey,
                file.file_hash,
                manifest.total_chunks,
                (fetched, total) => {
                    if (!abortRef.current) {
                        setState({ status: 'fetching', message: `Fetching chunks (${fetched}/${total})...`, progress: fetched / total });
                    }
                },
                manifest.chunks
            );

            if (abortRef.current) return;

            // Verify we got all chunks
            if (chunks.length !== manifest.total_chunks) {
                setState({ status: 'error', message: `Missing chunks: got ${chunks.length}/${manifest.total_chunks}` });
                return;
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

            // Trigger download
            triggerDownload(fileData, file.file_name);
            setState({ status: 'complete' });
        } catch (err) {
            if (!abortRef.current) {
                setState({ status: 'error', message: err instanceof Error ? err.message : 'Download failed' });
            }
        } finally {
            pool.close(DEFAULT_INDEX_RELAYS);
        }
    }, [file, pubkey, triggerDownload]);

    const downloadEncrypted = useCallback(async (secretKey: Uint8Array) => {
        if (abortRef.current) return;

        setState({ status: 'fetching', message: 'Fetching manifest...' });
        const pool = createPool();
        let manifest: Manifest | null = null;

        try {
            // Fetch manifest
            manifest = await fetchManifest(pool, DEFAULT_INDEX_RELAYS, pubkey, file.file_hash);
            if (!manifest) {
                setState({ status: 'error', message: 'Manifest not found' });
                return;
            }

            if (abortRef.current) return;

            // Use relays from manifest if available
            const dataRelays = manifest.relays?.length > 0 ? manifest.relays : DEFAULT_INDEX_RELAYS;

            // Fetch chunks
            setState({ status: 'fetching', message: 'Fetching encrypted chunks...', progress: 0 });
            const chunks = await fetchChunks(
                pool,
                dataRelays,
                pubkey,
                file.file_hash,
                manifest.total_chunks,
                (fetched, total) => {
                    if (!abortRef.current) {
                        setState({ status: 'fetching', message: `Fetching chunks (${fetched}/${total})...`, progress: fetched / total });
                    }
                },
                manifest.chunks
            );

            if (abortRef.current) return;

            // Verify we got all chunks
            if (chunks.length !== manifest.total_chunks) {
                setState({ status: 'error', message: `Missing chunks: got ${chunks.length}/${manifest.total_chunks}` });
                return;
            }

            // Decrypt chunks
            setState({ status: 'decrypting', progress: 0 });
            const decryptedParts: Uint8Array[] = [];

            for (let i = 0; i < chunks.length; i++) {
                if (abortRef.current) return;

                const chunk = chunks[i];
                try {
                    const decrypted = decryptChunkBinary(chunk.content, secretKey, pubkey);
                    decryptedParts.push(decrypted);
                } catch (err) {
                    setState({ status: 'error', message: `Failed to decrypt chunk ${i}: ${err instanceof Error ? err.message : 'unknown error'}` });
                    return;
                }

                setState({ status: 'decrypting', progress: (i + 1) / chunks.length });
            }

            // Reassemble file
            const totalLength = decryptedParts.reduce((acc, p) => acc + p.length, 0);
            const fileData = new Uint8Array(totalLength);
            let offset = 0;
            for (const part of decryptedParts) {
                fileData.set(part, offset);
                offset += part.length;
            }

            // Trigger download
            triggerDownload(fileData, file.file_name);
            setState({ status: 'complete' });
        } catch (err) {
            if (!abortRef.current) {
                setState({ status: 'error', message: err instanceof Error ? err.message : 'Download failed' });
            }
        } finally {
            pool.close(DEFAULT_INDEX_RELAYS);
            // CRITICALLY IMPORTANT: Clear the secret key
            clearSecretKey(secretKey);
        }
    }, [file, pubkey, triggerDownload]);

    const startEncryptedDownload = useCallback(() => {
        const trimmed = nsecInput.trim();
        // Clear UI copy immediately to minimize in-memory lifetime.
        setNsecInput('');
        setNsecError(null);

        if (!isValidNsec(trimmed)) {
            setNsecError('Invalid nsec format');
            return;
        }

        let secretKey: Uint8Array;
        try {
            secretKey = nsecToSecretKey(trimmed);
        } catch {
            setNsecError('Failed to decode nsec');
            return;
        }

        // Start download with the secret key
        downloadEncrypted(secretKey);
    }, [nsecInput, downloadEncrypted]);

    const handleStart = useCallback(() => {
        abortRef.current = false;

        if (file.encryption === 'nip44') {
            startEncryptedDownload();
        } else {
            downloadUnencrypted();
        }
    }, [file.encryption, downloadUnencrypted, startEncryptedDownload]);

    const handleSubmitKey = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        startEncryptedDownload();
    }, [startEncryptedDownload]);

    const handleCancel = useCallback(() => {
        abortRef.current = true;
        setNsecInput('');
        setNsecError(null);
        onClose();
    }, [onClose]);

    const handleRetry = useCallback(() => {
        abortRef.current = false;
        setNsecInput('');
        setNsecError(null);
        setState({ status: 'init' });
    }, []);

    const isEncrypted = file.encryption === 'nip44';

    return (
        <div className="modal-overlay" onClick={handleCancel}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="modal-close" onClick={handleCancel}>×</button>

                <div className="modal-header">
                    <h2>Download File</h2>
                    <p className="modal-filename">{file.file_name}</p>
                </div>

                {state.status === 'init' && (
                    <div className="modal-body">
                        <div className="file-details">
                            <div className="detail-row">
                                <span>Encryption:</span>
                                <span className={`encryption-tag ${isEncrypted ? 'encrypted' : ''}`}>
                                    {isEncrypted ? '🔒 NIP-44 Encrypted' : 'Unencrypted'}
                                </span>
                            </div>
                        </div>

                        {isEncrypted && (
                            <>
                                <div className="encrypted-notice">
                                    <span className="notice-icon">⚠️</span>
                                    <p>This file is encrypted. Enter your private key (nsec) to decrypt it.</p>
                                </div>

                                <form onSubmit={handleSubmitKey} className="key-form">
                                    <div className="input-group">
                                        <label>Enter your private key (nsec)</label>
                                        <input
                                            type="password"
                                            value={nsecInput}
                                            onChange={e => setNsecInput(e.target.value)}
                                            placeholder="nsec1..."
                                            autoComplete="off"
                                            className={nsecError ? 'error' : ''}
                                        />
                                        {nsecError && <span className="error-text">{nsecError}</span>}
                                    </div>

                                    <div className="security-note">
                                        <span>🔐</span>
                                        <span>Your key will be used only for decryption and immediately erased from memory.</span>
                                    </div>

                                    <div className="button-row">
                                        <button type="button" className="secondary-button" onClick={handleCancel}>
                                            Cancel
                                        </button>
                                        <button type="submit" className="primary-button">
                                            Decrypt & Download
                                        </button>
                                    </div>
                                </form>
                            </>
                        )}

                        {!isEncrypted && (
                            <button className="primary-button" onClick={handleStart}>
                                Start Download
                            </button>
                        )}
                    </div>
                )}

                {state.status === 'fetching' && (
                    <div className="modal-body progress-view">
                        <div className="spinner"></div>
                        <p>{state.message}</p>
                        {state.progress !== undefined && (
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${state.progress * 100}%` }}></div>
                            </div>
                        )}
                    </div>
                )}

                {state.status === 'decrypting' && (
                    <div className="modal-body progress-view">
                        <div className="spinner"></div>
                        <p>Decrypting file...</p>
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${state.progress * 100}%` }}></div>
                        </div>
                    </div>
                )}

                {state.status === 'complete' && (
                    <div className="modal-body success-view">
                        <span className="success-icon">✅</span>
                        <p>Download complete!</p>
                        <button className="primary-button" onClick={onClose}>Done</button>
                    </div>
                )}

                {state.status === 'error' && (
                    <div className="modal-body error-view">
                        <span className="error-icon">❌</span>
                        <p>{state.message}</p>
                        <div className="button-row">
                            <button className="secondary-button" onClick={onClose}>Close</button>
                            <button className="primary-button" onClick={handleRetry}>Retry</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
