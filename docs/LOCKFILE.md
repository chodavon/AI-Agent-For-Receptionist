# Pinned dependency versions

`requirements.lock.txt` records exact versions of every installed package in the
development environment on 2026-10-12. It is a snapshot, not a hash-pinned manifest.

## Install from the lockfile (reproducible env)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.lock.txt
pip install -e . --no-deps          # install the project without touching pinned deps
```

## Refresh the lockfile after a dependency change

```powershell
pip install -e ".[dev,voice,tts-mms]"
pip freeze --exclude-editable > requirements.lock.txt
```

## Known limitations

- `pip freeze` does not include package **hashes**, so a compromised PyPI release of the
  same version number would still install silently. Upgrade later to one of:
  - `uv lock` (writes `uv.lock` with hashes; preferred, see `need-improve.md` 5).
  - `pip-compile --generate-hashes` from `pip-tools`.
- The Docker base image (`Dockerfile`) is still pinned by tag, not by digest. See
  `need-improve.md` 5.
- Model revisions (`TTS_MMS_REVISION`, Whisper models) are already pinnable via `.env`;
  pin them before production.

See `need-improve.md` 5 for the full dependency-pinning checklist.
