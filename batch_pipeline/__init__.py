"""VaultStream Batch Data Pipeline.

A standalone PySpark / Delta Lake Medallion (Bronze -> Silver -> Gold) pipeline
that recomputes VaultStream's behavioural fraud features over full historical
transaction data for model retraining.

This package is intentionally decoupled from the real-time FastAPI backend: it
has its own requirements, is never imported by the running service, and only
touches the rest of the system at one additive point -- the Gold retraining
export that the existing Model Lab can optionally be pointed at.
"""

__version__ = "1.0.0"
