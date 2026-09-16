class ProviderError(Exception):
    """Raised when a provider can't serve a request (no key, offline, timeout)."""
