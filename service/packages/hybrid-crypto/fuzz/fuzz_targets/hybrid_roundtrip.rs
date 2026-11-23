#![no_main]

use agents_city_hybrid_crypto::{fuzz_open, fuzz_public_key_from_seed, fuzz_seal};
use libfuzzer_sys::fuzz_target;

const FIXED_BYTES: usize = 64 + 32 + 32 + 12;

fuzz_target!(|data: &[u8]| {
    if data.len() <= FIXED_BYTES + 2 {
        return;
    }
    let seed = &data[..64];
    let classical = &data[64..96];
    let randomness = &data[96..128];
    let nonce = &data[128..140];
    let variable = &data[140..];
    let boundary = 1 + (variable[0] as usize % (variable.len() - 1));
    let transcript = &variable[..boundary];
    let plaintext = &variable[boundary..];
    if transcript.len() > 16_384 || plaintext.is_empty() || plaintext.len() > 32_768 {
        return;
    }

    let public = fuzz_public_key_from_seed(seed).expect("fixed seed length");
    let ciphertext = fuzz_seal(
        &public,
        classical,
        transcript,
        plaintext,
        randomness,
        nonce,
    )
    .expect("valid generated inputs");
    let opened = fuzz_open(seed, classical, transcript, &ciphertext, nonce)
        .expect("round trip must authenticate");
    assert_eq!(opened, plaintext);

    let mut tampered = ciphertext;
    let position = variable[0] as usize % tampered.len();
    tampered[position] ^= 1;
    assert!(fuzz_open(seed, classical, transcript, &tampered, nonce).is_err());
});
