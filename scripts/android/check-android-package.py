"""Vérifie le contenu extrait. Les résultats ne contiennent que les noms des fichiers."""
import re
import sys
from zipfile import ZipFile

private_file = re.compile(r"(?i)(?:^|/)(?:\.env(?:\.[^/]*)?|[^/]+\.(?:jks|keystore|p12|pfx|pem)|google-services\.json|session-key|firebase\.json)$")
credential = re.compile(
    rb"-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b"
    rb"|(?:CTS_TOKEN|SNCF_API_KEY|SNCF_TOKEN|VITE_APP_KEY)|X-App-Key"
    rb"|https?://[^\s/<>\x27\x22:@]+:[^\s/<>\x27\x22@]+@",
    re.IGNORECASE,
)

with ZipFile(sys.argv[1]) as package:
    failures = [
        name for name in package.namelist()
        if not name.endswith("/") and (
            private_file.search(name) or
            ("/assets/public/" in "/" + name and credential.search(package.read(name))) or
            (name.endswith(".dex") and credential.search(package.read(name)))
        )
    ]
if failures:
    sys.exit("Contenu sensible possible dans : " + ", ".join(failures))
print("Contrôle du paquet réussi.")
