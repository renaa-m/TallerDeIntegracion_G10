from app.services.graph_transformer import qm_to_cytoscape

# ── Fixture: fragmento real del .qm generado por Wukong ────────────────────────

QM_SAMPLE = """
Persona_1 :Persona nombre:"Augusto Pinochet"
Persona_2 :Persona nombre:"Juan Pérez"
RangoMilitar_1 :RangoMilitar nombre:"General" rama:"NULL"
CentroDetencion_1 :CentroDetencion nombre:"Villa Grimaldi" ciudad:"NULL"
Evento_1 :Evento nombre:"Detención de Juan Pérez en Villa Grimaldi" fecha:"T19741015"
Document_1 :Document name:"8d53af50-7496-40f8-a069-8101e36e248d" document_set:"preview"
Chunk_1_1 :Chunk text:"El General Augusto Pinochet ordenó la detención de Juan Pérez en Villa Grimaldi el 15 de octubre de 1974."
Persona_1->RangoMilitar_1 :TuvoRango extracted_from:"['Chunk_1_1']"
Persona_2->CentroDetencion_1 :DetenidoEn extracted_from:"['Chunk_1_1']"
Chunk_1_1->Document_1 :ChunkOf chunk_number:1
Persona_1->Chunk_1_1 :ExtractedFrom
Persona_2->Chunk_1_1 :ExtractedFrom
RangoMilitar_1->Chunk_1_1 :ExtractedFrom
CentroDetencion_1->Chunk_1_1 :ExtractedFrom
Evento_1->Chunk_1_1 :ExtractedFrom
"""


# ── Estructura del resultado ───────────────────────────────────────────────────


class TestEstructuraCytoscape:
    def test_retorna_dict_con_elements(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        assert "elements" in result

    def test_elements_tiene_nodes_y_edges(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        assert "nodes" in result["elements"]
        assert "edges" in result["elements"]

    def test_cada_nodo_tiene_data(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        for node in result["elements"]["nodes"]:
            assert "data" in node

    def test_cada_arista_tiene_data(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        for edge in result["elements"]["edges"]:
            assert "data" in edge


# ── Nodos de dominio ───────────────────────────────────────────────────────────


class TestNodos:
    def test_cantidad_nodos_dominio(self):
        # Persona_1, Persona_2, RangoMilitar_1, CentroDetencion_1, Evento_1 → 5
        result = qm_to_cytoscape(QM_SAMPLE)
        assert len(result["elements"]["nodes"]) == 5

    def test_nodo_tiene_id_label_type(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        nodo = next(n for n in result["elements"]["nodes"] if n["data"]["id"] == "Persona_1")
        assert nodo["data"]["label"] == "Augusto Pinochet"
        assert nodo["data"]["type"] == "Persona"

    def test_label_usa_primer_valor_no_null(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        rango = next(n for n in result["elements"]["nodes"] if n["data"]["id"] == "RangoMilitar_1")
        # rama:"NULL" no debe ser el label; nombre:"General" sí
        assert rango["data"]["label"] == "General"

    def test_propiedades_incluidas_en_data(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        nodo = next(n for n in result["elements"]["nodes"] if n["data"]["id"] == "Persona_2")
        assert nodo["data"]["nombre"] == "Juan Pérez"


# ── Filtrado de entidades de sistema ──────────────────────────────────────────


class TestFiltradoSistema:
    def test_document_no_aparece_como_nodo(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        ids = {n["data"]["id"] for n in result["elements"]["nodes"]}
        assert "Document_1" not in ids

    def test_chunk_no_aparece_como_nodo(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        ids = {n["data"]["id"] for n in result["elements"]["nodes"]}
        assert "Chunk_1_1" not in ids

    def test_chunkof_no_aparece_como_arista(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        labels = {e["data"]["label"] for e in result["elements"]["edges"]}
        assert "ChunkOf" not in labels

    def test_extractedfrom_no_aparece_como_arista(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        labels = {e["data"]["label"] for e in result["elements"]["edges"]}
        assert "ExtractedFrom" not in labels

    def test_aristas_sin_nodo_filtrado_no_aparecen(self):
        # Todas las aristas ExtractedFrom iban hacia Chunk_1_1 (filtrado)
        result = qm_to_cytoscape(QM_SAMPLE)
        targets = {e["data"]["target"] for e in result["elements"]["edges"]}
        assert "Chunk_1_1" not in targets


# ── Aristas de dominio ────────────────────────────────────────────────────────


class TestAristas:
    def test_cantidad_aristas_dominio(self):
        # TuvoRango y DetenidoEn → 2
        result = qm_to_cytoscape(QM_SAMPLE)
        assert len(result["elements"]["edges"]) == 2

    def test_arista_tiene_source_target_label(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        arista = next(
            e for e in result["elements"]["edges"] if e["data"]["label"] == "TuvoRango"
        )
        assert arista["data"]["source"] == "Persona_1"
        assert arista["data"]["target"] == "RangoMilitar_1"

    def test_arista_id_formato_correcto(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        arista = next(
            e for e in result["elements"]["edges"] if e["data"]["label"] == "TuvoRango"
        )
        assert arista["data"]["id"] == "Persona_1->RangoMilitar_1:TuvoRango"

    def test_arista_incluye_propiedades(self):
        result = qm_to_cytoscape(QM_SAMPLE)
        arista = next(
            e for e in result["elements"]["edges"] if e["data"]["label"] == "DetenidoEn"
        )
        assert "extracted_from" in arista["data"]


# ── Casos borde ────────────────────────────────────────────────────────────────


class TestCasosBorde:
    def test_texto_vacio_retorna_listas_vacias(self):
        result = qm_to_cytoscape("")
        assert result["elements"]["nodes"] == []
        assert result["elements"]["edges"] == []

    def test_solo_lineas_en_blanco(self):
        result = qm_to_cytoscape("\n\n\n")
        assert result["elements"]["nodes"] == []
        assert result["elements"]["edges"] == []

    def test_propiedad_sin_comillas(self):
        # chunk_number:1 no lleva comillas en el .qm real
        qm = "Nodo_1 :TipoA val:42\nNodo_2 :TipoB val:hello\nNodo_1->Nodo_2 :Rel prop:unquoted"
        result = qm_to_cytoscape(qm)
        assert result["elements"]["nodes"][0]["data"]["val"] == "42"
        assert result["elements"]["edges"][0]["data"]["prop"] == "unquoted"

    def test_solo_entidades_sistema_retorna_vacio(self):
        qm = (
            'Document_1 :Document name:"doc"\n'
            'Chunk_1_1 :Chunk text:"texto"\n'
            "Chunk_1_1->Document_1 :ChunkOf chunk_number:1\n"
        )
        result = qm_to_cytoscape(qm)
        assert result["elements"]["nodes"] == []
        assert result["elements"]["edges"] == []
