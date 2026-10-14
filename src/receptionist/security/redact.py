"""Mask personal data (emails, phone numbers, card numbers) before it reaches logs."""

import re

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# 7+ digits, allowing spaces/dashes/dots and an optional leading +
_PHONE = re.compile(r"\+?\d[\d\s().-]{5,}\d")
# Credit/debit card numbers: 13-19 digits with optional separators
_CARD = re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b")
# Passport-style IDs: 1-2 uppercase letters followed by 6-9 digits
_PASSPORT = re.compile(r"\b[A-Z]{1,2}\d{6,9}\b")


def redact(text: str) -> str:
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    text = _CARD.sub("[card]", text)
    return _PASSPORT.sub("[id]", text)
