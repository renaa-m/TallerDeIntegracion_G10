"""Tests del export .qm → Supabase Storage."""

from unittest.mock import patch

from app.services import qm_storage


def test_find_qm_in_exports_devuelve_primero(tmp_path):
    exports = tmp_path / "exports" / "mdb"
    exports.mkdir(parents=True)
    (exports / "a.qm").write_bytes(b"QM1")
    (exports / "b.qm").write_bytes(b"QM2")

    found = qm_storage.find_qm_in_exports(tmp_path)
    assert found is not None
    assert found.name == "a.qm"


def test_find_qm_sin_exports_devuelve_none(tmp_path):
    assert qm_storage.find_qm_in_exports(tmp_path) is None


@patch("app.services.qm_storage.supabase_client.update_collection_qm_storage_path")
@patch("app.services.qm_storage.supabase_client.upload_collection_qm")
def test_export_qm_to_supabase_sube_y_actualiza(mock_upload, mock_update, tmp_path):
    exports = tmp_path / "exports"
    exports.mkdir()
    (exports / "g.qm").write_bytes(b"%QM%")
    mock_upload.return_value = "user/cole/knowledge_graph.qm"

    out = qm_storage.export_qm_to_supabase(
        tmp_path, "auth0|u1", "cccccccc-cccc-cccc-cccc-cccccccccccc"
    )

    assert out == "user/cole/knowledge_graph.qm"
    mock_upload.assert_called_once()
    assert mock_upload.call_args[0][2] == b"%QM%"
    mock_update.assert_called_once_with(
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "user/cole/knowledge_graph.qm",
    )


@patch("app.services.qm_storage.supabase_client.upload_collection_qm")
def test_export_sin_qm_no_llama_upload(mock_upload, tmp_path):
    assert qm_storage.export_qm_to_supabase(tmp_path, "u", "c") is None
    mock_upload.assert_not_called()
