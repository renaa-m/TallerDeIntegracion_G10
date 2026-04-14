from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "IMFD Document Explorer"
    debug: bool = False

    supabase_url: str = ""
    supabase_key: str = ""

    auth0_domain: str = ""
    auth0_api_audience: str = ""
    auth0_algorithms: str = "RS256"

    openai_api_key: str = ""

    millenniumdb_host: str = ""
    millenniumdb_port: int = 8080

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
