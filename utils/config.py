import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    AZURE_AI_PROJECT_ENDPOINT: str = os.getenv(
        "AZURE_AI_PROJECT_ENDPOINT",
        "https://as-eliya-aiservices-stg.services.ai.azure.com/api/projects/as-eliya-aiservices-stg-project",
    )
    AZURE_TENANT_ID: str | None = os.getenv("AZURE_TENANT_ID", None)
    AZURE_CLIENT_ID: str | None = os.getenv("AZURE_CLIENT_ID", None)
    AZURE_CLIENT_SECRET: str | None = os.getenv("AZURE_CLIENT_SECRET", None)
    
    AGENT_NAME: str = os.getenv("AGENT_NAME", "as-eliya-website-agent-stg")
    AGENT_VERSION: str = os.getenv("AGENT_VERSION", "2")
    
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    SESSION_HEADER_NAME: str = "X-Session-Id"
    SESSION_COOKIE_NAME: str = "affinity_session_id"

settings = Settings()
