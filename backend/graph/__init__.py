"""Knowledge-graph layer for fraud-ring detection.

Additive module: nothing here is imported by the existing scoring, streaming,
feature-store or batch code paths. The rest of VaultStream runs identically
whether or not Neo4j is reachable.
"""
