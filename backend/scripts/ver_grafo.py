"""
Script standalone para visualizar el grafo generado por Wukong.

Lee los exports JSON de una carpeta de trabajo de Wukong (la que genera
probar_grafo.py), arma un grafo con pyvis y lo abre en el browser como HTML
interactivo.

Sirve solo para inspección visual. NO usa MillenniumDB.

Uso:
    cd backend
    source .venv/bin/activate
    python scripts/ver_grafo.py /tmp/wukong-debug-<timestamp>
"""

import argparse
import json
import sys
from pathlib import Path

from pyvis.network import Network

# Solo entidades de dominio: omitimos Chunk y Document (ruido visual).
DOMAIN_ENTITIES = {"Persona", "Organizacion", "Lugar", "Evento"}

# Colores por tipo de entidad.
ENTITY_COLORS = {
    "Persona": "#4FC3F7",
    "Organizacion": "#FFB74D",
    "Lugar": "#81C784",
    "Evento": "#BA68C8",
}

# Solo relaciones de dominio: omitimos ChunkOf y ExtractedFrom (estructura interna).
DOMAIN_RELATIONS = {"TrabajaEn", "DuenoDe", "UbicadoEn", "Participo", "Menciona"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Visualiza el grafo de Wukong.")
    parser.add_argument("workdir", help="Carpeta de trabajo de Wukong (con exports/json/)")
    parser.add_argument("--output", default="grafo.html", help="HTML de salida")
    args = parser.parse_args()

    workdir = Path(args.workdir).expanduser().resolve()
    json_dir = workdir / "exports" / "json"
    if not json_dir.is_dir():
        print(f"❌ No existe {json_dir}", file=sys.stderr)
        return 1

    net = Network(
        height="800px",
        width="100%",
        bgcolor="#1e1e1e",
        font_color="white",
        directed=True,
        notebook=False,
    )

    nodes_added: set[str] = set()
    entity_label_by_id: dict[str, str] = {}

    for entity_type in DOMAIN_ENTITIES:
        entity_file = json_dir / "entities" / f"{entity_type}.json"
        if not entity_file.is_file():
            continue
        with entity_file.open(encoding="utf-8") as f:
            entities = json.load(f)
        color = ENTITY_COLORS.get(entity_type, "#9E9E9E")
        for ent in entities:
            obj_id = ent["_ObjectId"]
            label = ent.get("nombre", obj_id).strip('"')
            title = f"<b>{entity_type}</b><br>{label}"
            for k, v in ent.items():
                if k.startswith("_") or k == "nombre":
                    continue
                title += f"<br>{k}: {str(v).strip(chr(34))}"
            net.add_node(obj_id, label=label, title=title, color=color, size=20)
            nodes_added.add(obj_id)
            entity_label_by_id[obj_id] = label

    edges_added = 0
    for rel_type in DOMAIN_RELATIONS:
        rel_file = json_dir / "relations" / f"{rel_type}.json"
        if not rel_file.is_file():
            continue
        with rel_file.open(encoding="utf-8") as f:
            relations = json.load(f)
        for rel in relations:
            origin = rel["_OriginId"]
            target = rel["_TargetId"]
            if origin not in nodes_added or target not in nodes_added:
                continue
            net.add_edge(origin, target, label=rel_type, title=rel_type, arrows="to")
            edges_added += 1

    output_path = Path(args.output).expanduser().resolve()
    net.write_html(str(output_path), notebook=False, open_browser=False)

    print(f"✅ Grafo generado:")
    print(f"   Nodos: {len(nodes_added)}")
    print(f"   Aristas: {edges_added}")
    print(f"   HTML:  {output_path}")
    print(f"\nAbrilo con: open {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
