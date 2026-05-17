"""Tests del export .qm → Supabase Storage."""

from unittest.mock import patch

from app.services import qm_storage
from app.services.supabase_client import collection_qm_storage_path


def test_collection_qm_storage_path_reemplaza_pipe_en_sub():
    p = collection_qm_storage_path(
        "google-oauth2|104582526903974964439",
        "c0a47535-dfdd-4c23-b4d5-472dcde48058",
    )
    assert "|" not in p
    assert p.startswith("google-oauth2_104582526903974964439/")
    assert p.endswith("/c0a47535-dfdd-4c23-b4d5-472dcde48058.qm")


def test_find_qm_in_exports_prefiere_mdb_knowledge_graph(tmp_path):
    exports = tmp_path / "exports" / "mdb"
    exports.mkdir(parents=True)
    (exports / "knowledge_graph.qm").write_bytes(b"OFFICIAL")
    (exports / "a.qm").write_bytes(b"OTHER")

    found = qm_storage.find_qm_in_exports(tmp_path)
    assert found is not None
    assert found.name == "knowledge_graph.qm"
    assert found.read_bytes() == b"OFFICIAL"


def test_find_qm_in_exports_sin_preferido_usa_rglob_ordenado(tmp_path):
    exports = tmp_path / "exports" / "mdb"
    exports.mkdir(parents=True)
    (exports / "a.qm").write_bytes(b"QM1")
    (exports / "b.qm").write_bytes(b"QM2")

    found = qm_storage.find_qm_in_exports(tmp_path)
    assert found is not None
    assert found.name == "a.qm"


def test_find_qm_sin_exports_devuelve_none(tmp_path):
    assert qm_storage.find_qm_in_exports(tmp_path) is None


@patch("app.services.qm_storage.supabase_client.get_collection_by_id")
@patch("app.services.qm_storage.supabase_client.update_collection_qm_storage_path")
@patch("app.services.qm_storage.supabase_client.upload_collection_qm")
def test_export_qm_to_supabase_sube_y_actualiza(
    mock_upload, mock_update, mock_get_coll, tmp_path
):
    mock_get_coll.return_value = {
        "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "user_id": "auth0|u1",
    }
    exports = tmp_path / "exports"
    exports.mkdir()
    (exports / "g.qm").write_bytes(b"%QM%")
    mock_upload.return_value = (
        "auth0_u1/cccccccc-cccc-cccc-cccc-cccccccccccc/"
        "cccccccc-cccc-cccc-cccc-cccccccccccc.qm"
    )

    out = qm_storage.export_qm_to_supabase(
        tmp_path, "cccccccc-cccc-cccc-cccc-cccccccccccc"
    )

    expected_path = (
        "auth0_u1/cccccccc-cccc-cccc-cccc-cccccccccccc/"
        "cccccccc-cccc-cccc-cccc-cccccccccccc.qm"
    )
    assert out == expected_path
    mock_upload.assert_called_once()
    assert mock_upload.call_args[0][0] == "auth0|u1"
    assert mock_upload.call_args[0][1] == "cccccccc-cccc-cccc-cccc-cccccccccccc"
    assert mock_upload.call_args[0][2] == b"%QM%"
    mock_update.assert_called_once_with(
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
        expected_path,
    )


@patch("app.services.qm_storage.supabase_client.get_collection_by_id")
@patch("app.services.qm_storage.supabase_client.upload_collection_qm")
def test_export_sin_coleccion_no_llama_upload(mock_upload, mock_get_coll, tmp_path):
    mock_get_coll.return_value = None
    exports = tmp_path / "exports"
    exports.mkdir()
    (exports / "x.qm").write_bytes(b"x")
    assert qm_storage.export_qm_to_supabase(tmp_path, "missing-id") is None
    mock_upload.assert_not_called()


@patch("app.services.qm_storage.supabase_client.get_collection_by_id")
@patch("app.services.qm_storage.supabase_client.upload_collection_qm")
def test_export_sin_qm_no_llama_upload(mock_upload, mock_get_coll, tmp_path):
    mock_get_coll.return_value = {"id": "c", "user_id": "u"}
    assert qm_storage.export_qm_to_supabase(tmp_path, "c") is None
    mock_upload.assert_not_called()
