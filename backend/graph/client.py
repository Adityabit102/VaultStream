"""Neo4j connection handling.

Every entry point here is failure-tolerant on purpose. The graph is an additive
feature: if the `neo4j` package is missing, the container is down, or the
credentials are wrong, the caller gets `None` and falls back to the committed
snapshot. Nothing raises into the request path.
"""
import os
import threading

NEO4J_URI = os.environ.get("NEO4J_URI", "")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "vaultstream")
NEO4J_DATABASE = os.environ.get("NEO4J_DATABASE", "neo4j")

_driver = None
_lock = threading.Lock()
_probe_failed = False


def configured() -> bool:
    """True when a NEO4J_URI is set. Production (Render) leaves it unset and
    serves the snapshot, which is why the deploy needs no graph database."""
    return bool(NEO4J_URI)


def get_driver(force: bool = False):
    """Return a live driver, or None if the graph is unavailable.

    A failed connection is remembered so a down Neo4j costs one timeout, not one
    per request. `force=True` (used by the ingest script) retries regardless.
    """
    global _driver, _probe_failed
    if not configured() and not force:
        return None
    if _probe_failed and not force:
        return None

    with _lock:
        if _driver is not None:
            return _driver
        try:
            from neo4j import GraphDatabase
        except ImportError:
            _probe_failed = True
            return None
        try:
            uri = NEO4J_URI or "bolt://localhost:7687"
            driver = GraphDatabase.driver(
                uri,
                auth=(NEO4J_USER, NEO4J_PASSWORD),
                connection_timeout=5,
                max_connection_lifetime=300,
            )
            driver.verify_connectivity()
        except Exception as exc:  # unreachable, bad auth, wrong port…
            print(f"[graph] Neo4j unavailable ({exc.__class__.__name__}): falling back to snapshot")
            _probe_failed = True
            return None
        _driver = driver
        _probe_failed = False
        return _driver


def run(query: str, **params):
    """Execute a read query and return a list of dicts. None if unavailable."""
    driver = get_driver()
    if driver is None:
        return None
    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            return [dict(r) for r in session.run(query, **params)]
    except Exception as exc:
        print(f"[graph] query failed ({exc.__class__.__name__}): {exc}")
        return None


def close():
    global _driver
    with _lock:
        if _driver is not None:
            try:
                _driver.close()
            finally:
                _driver = None
