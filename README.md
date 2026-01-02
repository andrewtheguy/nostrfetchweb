# nostrdownload

Web UI for browsing and downloading files published with [`nostrsave`](https://github.com/andrewtheguy/nostrsave) on Nostr relays.

## Features

- Browse file indexes from a public key (npub or hex).
- Download unencrypted files.
- Download NIP-44 encrypted files by providing your private key (nsec) on the same screen.
- Private key input is cleared immediately; derived secret keys are zeroed after decryption.
- Uses manifest-provided relays when available, with safe fallbacks.

## Usage

```bash
npm install
npm run dev
```

Open the local Vite URL, paste an `npub` (or hex pubkey), and choose a file.
If a file is encrypted, enter your `nsec` and click "Decrypt & Download".

## Notes

- This app uses `nostr-tools` to query relays for the file index, manifests, and chunks.
- Encrypted chunks are decrypted locally in the browser.
- Relay connectivity can vary; if a relay is down, the app will continue with others.
