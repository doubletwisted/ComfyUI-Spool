"""Machine credentials stay outside project stores and portable project files."""
import os
from pathlib import Path


def key_path():
    # SPOOL_CREDENTIALS moves the key, so test hosts never read or replace this machine's key.
    if folder := os.environ.get('SPOOL_CREDENTIALS'):
        return Path(folder) / 'comfy-cloud.key'
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.config') / 'Spool' / 'comfy-cloud.key'


def cloud_key():
    path = key_path()
    saved = path.read_text(encoding='utf-8').strip() if path.is_file() else ''
    return saved or os.environ.get('COMFY_API_KEY', '').strip()


def key_status():
    return {'hasApiKey': bool(cloud_key()), 'apiKeySource': 'saved' if key_path().is_file() else 'environment' if os.environ.get('COMFY_API_KEY') else None}


def save_key(value):
    if not isinstance(value, str):
        raise ValueError('Enter a Comfy Cloud API key beginning with comfyui-')
    value = value.strip()
    if value and (not value.startswith('comfyui-') or any(c.isspace() for c in value)):
        raise ValueError('Enter a Comfy Cloud API key beginning with comfyui-')
    path = key_path()
    if value:
        path.parent.mkdir(parents=True, exist_ok=True)
        pending = path.with_suffix('.tmp')
        pending.write_text(value, encoding='utf-8')
        pending.chmod(0o600)
        pending.replace(path)
    else:
        path.unlink(missing_ok=True)
