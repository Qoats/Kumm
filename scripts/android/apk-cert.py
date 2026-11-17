#!/usr/bin/env python3
"""Empreintes SHA-256 des certificats de signature d'un APK, au format lu par release.mjs.

Lit directement l'APK (signature v1 dans META-INF, blocs v2 et v3) au lieu d'analyser le texte d'apksigner,
dont le format change d'une version à l'autre. Les empreintes de certificat sont publiques.
Usage : apk-cert.py kumm.apk
"""
import hashlib
import struct
import subprocess
import sys
import zipfile

V2, V3, V31 = 0x7109871A, 0xF05368C0, 0x1B93AD61


def v1_certs(path):
    found = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.startswith("META-INF/") and name.upper().endswith((".RSA", ".DSA", ".EC")):
                pem = subprocess.run(["openssl", "pkcs7", "-inform", "DER", "-print_certs"], input=z.read(name), capture_output=True).stdout
                der = subprocess.run(["openssl", "x509", "-outform", "DER"], input=pem, capture_output=True).stdout
                if der:
                    found.append(hashlib.sha256(der).hexdigest())
    return found


def signing_block_certs(path):
    data = open(path, "rb").read()
    eocd = data.rfind(b"PK\x05\x06")
    if eocd < 0:
        return []
    cd_offset = struct.unpack("<I", data[eocd + 16:eocd + 20])[0]
    if data[cd_offset - 16:cd_offset] != b"APK Sig Block 42":
        return []
    size = struct.unpack("<Q", data[cd_offset - 24:cd_offset - 16])[0]
    pairs = data[cd_offset - size:cd_offset - 24]
    found, i = [], 0
    u32 = lambda b, o: struct.unpack("<I", b[o:o + 4])[0]
    while i + 12 <= len(pairs):
        length = struct.unpack("<Q", pairs[i:i + 8])[0]
        pair_id = u32(pairs, i + 8)
        value = pairs[i + 12:i + 8 + length]
        i += 8 + length
        if pair_id not in (V2, V3, V31):
            continue
        # séquence de signataires ; chacun : données signées (empreintes puis certificats)
        pos, end = 4, 4 + u32(value, 0)
        while pos < end:
            signer_len = u32(value, pos)
            signer = value[pos + 4:pos + 4 + signer_len]
            pos += 4 + signer_len
            signed = signer[4:4 + u32(signer, 0)]
            digests = u32(signed, 0)
            certs_at = 4 + digests
            certs_end = certs_at + 4 + u32(signed, certs_at)
            c = certs_at + 4
            first = True
            while c < certs_end:
                cert_len = u32(signed, c)
                if first:   # le premier certificat est celui du signataire (les suivants sont la chaîne)
                    found.append(hashlib.sha256(signed[c + 4:c + 4 + cert_len]).hexdigest())
                first = False
                c += 4 + cert_len
    return found


if __name__ == "__main__":
    apk = sys.argv[1]
    digests = sorted(set(signing_block_certs(apk) or v1_certs(apk)))
    if not digests:
        sys.exit("Aucun certificat de signature lu dans " + apk)
    for n, d in enumerate(digests, 1):
        print(f"Signer #{n} certificate SHA-256 digest: {d}")
