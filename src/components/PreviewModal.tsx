import { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from '../lib/types';
import { fetchFileBytes } from '../lib/fileUtils';
import './DownloadModal.css'; // Reuse styles for now

interface PreviewModalProps {
    file: FileEntry;
    pubkey: string;
    onClose: () => void;
}

export function PreviewModal({ file, pubkey, onClose }: PreviewModalProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [contentUrl, setContentUrl] = useState<string | null>(null);
    const [mimeType, setMimeType] = useState<string>('');

    useEffect(() => {
        const controller = new AbortController();

        async function loadContent() {
            try {
                setLoading(true);
                setProgress(0);

                const result = await fetchFileBytes(
                    pubkey,
                    file.file_hash,
                    (p) => setProgress(p),
                    controller.signal
                );

                const blob = new Blob([result.data as unknown as BlobPart], { type: result.mimeType });
                const url = URL.createObjectURL(blob);
                setContentUrl(url);
                setMimeType(result.mimeType);
                setLoading(false);
            } catch (err: unknown) {
                if (err instanceof Error && err.message === 'Aborted') return;
                setError(err instanceof Error ? err.message : 'Failed to load preview');
                setLoading(false);
            }
        }

        loadContent();

        return () => {
            controller.abort();
            if (contentUrl) {
                URL.revokeObjectURL(contentUrl);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file.file_hash, pubkey]);

    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    const renderPreview = () => {
        if (!contentUrl) return null;

        if (mimeType.startsWith('image/')) {
            return (
                <div className="preview-content image-preview">
                    <img src={contentUrl} alt={file.file_name} />
                </div>
            );
        }

        if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType.includes('javascript')) {
            return (
                <iframe
                    src={contentUrl}
                    className="preview-content text-preview"
                    title={file.file_name}
                />
            );
        }

        if (mimeType === 'application/pdf') {
            return (
                <iframe
                    src={contentUrl}
                    className="preview-content pdf-preview"
                    title={file.file_name}
                />
            );
        }

        if (mimeType.startsWith('video/')) {
            return (
                <video controls className="preview-content video-preview">
                    <source src={contentUrl} type={mimeType} />
                    Your browser does not support the video tag.
                </video>
            );
        }

        if (mimeType.startsWith('audio/')) {
            return (
                <audio controls className="preview-content audio-preview">
                    <source src={contentUrl} type={mimeType} />
                    Your browser does not support the audio element.
                </audio>
            );
        }

        return (
            <div className="preview-content unknown-preview">
                <p>Preview not available for this file type ({mimeType})</p>
                <div className="preview-actions">
                    <a href={contentUrl} download={file.file_name} className="primary-button">
                        Download File
                    </a>
                </div>
            </div>
        );
    };

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content preview-modal" onClick={e => e.stopPropagation()}>
                <button className="modal-close" onClick={handleClose}>×</button>

                <div className="modal-header">
                    <h2>Preview: {file.file_name}</h2>
                </div>

                <div className="modal-body">
                    {loading && (
                        <div className="progress-view">
                            <div className="spinner"></div>
                            <p>Loading preview... {Math.round(progress * 100)}%</p>
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${progress * 100}%` }}></div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="error-view">
                            <span className="error-icon">❌</span>
                            <p>{error}</p>
                        </div>
                    )}

                    {!loading && !error && renderPreview()}
                </div>
            </div>
        </div>
    );
}
