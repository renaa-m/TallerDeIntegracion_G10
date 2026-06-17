"""Transforma el formato .qm de MillenniumDB al formato de elementos de Cytoscape.js."""

import re
from typing import Any

_SYSTEM_NODE_TYPES = frozenset({"Document", "Chunk"})
_SYSTEM_EDGE_TYPES = frozenset({"ChunkOf", "ExtractedFrom"})

# Caché en memoria: collection_id (str) → facets dict
# Se invalida cuando la colección es reprocesada.
_facets_cache: dict[str, dict] = {}


def get_cached_facets(collection_id: str) -> dict | None:
    return _facets_cache.get(collection_id)


def set_cached_facets(collection_id: str, facets: dict) -> None:
    _facets_cache[collection_id] = facets


def invalidate_facets_cache(collection_id: str) -> None:
    _facets_cache.pop(collection_id, None)

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


def qm_to_cytoscape(
    qm_text: str,
    chunk_sources: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Parsea el texto .qm y devuelve un dict compatible con Cytoscape.js.

    Filtra los nodos de tipo Document/Chunk y las relaciones ChunkOf/ExtractedFrom.
    Incluye el texto del chunk en las aristas que lo referencian y añade
    metadatos de documento fuente cuando están disponibles.
    """
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    node_ids: set[str] = set()
    chunk_texts: dict[str, str] = {}  # Mapa de chunk_id -> texto

    # Primera pasada: recolectar chunks (antes de filtrarlos)
    for line in qm_text.splitlines():
        line = line.strip()
        if not line:
            continue

        node_m = _NODE_RE.match(line)
        if node_m:
            node_id, entity_type, props_raw = node_m.groups()
            if entity_type == "Chunk":
                props = _parse_props(props_raw)
                if "text" in props:
                    chunk_texts[node_id] = props["text"]

    # Segunda pasada: procesar nodos y aristas
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
            
            # Extraer el ID del chunk si existe en extracted_from
            chunk_text = None
            edge_doc_info: dict[str, str] | None = None
            if "extracted_from" in props:
                extracted_str = props["extracted_from"].strip("[]'\"")
                # Puede ser algo como "Chunk_1_1" o "'Chunk_1_1'"
                chunk_id = extracted_str.split(",")[0].strip("'\"")
                if chunk_id in chunk_texts:
                    chunk_text = chunk_texts[chunk_id]
                if chunk_sources and chunk_id in chunk_sources:
                    edge_doc_info = chunk_sources[chunk_id]
            
            edge_data = {
                "id": f"{source}->{target}:{rel_type}",
                "source": source,
                "target": target,
                "label": rel_type,
                **props,
            }
            
            if chunk_text:
                edge_data["chunk_text"] = chunk_text
            if edge_doc_info is not None:
                edge_data["source_document_id"] = edge_doc_info["document_id"]
                edge_data["source_document_name"] = edge_doc_info["document_name"]
            
            edges.append({"data": edge_data})
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

    # Propagar metadatos del documento fuente también a nodos relacionados
    node_document_map: dict[str, dict[str, str]] = {}
    for edge in valid_edges:
        edge_data = edge["data"]
        doc_id = edge_data.get("source_document_id")
        doc_name = edge_data.get("source_document_name")
        if doc_id and doc_name:
            for node_id in (edge_data["source"], edge_data["target"]):
                if node_id not in node_document_map:
                    node_document_map[node_id] = {
                        "source_document_id": doc_id,
                        "source_document_name": doc_name,
                    }

    for node in nodes:
        node_id = node["data"]["id"]
        if node_id in node_document_map:
            node["data"].update(node_document_map[node_id])

    return {"elements": {"nodes": nodes, "edges": valid_edges}}


def extract_entity_facets(qm_text: str) -> dict:
    """Extrae instancias de entidades del .qm para el dropdown de filtros avanzados.

    Devuelve un dict con:
    - ``tipos``: lista ordenada de tipos de entidad presentes en la colección.
    - ``entidades``: lista de instancias ordenadas por tipo y label.

    Excluye Document y Chunk (entidades internas del pipeline).
    """
    entities: list[dict] = []
    seen_ids: set[str] = set()

    for line in qm_text.splitlines():
        line = line.strip()
        if not line:
            continue
        node_m = _NODE_RE.match(line)
        if not node_m:
            continue
        node_id, entity_type, props_raw = node_m.groups()
        if entity_type in _SYSTEM_NODE_TYPES or node_id in seen_ids:
            continue
        seen_ids.add(node_id)
        props = _parse_props(props_raw)
        label = _first_meaningful_value(props, node_id)
        entities.append({"id": node_id, "label": label, "tipo": entity_type})

    entities.sort(key=lambda e: (e["tipo"], e["label"].lower()))
    tipos = sorted({e["tipo"] for e in entities})
    return {"tipos": tipos, "entidades": entities}
