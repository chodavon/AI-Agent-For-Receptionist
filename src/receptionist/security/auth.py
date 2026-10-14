"""Admin authentication: a shared secret sent in the X-Admin-Key header."""

import hmac
import logging

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader

from receptionist.config import Settings, get_settings

logger = logging.getLogger(__name__)
_admin_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)


def require_admin(
    request: Request,
    provided: str | None = Depends(_admin_key_header),
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.admin_api_key.get_secret_value()
    # Refuse all admin access if no key is configured, rather than allowing an empty key.
    if not expected or not provided or not hmac.compare_digest(provided, expected):
        client_ip = request.client.host if request.client else "unknown"
        logger.warning("Admin auth failed from %s", client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
