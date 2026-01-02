import type { FileEntry } from '../lib/types';
import './FileCard.css';

interface FileCardProps {
    file: FileEntry;
    onDownload: (file: FileEntry) => void;
    onPreview: (file: FileEntry) => void;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format timestamp to relative date
 */
function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return date.toLocaleDateString();
}

export function FileCard({ file, onDownload, onPreview }: FileCardProps) {
    const isEncrypted = file.encryption === 'nip44';
    const canPreview = !isEncrypted && file.file_size <= 1048576; // 1MB

    // Get file extension for icon
    const extension = file.file_name.split('.').pop()?.toLowerCase() || '';
    const getFileIcon = () => {
        const icons: Record<string, string> = {
            pdf: '📄',
            doc: '📝', docx: '📝',
            xls: '📊', xlsx: '📊',
            jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
            mp3: '🎵', wav: '🎵', flac: '🎵',
            mp4: '🎬', mov: '🎬', avi: '🎬',
            zip: '📦', tar: '📦', gz: '📦', rar: '📦',
            txt: '📃', md: '📃',
            json: '⚙️', yaml: '⚙️', yml: '⚙️',
        };
        return icons[extension] || '📁';
    };

    return (
        <div className="file-card">
            <div className="file-icon">{getFileIcon()}</div>

            <div className="file-info">
                <h3 className="file-name" title={file.file_name}>
                    {file.file_name}
                </h3>
                <div className="file-meta">
                    <span className="file-size">{formatBytes(file.file_size)}</span>
                    <span className="meta-separator">•</span>
                    <span className="file-date">{formatDate(file.uploaded_at)}</span>
                </div>
            </div>

            <div className="file-actions">
                {isEncrypted && (
                    <span className="encryption-badge encrypted" title="Encrypted (NIP-44)">
                        🔒
                    </span>
                )}
                {canPreview && (
                    <button
                        className="preview-button"
                        onClick={() => onPreview(file)}
                        title="Preview"
                        style={{ marginRight: '8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em' }}
                    >
                        👁️
                    </button>
                )}
                <button
                    className="download-button"
                    onClick={() => onDownload(file)}
                    title={isEncrypted ? 'Download (requires private key)' : 'Download'}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7,10 12,15 17,10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
