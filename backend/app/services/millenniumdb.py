import millenniumdb_driver

from app.config import settings


def get_driver():
    url = f"ws://{settings.millenniumdb_host}:{settings.millenniumdb_port}"
    return millenniumdb_driver.driver(url)


def query_graph(query: str, params: dict | None = None) -> list[dict]:
    """Ejecuta una query contra MillenniumDB y retorna los resultados como lista de dicts."""
    driver = get_driver()
    try:
        session = driver.session()
        result = session.run(query, params or {})
        return result.data()
    finally:
        driver.close()
