import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { FileIndex } from '../lib/types';
import { createPool, fetchFileIndex, DEFAULT_INDEX_RELAYS } from '../lib/nostr';
import { FileCard } from './FileCard';
import './FileList.css';

interface FileListProps {
    pubkey: string;
    npub: string;
}

export function FileList({ pubkey, npub }: FileListProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [index, setIndex] = useState<FileIndex | null>(null);
    const [page, setPage] = useState(1);

    const loadIndex = useCallback(async (pageNum: number) => {
        setLoading(true);
        setError(null);

        const pool = createPool();

        try {
            const result = await fetchFileIndex(pool, DEFAULT_INDEX_RELAYS, pubkey, pageNum);

            if (!result) {
                if (pageNum === 1) {
                    setError('No files found for this public key');
                } else {
                    setError('Archive not found');
                }
                setIndex(null);
            } else {
                setIndex(result);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch file index');
            setIndex(null);
        } finally {
            setLoading(false);
            pool.close(DEFAULT_INDEX_RELAYS);
        }
    }, [pubkey]);

    useEffect(() => {
        loadIndex(page);
    }, [page, loadIndex]);

    const totalPages = index ? index.total_archives + 1 : 1;
    return (
        <div className="file-list-container">
            <header className="file-list-header">
                <Link className="back-button" to="/">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15,18 9,12 15,6" />
                    </svg>
                    Back
                </Link>

                <div className="header-info">
                    <h1>Files</h1>
                    <code className="pubkey-display" title={npub}>
                        {npub}
                    </code>
                </div>
            </header>

            <main className="file-list-content">
                {loading && (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Loading files from relays...</p>
                    </div>
                )}

                {error && !loading && (
                    <div className="error-state">
                        <span className="error-icon">⚠️</span>
                        <p>{error}</p>
                        <button onClick={() => loadIndex(page)} className="retry-button">
                            Retry
                        </button>
                    </div>
                )}

                {!loading && !error && index && (
                    <>
                        {index.entries.length === 0 ? (
                            <div className="empty-state">
                                <span className="empty-icon">📂</span>
                                <p>No files on this page</p>
                            </div>
                        ) : (
                            <div className="file-grid">
                                {index.entries.map((file) => (
                                    <FileCard
                                        key={file.file_hash}
                                        file={file}
                                        pubkey={pubkey}
                                        npub={npub}
                                    />
                                ))}
                            </div>
                        )}

                        {totalPages > 1 && (
                            <div className="pagination">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="page-button"
                                >
                                    ← Newer
                                </button>

                                <span className="page-info">
                                    Page {page} of {totalPages}
                                </span>

                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                    className="page-button"
                                >
                                    Older →
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
