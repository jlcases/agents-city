#![no_main]

use agents_city_hybrid_crypto::{fuzz_open, fuzz_public_key_from_seed, fuzz_seal};
use libfuzzer_sys::fuzz_target;

fn partitions(data: &[u8], count: usize) -> Vec<&[u8]> {
    if count == 0 {
        return Vec::new();
    }
    let body = data.get(count.saturating_sub(1)..).unwrap_or_default();
    let weights = data.get(..count.saturating_sub(1)).unwrap_or_default();
    let total_weight = weights
        .iter()
        .fold(count as usize, |total, value| total.saturating_add(*value as usize));
    let mut cursor = 0_usize;
    (0..count)
        .map(|index| {
            let weight = weights.get(index).copied().unwrap_or(0) as usize + 1;
            let remaining = body.len().saturating_sub(cursor);
            let length = if index + 1 == count {
                remaining
            } else {
                body.len().saturating_mul(weight) / total_weight.min(usize::MAX)
            }
            .min(remaining);
            let part = &body[cursor..cursor + length];
            cursor += length;
            part
        })
        .collect()
}

fuzz_target!(|data: &[u8]| {
    let selector = data.first().copied().unwrap_or(0) % 3;
    match selector {
        0 => {
            let _ = fuzz_public_key_from_seed(data.get(1..).unwrap_or_default());
        }
        1 => {
            let parts = partitions(data.get(1..).unwrap_or_default(), 6);
            if let [public, classical, transcript, plaintext, randomness, nonce] = parts.as_slice() {
                let _ = fuzz_seal(public, classical, transcript, plaintext, randomness, nonce);
            }
        }
        _ => {
            let parts = partitions(data.get(1..).unwrap_or_default(), 5);
            if let [seed, classical, transcript, ciphertext, nonce] = parts.as_slice() {
                let _ = fuzz_open(seed, classical, transcript, ciphertext, nonce);
            }
        }
    }
});
