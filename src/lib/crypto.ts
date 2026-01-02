/**
 * NIP-44 decryption utilities
 * Used for decrypting nostrsave encrypted chunks
 */

import * as nip44 from 'nostr-tools/nip44';
import { chacha20 } from '@noble/ciphers/chacha';
import { equalBytes } from '@noble/ciphers/utils';
import { expand as hkdfExpand } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';

const MIN_PLAINTEXT_SIZE = 0x0001;
const MAX_PLAINTEXT_SIZE = 0xffff;

/**
 * Decrypt a NIP-44 encrypted chunk
 * Uses self-encryption: sender and recipient are the same key
 * 
 * @param ciphertext - Base64 encoded NIP-44 encrypted payload
 * @param secretKey - Secret key as Uint8Array
 * @param pubkey - Public key (hex) - same as derived from secretKey for self-encryption
 * @returns Decrypted data as Uint8Array
 */
export function decryptChunk(
    ciphertext: string,
    secretKey: Uint8Array,
    pubkey: string
): Uint8Array {
    // NIP-44 decrypt returns a string, but chunk data may be binary
    // The content is base64 encoded encrypted data
    const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
    const decrypted = nip44.v2.decrypt(ciphertext, conversationKey);

    // Convert decrypted string to Uint8Array (it's binary data encoded as string)
    // The original chunk data was binary, so we need to handle it properly
    return new TextEncoder().encode(decrypted);
}

/**
 * Decrypt a NIP-44 encrypted chunk and return as binary
 * For file chunks, the content is actually base64-encoded binary after decryption
 * 
 * @param ciphertext - NIP-44 encrypted payload
 * @param secretKey - Secret key as Uint8Array
 * @param pubkey - Public key (hex)
 * @returns Decrypted binary data
 */
export function decryptChunkBinary(
    ciphertext: string,
    secretKey: Uint8Array,
    pubkey: string
): Uint8Array {
    const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
    return decryptNip44ToBytes(ciphertext, conversationKey);
}

function calcPaddedLen(len: number): number {
    if (!Number.isSafeInteger(len) || len < 1) throw new Error('expected positive integer');
    if (len <= 32) return 32;
    const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1);
    const chunk = nextPower <= 256 ? 32 : nextPower / 8;
    return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function decodePayload(payload: string): { nonce: Uint8Array; ciphertext: Uint8Array; mac: Uint8Array } {
    if (typeof payload !== 'string') throw new Error('payload must be a valid string');
    const plen = payload.length;
    if (plen < 132 || plen > 87472) throw new Error('invalid payload length: ' + plen);
    if (payload[0] === '#') throw new Error('unknown encryption version');
    let data: Uint8Array;
    try {
        data = base64.decode(payload);
    } catch (error) {
        throw new Error('invalid base64: ' + (error as Error).message);
    }
    const dlen = data.length;
    if (dlen < 99 || dlen > 65603) throw new Error('invalid data length: ' + dlen);
    const vers = data[0];
    if (vers !== 2) throw new Error('unknown encryption version ' + vers);
    return {
        nonce: data.subarray(1, 33),
        ciphertext: data.subarray(33, -32),
        mac: data.subarray(-32),
    };
}

function getMessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): {
    chacha_key: Uint8Array;
    chacha_nonce: Uint8Array;
    hmac_key: Uint8Array;
} {
    const keys = hkdfExpand(sha256, conversationKey, nonce, 76);
    return {
        chacha_key: keys.subarray(0, 32),
        chacha_nonce: keys.subarray(32, 44),
        hmac_key: keys.subarray(44, 76),
    };
}

function hmacAad(key: Uint8Array, message: Uint8Array, aad: Uint8Array): Uint8Array {
    if (aad.length !== 32) throw new Error('AAD associated data must be 32 bytes');
    const combined = concatBytes(aad, message);
    return hmac(sha256, key, combined);
}

function unpadBytes(padded: Uint8Array): Uint8Array {
    const unpaddedLen = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint16(0);
    const unpadded = padded.subarray(2, 2 + unpaddedLen);
    if (
        unpaddedLen < MIN_PLAINTEXT_SIZE ||
        unpaddedLen > MAX_PLAINTEXT_SIZE ||
        unpadded.length !== unpaddedLen ||
        padded.length !== 2 + calcPaddedLen(unpaddedLen)
    ) {
        throw new Error('invalid padding');
    }
    return unpadded;
}

function decryptNip44ToBytes(payload: string, conversationKey: Uint8Array): Uint8Array {
    const { nonce, ciphertext, mac } = decodePayload(payload);
    const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
    const calculatedMac = hmacAad(hmac_key, ciphertext, nonce);
    if (!equalBytes(calculatedMac, mac)) throw new Error('invalid MAC');
    const padded = chacha20(chacha_key, chacha_nonce, ciphertext);
    return unpadBytes(padded);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Convert Uint8Array to base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
    }
    return btoa(binaryString);
}
