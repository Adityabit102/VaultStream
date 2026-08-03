"""Cypher for the fraud-ring knowledge graph.

Kept as plain strings in one place so the queries can be read, pasted into the
Neo4j browser, and reviewed without digging through Python. See schema.py for
what the graph looks like and why.
"""

# --------------------------------------------------------------------------
# Constraints — MERGE without these is a full scan per row.
# --------------------------------------------------------------------------
CONSTRAINTS = [
    "CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT device_id  IF NOT EXISTS FOR (d:Device)  REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT card_id    IF NOT EXISTS FOR (c:Card)    REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT address_id IF NOT EXISTS FOR (x:Address) REQUIRE x.id IS UNIQUE",
]

# Wipe only the graph feature's own data. Scoped to our four labels so it can
# never touch anything else that happens to live in the same database.
RESET = """
CALL apoc.periodic.iterate(
  'MATCH (n) WHERE n:Account OR n:Device OR n:Card OR n:Address RETURN n',
  'DETACH DELETE n', {batchSize: 10000}
)
"""

# apoc is not guaranteed to be installed, so the driver uses this instead.
RESET_PLAIN = """
MATCH (n)
WHERE n:Account OR n:Device OR n:Card OR n:Address
CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 10000 ROWS
"""

# --------------------------------------------------------------------------
# Ingestion — batched UNWIND + MERGE.
# --------------------------------------------------------------------------
MERGE_ACCOUNTS = """
UNWIND $rows AS row
MERGE (a:Account {id: row.id})
SET a.card1 = row.card1,
    a.addr1 = row.addr1,
    a.transactions = row.transactions,
    a.fraud_transactions = row.fraud_transactions,
    a.avg_risk = row.avg_risk,
    a.max_risk = row.max_risk,
    a.total_amount = row.total_amount,
    a.first_seen_day = row.first_seen_day,
    a.last_seen_day = row.last_seen_day
"""

MERGE_IDENTIFIERS = """
UNWIND $rows AS row
MERGE (n:%(label)s {id: row.id})
SET n += row.props, n.degree = row.degree
"""

MERGE_EDGES = """
UNWIND $rows AS row
MATCH (a:Account {id: row.account})
MATCH (n:%(label)s {id: row.identifier})
MERGE (a)-[r:%(rel)s]->(n)
SET r.transactions = row.transactions
"""

# --------------------------------------------------------------------------
# Detection step 1 — shared-identifier clustering.
#
# Two accounts are linked when they reach the same non-supernode identifier and
# the links span at least $minKinds of Device/Card/Address. That kind-diversity
# guard is what stops "the same card counted twice" (card2/card3/card5 nulls
# spawn near-duplicate Card nodes) from passing as two independent identifiers.
#
# Batched with CALL … IN TRANSACTIONS over identifier nodes: run as one
# transaction this exceeds Neo4j's default 1.4 GiB transaction memory pool on
# the full 590k-row graph.
# --------------------------------------------------------------------------
LINK_SHARED_IDENTIFIERS = """
MATCH (i)
WHERE (i:Device OR i:Card OR i:Address) AND i.degree >= 2 AND i.degree <= $maxDegree
CALL (i) {
  MATCH (a:Account)-[:USED_DEVICE|USED_CARD|USED_ADDRESS]->(i)
  MATCH (i)<-[:USED_DEVICE|USED_CARD|USED_ADDRESS]-(b:Account)
  WHERE a.id < b.id
  MERGE (a)-[c:SHARES_IDENTIFIER {identifier: i.id}]->(b)
  SET c.kind = labels(i)[0]
} IN TRANSACTIONS OF 200 ROWS
"""

# Second pass: fold the per-identifier candidate edges into one link per pair.
AGGREGATE_SHARED_LINKS = """
MATCH (a:Account)-[c:SHARES_IDENTIFIER]->(b:Account)
WITH a, b, count(DISTINCT c.identifier) AS shared, collect(DISTINCT c.kind) AS kinds
WHERE shared >= $minShared AND size(kinds) >= $minKinds
MERGE (a)-[r:SHARED_IDENTIFIERS]->(b)
SET r.shared = shared, r.kinds = kinds
RETURN count(r) AS links
"""

# Nothing links to a ring if it has no SHARED_IDENTIFIERS edge; drop stale ones
# from a previous run before relinking.
DROP_SHARED_LINKS = """
MATCH ()-[r:SHARED_IDENTIFIERS|SHARES_IDENTIFIER]->()
CALL (r) { DELETE r } IN TRANSACTIONS OF 20000 ROWS
"""

# The per-identifier candidate edges are scaffolding; drop them once folded.
DROP_CANDIDATE_LINKS = """
MATCH ()-[c:SHARES_IDENTIFIER]->()
CALL (c) { DELETE c } IN TRANSACTIONS OF 20000 ROWS
"""

# --------------------------------------------------------------------------
# Detection step 2 — GDS: Weakly Connected Components, then Louvain inside the
# components for sub-community structure.
# --------------------------------------------------------------------------
GDS_DROP = "CALL gds.graph.drop($name, false) YIELD graphName RETURN graphName"

# Matched directed so each link is projected once; `undirectedRelationshipTypes`
# then makes it traversable both ways. Matching undirected here would double
# every relationship.
GDS_PROJECT = """
MATCH (a:Account)-[r:SHARED_IDENTIFIERS]->(b:Account)
WITH gds.graph.project(
  $name,
  a,
  b,
  {relationshipProperties: {weight: toFloat(r.shared)}},
  {undirectedRelationshipTypes: ['*']}
) AS g
RETURN g.graphName AS graphName, g.nodeCount AS nodes, g.relationshipCount AS rels
"""

GDS_WCC = """
CALL gds.wcc.write($name, {writeProperty: 'componentId'})
YIELD componentCount, nodePropertiesWritten
RETURN componentCount, nodePropertiesWritten
"""

GDS_LOUVAIN = """
CALL gds.louvain.write($name, {
  writeProperty: 'communityId',
  relationshipWeightProperty: 'weight'
})
YIELD communityCount, modularity, nodePropertiesWritten
RETURN communityCount, modularity, nodePropertiesWritten
"""

# --------------------------------------------------------------------------
# Read-out — one row per detected ring.
#
# Ring risk is the mean of member accounts' avg_risk, which is itself the mean
# of that account's existing per-transaction XGBoost scores. No new model.
# --------------------------------------------------------------------------
FETCH_RINGS = """
MATCH (a:Account)
WHERE a.componentId IS NOT NULL
WITH a.componentId AS componentId, a.communityId AS communityId, collect(a) AS members
WHERE size(members) >= $minRingSize
WITH componentId, communityId, members,
     [m IN members | m.id] AS memberIds,
     reduce(s = 0.0, m IN members | s + coalesce(m.avg_risk, 0.0)) / size(members) AS ringRisk,
     reduce(s = 0,   m IN members | s + coalesce(m.transactions, 0)) AS txCount,
     reduce(s = 0,   m IN members | s + coalesce(m.fraud_transactions, 0)) AS fraudTx,
     reduce(s = 0.0, m IN members | s + coalesce(m.total_amount, 0.0)) AS totalAmount,
     reduce(mx = 0.0, m IN members | CASE WHEN coalesce(m.max_risk, 0.0) > mx
                                          THEN m.max_risk ELSE mx END) AS peakRisk
CALL (members) {
  WITH members
  UNWIND members AS m
  MATCH (m)-[e:SHARED_IDENTIFIERS]-(o:Account)
  WHERE o IN members
  RETURN collect(DISTINCT {source: startNode(e).id, target: endNode(e).id,
                           shared: e.shared, kinds: e.kinds}) AS edges
}
CALL (members) {
  WITH members
  UNWIND members AS m
  MATCH (m)-[:USED_DEVICE|USED_CARD|USED_ADDRESS]->(i)
  WHERE i.degree >= 2 AND i.degree <= $maxDegree
  WITH i, collect(DISTINCT m.id) AS touchedIds
  WHERE size(touchedIds) >= 2
  RETURN collect({id: i.id, kind: labels(i)[0], accounts: size(touchedIds),
                  members: touchedIds, label: coalesce(i.label, i.id)}) AS identifiers
}
RETURN componentId, communityId, memberIds, edges, identifiers,
       size(members) AS size, ringRisk, peakRisk, txCount, fraudTx, totalAmount
ORDER BY ringRisk DESC, size DESC
LIMIT $limit
"""

GRAPH_STATS = """
MATCH (a:Account) WITH count(a) AS accounts, sum(a.transactions) AS transactions
MATCH (d:Device)  WITH accounts, transactions, count(d) AS devices
MATCH (c:Card)    WITH accounts, transactions, devices, count(c) AS cards
MATCH (x:Address) WITH accounts, transactions, devices, cards, count(x) AS addresses
OPTIONAL MATCH ()-[r:SHARED_IDENTIFIERS]->()
RETURN accounts, transactions, devices, cards, addresses, count(r) AS shared_links
"""
