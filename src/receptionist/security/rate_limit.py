"""Per-client rate limiting (slowapi)."""

from slowapi import Limiter
from starlette.requests import Request


def _get_real_ip(request: Request) -> str:
    """Extract the real client IP, respecting X-Forwarded-For behind a reverse proxy."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=_get_real_ip)
