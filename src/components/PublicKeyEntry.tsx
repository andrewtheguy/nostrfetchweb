import { useState, useCallback } from 'react';
import {
    normalizeToPublicKey,
    clearSecretKey,
    publicKeyToNpub,
    isValidNpub,
    isValidNsec,
    isValidHexPubkey
} from '../lib/keys';
import './PublicKeyEntry.css';

interface PublicKeyEntryProps {
    onSubmit: (pubkey: string) => void;
}

export function PublicKeyEntry({ onSubmit }: PublicKeyEntryProps) {
    const [input, setInput] = useState('');
    const [displayNpub, setDisplayNpub] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [wasNsec, setWasNsec] = useState(false);


    const processInputValue = useCallback((value: string) => {
        setInput(value);
        setError(null);
        setDisplayNpub(null);
        setWasNsec(false);

        // If it looks like an nsec, immediately convert and clear
        if (isValidNsec(value)) {
            try {
                const result = normalizeToPublicKey(value);
                const npub = publicKeyToNpub(result.pubkey);

                // Immediately clear the secret key
                if (result.secretKey) {
                    clearSecretKey(result.secretKey);
                }

                // Show the converted npub
                setDisplayNpub(npub);
                setWasNsec(true);

                // Clear the input field of the nsec (state + DOM)
                setInput('');
                setInput('');
            } catch {
                setError('Invalid nsec format');
            }
        }
    }, []);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        processInputValue(e.target.value);
    }, [processInputValue]);





    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            let pubkey: string;

            if (displayNpub) {
                // Already converted from nsec
                const result = normalizeToPublicKey(displayNpub);
                pubkey = result.pubkey;
            } else if (input.trim()) {
                const result = normalizeToPublicKey(input.trim());
                pubkey = result.pubkey;

                // Clear any secret key that was generated
                if (result.secretKey) {
                    clearSecretKey(result.secretKey);
                }
            } else {
                setError('Please enter a public key');
                return;
            }

            onSubmit(pubkey);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Invalid key format');
        }
    }, [input, displayNpub, onSubmit]);

    const isValid = displayNpub || isValidNpub(input.trim()) || isValidHexPubkey(input.trim());

    return (
        <div className="public-key-entry">
            <div className="entry-card">
                <div className="entry-header">
                    <h1>Nostr Fetch</h1>
                    <p className="subtitle">
                        Download files saved by{' '}
                        <a href="https://github.com/andrewtheguy/nostrsave" target="_blank" rel="noreferrer">
                            nostrsave
                        </a>
                        .
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="entry-form">
                    <div className="input-group">
                        <label htmlFor="key-input">Enter Public or Private Key</label>
                        <input
                            id="key-input"
                            type="password"
                            value={input}
                            onChange={handleInputChange}
                            placeholder="npub1... or nsec1... (will be converted)"
                            className={error ? 'error' : ''}
                            autoComplete="new-password"
                            spellCheck={false}
                        />
                        {error && <span className="error-message">{error}</span>}
                    </div>

                    {displayNpub && (
                        <div className="converted-key">
                            <span className="converted-label">
                                {wasNsec ? '🔒 Converted from nsec (key cleared):' : 'Public key:'}
                            </span>
                            <code className="npub-display">{displayNpub}</code>
                        </div>
                    )}

                    <button
                        type="submit"
                        className="browse-button"
                        disabled={!isValid && !displayNpub}
                    >
                        Browse Files
                    </button>
                </form>

                <div className="security-notice">
                    <span className="security-icon">🔐</span>
                    <span>
                        Private keys (nsec) are immediately converted and erased.
                        They are never stored or transmitted.
                    </span>
                </div>
            </div>
        </div>
    );
}
