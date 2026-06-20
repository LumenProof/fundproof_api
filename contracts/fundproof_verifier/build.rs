use soroban_groth16_verifier::generator;
use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let out_dir = env::var("OUT_DIR").unwrap();

    let verification_key_path = Path::new(&manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("build")
        .join("circuits")
        .join("verification_key.json");

    let verification_key = fs::read_to_string(verification_key_path).unwrap();
    let dest_path = Path::new(&out_dir).join("verification_key.rs");

    fs::write(dest_path, generator::generate_from_str(&verification_key, 4).unwrap()).unwrap();
    println!("cargo:rerun-if-changed=../build/circuits/verification_key.json");
}