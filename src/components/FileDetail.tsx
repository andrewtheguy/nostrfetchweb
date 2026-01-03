import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Manifest } from '../lib/types';
import { createPool, fetchChunks, fetchManifest, DEFAULT_INDEX_RELAYS } from '../lib/nostr';
import { fetchFileBytes } from '../lib/fileUtils';
import { decryptChunkBinary } from '../lib/crypto';
import { clearSecretKey, isValidNsec, nsecToSecretKey } from '../lib/keys';
import './FileDetail.css';

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

type DownloadState =
    | { status: 'idle' }
    | { status: 'fetching'; message: string; progress?: number }
    | { status: 'decrypting'; progress: number }
    | { status: 'complete' }
    | { status: 'error'; message: string };

interface FileDetailProps {
    pubkey: string;
    npub: string;
    fileHash: string;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatMegabytes(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
}

function getMimeTypeFromName(fileName: string): string | null {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    const map: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        pdf: 'application/pdf',
        txt: 'text/plain',
        md: 'text/markdown',
        json: 'application/json',
        js: 'text/javascript',
        ts: 'text/typescript',
        css: 'text/css',
        html: 'text/html',
    };

    return map[ext] || null;
}

function isPreviewableMime(mimeType: string): boolean {
    if (!mimeType) return false;
    if (mimeType.startsWith('image/')) return true;
    if (mimeType.startsWith('text/')) return true;
    if (mimeType.startsWith('video/')) return true;
    if (mimeType.startsWith('audio/')) return true;
    if (mimeType === 'application/pdf') return true;
    if (mimeType === 'application/json') return true;
    if (mimeType.includes('javascript')) return true;
    return false;
}

export function FileDetail({ pubkey, npub, fileHash }: FileDetailProps) {
    const [manifest, setManifest] = useState<Manifest | null>(null);
    const [manifestError, setManifestError] = useState<string | null>(null);
    const [manifestLoading, setManifestLoading] = useState(true);

    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewProgress, setPreviewProgress] = useState(0);
    const [contentUrl, setContentUrl] = useState<string | null>(null);
    const contentUrlRef = useRef<string | null>(null);
    const [contentType, setContentType] = useState('');

    const [downloadState, setDownloadState] = useState<DownloadState>({ status: 'idle' });
    const [nsecInput, setNsecInput] = useState('');
    const [nsecError, setNsecError] = useState<string | null>(null);
    const downloadAbortRef = useRef(false);

    const isEncrypted = manifest?.encryption === 'nip44';
    const mimeTypeGuess = useMemo(() => {
        if (!manifest) return '';
        return manifest.mime_type || getMimeTypeFromName(manifest.file_name) || '';
    }, [manifest]);
    const isPreviewable = useMemo(() => {
        if (!manifest) return false;
        if (manifest.encryption === 'nip44') return false;
        if (manifest.file_size > MAX_PREVIEW_BYTES) return false;
        return isPreviewableMime(mimeTypeGuess);
    }, [manifest, mimeTypeGuess]);

    useEffect(() => {
        let isMounted = true;
        setManifestLoading(true);
        setManifestError(null);

        const pool = createPool();

        fetchManifest(pool, DEFAULT_INDEX_RELAYS, pubkey, fileHash)
            .then((result) => {
                if (!isMounted) return;
                if (!result) {
                    setManifestError('Manifest not found for this file.');
                    setManifest(null);
                } else {
                    setManifest(result);
                }
            })
            .catch((err) => {
                if (!isMounted) return;
                setManifestError(err instanceof Error ? err.message : 'Failed to load file info.');
                setManifest(null);
            })
            .finally(() => {
                if (isMounted) setManifestLoading(false);
                pool.close(DEFAULT_INDEX_RELAYS);
            });

        return () => {
            isMounted = false;
        };
    }, [pubkey, fileHash]);

    useEffect(() => {
        return () => {
            downloadAbortRef.current = true;
        };
    }, []);

    useEffect(() => {
        if (!manifest || !isPreviewable) {
            setPreviewLoading(false);
            setPreviewError(null);
            setPreviewProgress(0);
            if (contentUrlRef.current) {
                URL.revokeObjectURL(contentUrlRef.current);
                contentUrlRef.current = null;
            }
            setContentUrl(null);
            return;
        }

        const controller = new AbortController();
        let isMounted = true;
        let localUrl: string | null = null;
        setPreviewLoading(true);
        setPreviewError(null);
        setPreviewProgress(0);

        fetchFileBytes(pubkey, fileHash, (progress) => {
            if (isMounted) setPreviewProgress(progress);
        }, controller.signal)
            .then((result) => {
                if (!isMounted) return;
                const blob = new Blob([result.data as unknown as BlobPart], { type: result.mimeType });
                const url = URL.createObjectURL(blob);
                localUrl = url;
                if (contentUrlRef.current) {
                    URL.revokeObjectURL(contentUrlRef.current);
                }
                contentUrlRef.current = url;
                setContentUrl(url);
                setContentType(result.mimeType);
                setPreviewLoading(false);
            })
            .catch((err: unknown) => {
                if (!isMounted) return;
                if (err instanceof Error && err.message === 'Aborted') return;
                setPreviewError(err instanceof Error ? err.message : 'Failed to load preview.');
                setPreviewLoading(false);
            });

        return () => {
            isMounted = false;
            controller.abort();
            if (localUrl) {
                URL.revokeObjectURL(localUrl);
                if (contentUrlRef.current === localUrl) {
                    contentUrlRef.current = null;
                }
            }
        };
    }, [pubkey, fileHash, manifest, isPreviewable]);

    const triggerDownload = useCallback((data: Uint8Array, filename: string, mimeType?: string) => {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
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
        if (!manifest) return;
        downloadAbortRef.current = false;
        setDownloadState({ status: 'fetching', message: 'Fetching file...', progress: 0 });

        try {
            const result = await fetchFileBytes(
                pubkey,
                fileHash,
                (progress) => {
                    if (!downloadAbortRef.current) {
                        setDownloadState({ status: 'fetching', message: 'Fetching file...', progress });
                    }
                }
            );

            if (downloadAbortRef.current) return;
            triggerDownload(result.data, result.fileName, result.mimeType);
            setDownloadState({ status: 'complete' });
        } catch (err) {
            if (!downloadAbortRef.current) {
                setDownloadState({ status: 'error', message: err instanceof Error ? err.message : 'Download failed.' });
            }
        }
    }, [fileHash, manifest, pubkey, triggerDownload]);

    const downloadEncrypted = useCallback(async (secretKey: Uint8Array) => {
        if (!manifest) return;
        downloadAbortRef.current = false;
        setDownloadState({ status: 'fetching', message: 'Fetching manifest...' });
        const pool = createPool();

        try {
            const dataRelays = manifest.relays?.length ? manifest.relays : DEFAULT_INDEX_RELAYS;

            setDownloadState({ status: 'fetching', message: 'Fetching encrypted chunks...', progress: 0 });
            const chunks = await fetchChunks(
                pool,
                dataRelays,
                pubkey,
                fileHash,
                manifest.total_chunks,
                (fetched, total) => {
                    if (!downloadAbortRef.current) {
                        setDownloadState({
                            status: 'fetching',
                            message: `Fetching chunks (${fetched}/${total})...`,
                            progress: fetched / total
                        });
                    }
                },
                manifest.chunks
            );

            if (downloadAbortRef.current) return;

            if (chunks.length !== manifest.total_chunks) {
                setDownloadState({ status: 'error', message: `Missing chunks: got ${chunks.length}/${manifest.total_chunks}` });
                return;
            }

            setDownloadState({ status: 'decrypting', progress: 0 });
            const decryptedParts: Uint8Array[] = [];

            for (let i = 0; i < chunks.length; i++) {
                if (downloadAbortRef.current) return;
                const chunk = chunks[i];
                try {
                    const decrypted = decryptChunkBinary(chunk.content, secretKey, pubkey);
                    decryptedParts.push(decrypted);
                } catch (err) {
                    setDownloadState({ status: 'error', message: `Failed to decrypt chunk ${i}: ${err instanceof Error ? err.message : 'unknown error'}` });
                    return;
                }
                setDownloadState({ status: 'decrypting', progress: (i + 1) / chunks.length });
            }

            const totalLength = decryptedParts.reduce((acc, p) => acc + p.length, 0);
            const fileData = new Uint8Array(totalLength);
            let offset = 0;
            for (const part of decryptedParts) {
                fileData.set(part, offset);
                offset += part.length;
            }

            const mimeType = manifest.mime_type || getMimeTypeFromName(manifest.file_name) || 'application/octet-stream';
            triggerDownload(fileData, manifest.file_name, mimeType);
            setDownloadState({ status: 'complete' });
        } catch (err) {
            if (!downloadAbortRef.current) {
                setDownloadState({ status: 'error', message: err instanceof Error ? err.message : 'Download failed.' });
            }
        } finally {
            pool.close(DEFAULT_INDEX_RELAYS);
            clearSecretKey(secretKey);
        }
    }, [fileHash, manifest, pubkey, triggerDownload]);

    const startEncryptedDownload = useCallback(() => {
        const trimmed = nsecInput.trim();
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

        downloadEncrypted(secretKey);
    }, [downloadEncrypted, nsecInput]);

    const handleDownload = useCallback(() => {
        setDownloadState({ status: 'idle' });
        if (isEncrypted) {
            startEncryptedDownload();
        } else {
            downloadUnencrypted();
        }
    }, [downloadUnencrypted, isEncrypted, startEncryptedDownload]);

    const handleEncryptedSubmit = useCallback((event: React.FormEvent) => {
        event.preventDefault();
        startEncryptedDownload();
    }, [startEncryptedDownload]);

    const renderPreviewContent = () => {
        if (!contentUrl) return null;

        if (contentType.startsWith('image/')) {
            return (
                <div className="preview-media image-preview">
                    <img src={contentUrl} alt={manifest?.file_name || 'Preview'} />
                </div>
            );
        }

        if (contentType.startsWith('text/') || contentType === 'application/json' || contentType.includes('javascript')) {
            return (
                <iframe
                    src={contentUrl}
                    className="preview-media text-preview"
                    title={manifest?.file_name || 'Preview'}
                />
            );
        }

        if (contentType === 'application/pdf') {
            return (
                <iframe
                    src={contentUrl}
                    className="preview-media pdf-preview"
                    title={manifest?.file_name || 'Preview'}
                />
            );
        }

        if (contentType.startsWith('video/')) {
            return (
                <video controls className="preview-media video-preview">
                    <source src={contentUrl} type={contentType} />
                    Your browser does not support the video tag.
                </video>
            );
        }

        if (contentType.startsWith('audio/')) {
            return (
                <audio controls className="preview-media audio-preview">
                    <source src={contentUrl} type={contentType} />
                    Your browser does not support the audio element.
                </audio>
            );
        }

        return (
            <div className="preview-message">
                <span>Preview not available for this file type.</span>
            </div>
        );
    };

    return (
        <div className="file-detail-container">
            <header className="file-detail-header">
                <Link className="back-button" to={`/files/${npub}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15,18 9,12 15,6" />
                    </svg>
                    Back
                </Link>

                <div className="header-info">
                    <h1>File Details</h1>
                    <code className="pubkey-display" title={npub}>
                        {npub}
                    </code>
                </div>
            </header>

            <main className="file-detail-content">
                {manifestLoading && (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Loading file info...</p>
                    </div>
                )}

                {manifestError && !manifestLoading && (
                    <div className="error-state">
                        <span className="error-icon">⚠️</span>
                        <p>{manifestError}</p>
                    </div>
                )}

                {!manifestLoading && !manifestError && manifest && (
                    <>
                        <section className="detail-card">
                            <div className="detail-row">
                                <span>File name</span>
                                <strong>{manifest.file_name}</strong>
                            </div>
                            <div className="detail-row">
                                <span>File size</span>
                                <strong>{formatBytes(manifest.file_size)}</strong>
                            </div>
                            <div className="detail-row">
                                <span>Uploaded</span>
                                <strong>{formatDate(manifest.created_at)}</strong>
                            </div>
                            <div className="detail-row">
                                <span>Encryption</span>
                                <strong className={isEncrypted ? 'encrypted' : 'unencrypted'}>
                                    {isEncrypted ? '🔒 NIP-44 Encrypted' : 'Unencrypted'}
                                </strong>
                            </div>
                            <div className="detail-row">
                                <span>File hash</span>
                                <code>{manifest.file_hash}</code>
                            </div>
                        </section>

                        <section className="preview-card">
                            <div className="card-header">
                                <h2>Preview</h2>
                                {!isEncrypted && (
                                    <span className="preview-limit">Preview limit: {formatMegabytes(MAX_PREVIEW_BYTES)}</span>
                                )}
                            </div>

                            {isEncrypted && (
                                <div className="preview-message warning">
                                    <span>Encrypted files can’t be previewed. Use your nsec to download.</span>
                                </div>
                            )}

                            {!isEncrypted && !isPreviewable && (
                                <div className="preview-message">
                                    <span>
                                        {manifest.file_size > MAX_PREVIEW_BYTES
                                            ? `Preview disabled for files larger than ${formatMegabytes(MAX_PREVIEW_BYTES)}.`
                                            : `Preview not available for ${mimeTypeGuess || 'this file type'}.`}
                                    </span>
                                </div>
                            )}

                            {previewLoading && (
                                <div className="preview-loading">
                                    <div className="spinner"></div>
                                    <p>Loading preview... {Math.round(previewProgress * 100)}%</p>
                                    <div className="progress-bar">
                                        <div className="progress-fill" style={{ width: `${previewProgress * 100}%` }}></div>
                                    </div>
                                </div>
                            )}

                            {previewError && !previewLoading && (
                                <div className="preview-message error">
                                    <span>{previewError}</span>
                                </div>
                            )}

                            {!previewLoading && !previewError && isPreviewable && renderPreviewContent()}
                        </section>

                        <section className="download-card">
                            <div className="card-header">
                                <h2>Download</h2>
                            </div>

                            {downloadState.status === 'idle' && !isEncrypted && (
                                <button className="primary-button" onClick={handleDownload}>
                                    Download File
                                </button>
                            )}

                            {downloadState.status === 'idle' && isEncrypted && (
                                <form onSubmit={handleEncryptedSubmit} className="key-form">
                                    <div className="input-group">
                                        <label>Enter your private key (nsec)</label>
                                        <input
                                            type="password"
                                            value={nsecInput}
                                            onChange={(event) => setNsecInput(event.target.value)}
                                            placeholder="nsec1..."
                                            autoComplete="off"
                                            className={nsecError ? 'error' : ''}
                                        />
                                        {nsecError && <span className="error-text">{nsecError}</span>}
                                    </div>

                                    <div className="security-note">
                                        <span>🔐</span>
                                        <span>Your key is used only for decryption and immediately erased.</span>
                                    </div>

                                    <button type="submit" className="primary-button">
                                        Decrypt & Download
                                    </button>
                                </form>
                            )}

                            {downloadState.status === 'fetching' && (
                                <div className="progress-view">
                                    <div className="spinner"></div>
                                    <p>{downloadState.message}</p>
                                    {downloadState.progress !== undefined && (
                                        <div className="progress-bar">
                                            <div className="progress-fill" style={{ width: `${downloadState.progress * 100}%` }}></div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {downloadState.status === 'decrypting' && (
                                <div className="progress-view">
                                    <div className="spinner"></div>
                                    <p>Decrypting file...</p>
                                    <div className="progress-bar">
                                        <div className="progress-fill" style={{ width: `${downloadState.progress * 100}%` }}></div>
                                    </div>
                                </div>
                            )}

                            {downloadState.status === 'complete' && (
                                <div className="success-view">
                                    <span className="success-icon">✅</span>
                                    <p>Download complete!</p>
                                    <button className="secondary-button" onClick={() => setDownloadState({ status: 'idle' })}>
                                        Download again
                                    </button>
                                </div>
                            )}

                            {downloadState.status === 'error' && (
                                <div className="error-view">
                                    <span className="error-icon">❌</span>
                                    <p>{downloadState.message}</p>
                                    <button className="secondary-button" onClick={() => setDownloadState({ status: 'idle' })}>
                                        Try again
                                    </button>
                                </div>
                            )}
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
