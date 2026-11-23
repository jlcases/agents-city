#![deny(unsafe_code)]

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use hkdf::Hkdf;
use libcrux_ml_kem::mlkem768::{
    decapsulate, encapsulate, generate_key_pair, validate_private_key, validate_public_key,
    MlKem768Ciphertext, MlKem768PublicKey,
};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;
use zeroize::{Zeroize, Zeroizing};

pub const MLKEM768_PUBLIC_KEY_BYTES: usize = 1_184;
pub const MLKEM768_CIPHERTEXT_BYTES: usize = 1_088;
pub const MLKEM768_SEED_BYTES: usize = 64;
pub const X25519_SHARED_SECRET_BYTES: usize = 32;
pub const AES_GCM_NONCE_BYTES: usize = 12;
pub const AES_GCM_TAG_BYTES: usize = 16;
const MAX_TRANSCRIPT_BYTES: usize = 16_384;
const MAX_PLAINTEXT_BYTES: usize = 32_768;
const KDF_DOMAIN: &[u8] = b"agents-city-hybrid-establishment/1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CryptoError(&'static str);

type CryptoResult<T> = Result<T, CryptoError>;

fn exact_array<const N: usize>(input: &[u8], error: &'static str) -> CryptoResult<[u8; N]> {
    input.try_into().map_err(|_| CryptoError(error))
}

fn derive_key(
    classical_secret: &[u8],
    post_quantum_secret: &[u8; 32],
    transcript: &[u8],
) -> CryptoResult<Zeroizing<[u8; 32]>> {
    if classical_secret.len() != X25519_SHARED_SECRET_BYTES {
        return Err(CryptoError("invalid_x25519_shared_secret"));
    }
    if transcript.is_empty() || transcript.len() > MAX_TRANSCRIPT_BYTES {
        return Err(CryptoError("invalid_hybrid_transcript"));
    }
    let transcript_hash = Sha256::digest(transcript);
    let mut ikm = Zeroizing::new(Vec::with_capacity(
        KDF_DOMAIN.len() + classical_secret.len() + post_quantum_secret.len(),
    ));
    ikm.extend_from_slice(KDF_DOMAIN);
    ikm.extend_from_slice(classical_secret);
    ikm.extend_from_slice(post_quantum_secret);
    let hkdf = Hkdf::<Sha256>::new(Some(&transcript_hash), ikm.as_slice());
    let mut key = Zeroizing::new([0_u8; 32]);
    hkdf.expand(b"road-prekey-wrapper-aes-256-gcm", key.as_mut())
        .map_err(|_| CryptoError("hybrid_kdf_failed"))?;
    Ok(key)
}

fn public_key_from_seed(seed: &[u8]) -> CryptoResult<Vec<u8>> {
    let mut seed = Zeroizing::new(exact_array::<MLKEM768_SEED_BYTES>(
        seed,
        "invalid_mlkem768_seed",
    )?);
    let pair = generate_key_pair(*seed);
    seed.zeroize();
    let public = pair.pk().to_vec();
    let (private, public_key) = pair.into_parts();
    let mut private_bytes: [u8; 2_400] = private.into();
    let mut public_bytes: [u8; MLKEM768_PUBLIC_KEY_BYTES] = public_key.into();
    private_bytes.zeroize();
    public_bytes.zeroize();
    Ok(public)
}

fn seal(
    public_key: &[u8],
    classical_secret: &[u8],
    transcript: &[u8],
    plaintext: &[u8],
    kem_randomness: &[u8],
    nonce: &[u8],
) -> CryptoResult<Vec<u8>> {
    if plaintext.is_empty() || plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(CryptoError("invalid_hybrid_plaintext"));
    }
    let public_key = MlKem768PublicKey::try_from(public_key)
        .map_err(|_| CryptoError("invalid_mlkem768_public_key"))?;
    if !validate_public_key(&public_key) {
        return Err(CryptoError("invalid_mlkem768_public_key"));
    }
    let mut randomness = Zeroizing::new(exact_array::<32>(
        kem_randomness,
        "invalid_mlkem768_encapsulation_randomness",
    )?);
    let nonce = exact_array::<AES_GCM_NONCE_BYTES>(nonce, "invalid_hybrid_nonce")?;
    let (ciphertext, mut shared_secret) = encapsulate(&public_key, *randomness);
    randomness.zeroize();
    let key = derive_key(classical_secret, &shared_secret, transcript)?;
    shared_secret.zeroize();
    let cipher = Aes256Gcm::new_from_slice(key.as_slice())
        .map_err(|_| CryptoError("hybrid_cipher_initialization_failed"))?;
    let wrapped = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: transcript,
            },
        )
        .map_err(|_| CryptoError("hybrid_encryption_failed"))?;
    let mut output = Vec::with_capacity(MLKEM768_CIPHERTEXT_BYTES + wrapped.len());
    output.extend_from_slice(ciphertext.as_slice());
    output.extend_from_slice(&wrapped);
    Ok(output)
}

fn open(
    seed: &[u8],
    classical_secret: &[u8],
    transcript: &[u8],
    ciphertext: &[u8],
    nonce: &[u8],
) -> CryptoResult<Vec<u8>> {
    if ciphertext.len() <= MLKEM768_CIPHERTEXT_BYTES + AES_GCM_TAG_BYTES
        || ciphertext.len() > MLKEM768_CIPHERTEXT_BYTES + MAX_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES
    {
        return Err(CryptoError("invalid_hybrid_ciphertext"));
    }
    let mut seed = Zeroizing::new(exact_array::<MLKEM768_SEED_BYTES>(
        seed,
        "invalid_mlkem768_seed",
    )?);
    let nonce = exact_array::<AES_GCM_NONCE_BYTES>(nonce, "invalid_hybrid_nonce")?;
    let kem_ciphertext = MlKem768Ciphertext::try_from(&ciphertext[..MLKEM768_CIPHERTEXT_BYTES])
        .map_err(|_| CryptoError("invalid_mlkem768_ciphertext"))?;
    let pair = generate_key_pair(*seed);
    seed.zeroize();
    if !validate_private_key(pair.private_key(), &kem_ciphertext) {
        return Err(CryptoError("invalid_mlkem768_decapsulation_input"));
    }
    let mut shared_secret = decapsulate(pair.private_key(), &kem_ciphertext);
    let key = derive_key(classical_secret, &shared_secret, transcript)?;
    shared_secret.zeroize();
    let cipher = Aes256Gcm::new_from_slice(key.as_slice())
        .map_err(|_| CryptoError("hybrid_cipher_initialization_failed"))?;
    let result = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext[MLKEM768_CIPHERTEXT_BYTES..],
                aad: transcript,
            },
        )
        .map_err(|_| CryptoError("hybrid_authentication_failed"));
    let (private, public_key) = pair.into_parts();
    let mut private_bytes: [u8; 2_400] = private.into();
    let mut public_bytes: [u8; MLKEM768_PUBLIC_KEY_BYTES] = public_key.into();
    private_bytes.zeroize();
    public_bytes.zeroize();
    result
}

// Kept behind a non-default feature so cargo-fuzz can exercise the exact
// production primitives without exposing a second cryptographic
// implementation or linking libFuzzer into release artifacts.
#[cfg(feature = "fuzzing")]
pub fn fuzz_public_key_from_seed(seed: &[u8]) -> Result<Vec<u8>, &'static str> {
    public_key_from_seed(seed).map_err(|error| error.0)
}

#[cfg(feature = "fuzzing")]
pub fn fuzz_seal(
    public_key: &[u8],
    classical_secret: &[u8],
    transcript: &[u8],
    plaintext: &[u8],
    kem_randomness: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, &'static str> {
    seal(
        public_key,
        classical_secret,
        transcript,
        plaintext,
        kem_randomness,
        nonce,
    )
    .map_err(|error| error.0)
}

#[cfg(feature = "fuzzing")]
pub fn fuzz_open(
    seed: &[u8],
    classical_secret: &[u8],
    transcript: &[u8],
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, &'static str> {
    open(seed, classical_secret, transcript, ciphertext, nonce)
        .map_err(|error| error.0)
}

#[wasm_bindgen]
pub fn mlkem768_public_key(seed: &[u8]) -> Result<Vec<u8>, JsError> {
    public_key_from_seed(seed).map_err(|error| JsError::new(error.0))
}

#[wasm_bindgen]
pub fn hybrid_seal(
    public_key: &[u8],
    classical_secret: &[u8],
    transcript: &[u8],
    plaintext: &[u8],
    kem_randomness: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, JsError> {
    seal(
        public_key,
        classical_secret,
        transcript,
        plaintext,
        kem_randomness,
        nonce,
    )
    .map_err(|error| JsError::new(error.0))
}

#[wasm_bindgen]
pub fn hybrid_open(
    seed: &[u8],
    classical_secret: &[u8],
    transcript: &[u8],
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, JsError> {
    open(seed, classical_secret, transcript, ciphertext, nonce)
        .map_err(|error| JsError::new(error.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vector(path: &str) -> Value {
        let raw = match path {
            "keygen" => include_str!("../tests/vectors/mlkem768-keygen-acvp.json"),
            "encapsulation" => include_str!("../tests/vectors/mlkem768-acvp.json"),
            _ => panic!("unknown vector"),
        };
        serde_json::from_str(raw).expect("valid vendored NIST ACVP vector")
    }

    fn vector_hex<const N: usize>(value: &Value, field: &str) -> [u8; N] {
        let encoded = value["test"][field]
            .as_str()
            .unwrap_or_else(|| panic!("missing {field}"));
        let decoded = hex::decode(encoded).unwrap_or_else(|_| panic!("invalid {field} hex"));
        decoded
            .try_into()
            .unwrap_or_else(|_| panic!("wrong {field} length"))
    }

    #[test]
    fn matches_nist_fips_203_mlkem768_key_generation_vector() {
        let vector = vector("keygen");
        assert_eq!(vector["sourceCommit"], "975de31eb83d87039ec88934fdc47d8c312b892d");
        assert_eq!(vector["testGroup"]["parameterSet"], "ML-KEM-768");
        let d = vector_hex::<32>(&vector, "d");
        let z = vector_hex::<32>(&vector, "z");
        let expected_public = vector_hex::<MLKEM768_PUBLIC_KEY_BYTES>(&vector, "ek");
        let mut seed = [0_u8; MLKEM768_SEED_BYTES];
        seed[..32].copy_from_slice(&d);
        seed[32..].copy_from_slice(&z);
        let actual_public = public_key_from_seed(&seed).expect("FIPS 203 key generation");
        seed.zeroize();
        assert_eq!(actual_public, expected_public);
    }

    #[test]
    fn matches_nist_fips_203_mlkem768_encapsulation_vector() {
        let vector = vector("encapsulation");
        assert_eq!(vector["sourceCommit"], "975de31eb83d87039ec88934fdc47d8c312b892d");
        assert_eq!(vector["testGroup"]["parameterSet"], "ML-KEM-768");
        let public = vector_hex::<MLKEM768_PUBLIC_KEY_BYTES>(&vector, "ek");
        let randomness = vector_hex::<32>(&vector, "m");
        let expected_ciphertext = vector_hex::<MLKEM768_CIPHERTEXT_BYTES>(&vector, "c");
        let expected_shared = vector_hex::<32>(&vector, "k");
        let public = MlKem768PublicKey::try_from(public.as_slice())
            .expect("valid FIPS 203 public key");
        assert!(validate_public_key(&public));
        let (ciphertext, mut shared) = encapsulate(&public, randomness);
        assert_eq!(ciphertext.as_slice(), &expected_ciphertext);
        assert_eq!(shared, expected_shared);
        shared.zeroize();
    }

    #[test]
    fn hybrid_round_trip_and_binding() {
        let seed = [7_u8; MLKEM768_SEED_BYTES];
        let public = public_key_from_seed(&seed).expect("key generation");
        assert_eq!(public.len(), MLKEM768_PUBLIC_KEY_BYTES);
        let classical = [9_u8; X25519_SHARED_SECRET_BYTES];
        let transcript = b"canonical-road-transcript";
        let nonce = [11_u8; AES_GCM_NONCE_BYTES];
        let ciphertext = seal(
            &public,
            &classical,
            transcript,
            b"private initial Olm message",
            &[13_u8; 32],
            &nonce,
        )
        .expect("hybrid seal");
        assert_eq!(
            ciphertext.len(),
            MLKEM768_CIPHERTEXT_BYTES + b"private initial Olm message".len() + AES_GCM_TAG_BYTES,
        );
        assert_eq!(
            open(&seed, &classical, transcript, &ciphertext, &nonce).expect("hybrid open"),
            b"private initial Olm message",
        );
        assert!(open(&seed, &classical, b"other transcript", &ciphertext, &nonce).is_err());
        let mut tampered = ciphertext.clone();
        tampered[MLKEM768_CIPHERTEXT_BYTES + 1] ^= 1;
        assert!(open(&seed, &classical, transcript, &tampered, &nonce).is_err());
    }

    #[test]
    fn rejects_noncanonical_and_wrong_sized_inputs() {
        let seed = [17_u8; MLKEM768_SEED_BYTES];
        let mut public = public_key_from_seed(&seed).expect("key generation");
        public[0] = 0xff;
        public[1] = 0xff;
        assert!(seal(
            &public,
            &[3_u8; 32],
            b"transcript",
            b"message",
            &[4_u8; 32],
            &[5_u8; 12],
        )
        .is_err());
        assert!(public_key_from_seed(&seed[..63]).is_err());
    }
}
