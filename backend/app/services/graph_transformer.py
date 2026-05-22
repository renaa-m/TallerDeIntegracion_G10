"""Transforma el formato .qm de MillenniumDB al formato de elementos de Cytoscape.js."""

import re
from typing import Any

_SYSTEM_NODE_TYPES = frozenset({"Document", "Chunk"})
_SYSTEM_EDGE_TYPES = frozenset({"ChunkOf", "ExtractedFrom"})

# prop:"quoted value"  o  prop:unquoted_value
_PROP_RE = re.compile(r'(\w+):(?:"([^"]*)"|(\S+))')

# ObjectId :EntityType [props...]
_NODE_RE = re.compile(r"^(\w+)\s+:(\w+)(.*)")

# OriginId->TargetId :RelationType [props...]
_EDGE_RE = re.compile(r"^(\w+)->(\w+)\s+:(\w+)(.*)")


def _parse_props(raw: str) -> dict[str, str]:
    props: dict[str, str] = {}
    for m in _PROP_RE.finditer(raw):
        key = m.group(1)
        value = m.group(2) if m.group(2) is not None else m.group(3)
        props[key] = value
    return props


def _first_meaningful_value(props: dict[str, str], fallback: str) -> str:
    for v in props.values():
        if v and v != "NULL":
            return v
    return fallback


def qm_to_cytoscape(qm_text: str) -> dict[str, Any]:
    """Parsea el texto .qm y devuelve un dict compatible con Cytoscape.js.

    Filtra los nodos de tipo Document/Chunk y las relaciones ChunkOf/ExtractedFrom.
    """
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    node_ids: set[str] = set()

    for line in qm_text.splitlines():
        line = line.strip()
        if not line:
            continue

        edge_m = _EDGE_RE.match(line)
        if edge_m:
            source, target, rel_type, props_raw = edge_m.groups()
            if rel_type in _SYSTEM_EDGE_TYPES:
                continue
            props = _parse_props(props_raw)
            edges.append(
                {
                    "data": {
                        "id": f"{source}->{target}:{rel_type}",
                        "source": source,
                        "target": target,
                        "label": rel_type,
                        **props,
                    }
                }
            )
            continue

        node_m = _NODE_RE.match(line)
        if node_m:
            node_id, entity_type, props_raw = node_m.groups()
            if entity_type in _SYSTEM_NODE_TYPES:
                continue
            props = _parse_props(props_raw)
            label = _first_meaningful_value(props, node_id)
            node_ids.add(node_id)
            nodes.append(
                {
                    "data": {
                        "id": node_id,
                        "label": label,
                        "type": entity_type,
                        **props,
                    }
                }
            )

    # Descarta aristas cuyos extremos fueron filtrados (Document/Chunk)
    valid_edges = [
        e
        for e in edges
        if e["data"]["source"] in node_ids and e["data"]["target"] in node_ids
    ]

    return {"elements": {"nodes": nodes, "edges": valid_edges}}
