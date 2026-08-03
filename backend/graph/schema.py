"""Graph schema for the fraud-ring knowledge graph.

    (:Account)-[:USED_DEVICE  {transactions}]->(:Device)
    (:Account)-[:USED_CARD    {transactions}]->(:Card)
    (:Account)-[:USED_ADDRESS {transactions}]->(:Address)

Detection materialises one derived edge between accounts that share identifiers:

    (:Account)-[:SHARED_IDENTIFIERS {shared, kinds}]->(:Account)

--------------------------------------------------------------------------
How `Account` is derived — read this before trusting a ring
--------------------------------------------------------------------------
IEEE-CIS has no account/customer column, so an Account node is a *derived
pseudo-identity*, not a field in the data:

    Account id  =  card1  +  addr1

i.e. "this payment card at this billing address". This is a simplification of the
well-known Kaggle UID heuristic, which also adds `transaction_day - D1` (the day
the card was opened). We deliberately leave the D1 term out: D1 is null or noisy
for a large share of rows, so including it shatters a single real cardholder into
dozens of Account nodes that differ by nothing an analyst would recognise. That
fragmentation adds no signal, and it inflated shared-identifier clustering into
millions of candidate pairs. Dropping it costs only the ability to distinguish two
people who share both a card and a billing address — who are, in practice, one
person. The README states this.

The remaining risk is that a shared `Card` or `Address` node is weak evidence on
its own, since the Account key is built from card1 and addr1. Detection therefore
requires **two shared identifiers spanning ≥2 distinct kinds** of {Device, Card,
Address}. The "distinct kinds" part is load-bearing: card2/card3/card5 are often
null, so one physical card can yield several `Card` nodes, and counting nodes
alone would let "the same card, twice" pass as two independent identifiers.

Every surviving link therefore means two genuinely different card/address
identities converging on shared hardware or shared plastic. `Device` is the only
identifier fully independent of the Account key, so device-backed links are the
strongest signal here, and every ring carries a `shared_kinds` breakdown so an
analyst can see what the link actually rests on.

--------------------------------------------------------------------------
Supernode filtering
--------------------------------------------------------------------------
`DeviceInfo` values like "Windows" and common `addr1` values are shared by tens
of thousands of unrelated people. An identifier touched by more than
`max_identifier_degree` accounts is a population-level attribute, not a ring, so
it is excluded from linking. Each identifier node stores its `degree` at ingest
time to make that filter cheap.

--------------------------------------------------------------------------
Honesty note (carried over from the PRD)
--------------------------------------------------------------------------
IEEE-CIS ships no raw IP field. There is no IP-based clustering here. Identity
is device + card + address only.
"""

NODE_LABELS = ("Account", "Device", "Card", "Address")
REL_TYPES = ("USED_DEVICE", "USED_CARD", "USED_ADDRESS")
DERIVED_REL = "SHARED_IDENTIFIERS"

# Identifier label -> relationship used to reach it from an Account.
IDENTIFIER_RELS = {
    "Device": "USED_DEVICE",
    "Card": "USED_CARD",
    "Address": "USED_ADDRESS",
}

# Defaults for detection. Deliberately conservative: we would rather surface a
# handful of defensible rings than a wall of coincidences.
DEFAULT_MIN_SHARED = 2          # distinct identifier nodes two accounts must share
DEFAULT_MIN_KINDS = 2           # …spanning at least this many of Device/Card/Address
DEFAULT_MIN_RING_SIZE = 3       # accounts per ring (PRD: "3+ accounts")
DEFAULT_MAX_IDENTIFIER_DEGREE = 20  # above this an identifier is a supernode

# GDS in-memory projection name; dropped and rebuilt on every detection run.
GDS_GRAPH_NAME = "fraudRings"
