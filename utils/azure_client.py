import logging
from typing import Any, Dict, List
from azure.core.credentials import AzureKeyCredential
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from utils.config import settings

logger = logging.getLogger("agent_api.azure")

class AzureAgentClient:
    def __init__(self):
        self._project_client: AIProjectClient | None = None
        self._openai_client = None
        self._latest_version: str | None = None
        self._init_client()

    def _init_client(self):
        try:
            if settings.AZURE_AI_API_KEY:
                # API key auth bypasses AAD/RBAC entirely (requires disableLocalAuth=false on the account).
                self._project_client = AIProjectClient(
                    endpoint=settings.AZURE_AI_PROJECT_ENDPOINT,
                    credential=AzureKeyCredential(settings.AZURE_AI_API_KEY),
                )
                logger.info("Successfully initialized Azure AI Project Client with API Key auth.")
            else:
                # If AZURE_CLIENT_SECRET is provided (e.g. Service Principal for local Docker/dev),
                # DefaultAzureCredential's EnvironmentCredential picks up AZURE_TENANT_ID,
                # AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET automatically.
                # If AZURE_CLIENT_SECRET is absent, managed_identity_client_id is used for User-Assigned Managed Identity.
                credential_kwargs = {}
                if settings.AZURE_CLIENT_ID and not settings.AZURE_CLIENT_SECRET:
                    credential_kwargs["managed_identity_client_id"] = settings.AZURE_CLIENT_ID

                credential = DefaultAzureCredential(**credential_kwargs)

                self._project_client = AIProjectClient(
                    endpoint=settings.AZURE_AI_PROJECT_ENDPOINT,
                    credential=credential,
                )
                logger.info("Successfully initialized Azure AI Project Client with Managed Identity / DefaultAzureCredential.")

            if settings.AZURE_AI_API_KEY:
                # get_openai_client() only auto-builds a bearer-token provider for TokenCredential;
                # a raw API key must be passed explicitly to be used as the Authorization value.
                self._openai_client = self._project_client.get_openai_client(api_key=settings.AZURE_AI_API_KEY)
            else:
                self._openai_client = self._project_client.get_openai_client()
            self._fetch_latest_version()
        except Exception as e:
            logger.warning(f"Could not initialize Azure AI Project Client: {e}. Will retry on request or return detailed error.")
            self._project_client = None
            self._openai_client = None

    def _fetch_latest_version(self) -> str | None:
        """Dynamically queries the newest published agent version from Azure AI Project."""
        try:
            if self._project_client:
                versions = list(self._project_client.agents.list_versions(settings.AGENT_NAME))
                if versions:
                    self._latest_version = str(versions[0].version)
                    logger.info(f"Discovered latest agent version: {self._latest_version}")
                    return self._latest_version
        except Exception as e:
            logger.debug(f"Could not query agent version list: {e}")
        return self._latest_version

    def get_effective_version(self) -> str:
        """Returns the version used in agent calls (resolved latest version or configured fallback)."""
        if settings.AGENT_VERSION and settings.AGENT_VERSION.lower() != "latest":
            return settings.AGENT_VERSION
        return self._latest_version or "latest"

    def _build_agent_reference(self) -> Dict[str, Any]:
        """Builds agent reference dictionary. Omitting version or setting specific version."""
        ref: Dict[str, Any] = {
            "name": settings.AGENT_NAME,
            "type": "agent_reference",
        }
        # If a specific numeric version is pinned, include it; otherwise omit so Azure resolves latest automatically
        if settings.AGENT_VERSION and settings.AGENT_VERSION.lower() != "latest":
            ref["version"] = settings.AGENT_VERSION
        return ref

    def ask_agent(self, messages: List[Dict[str, str]]) -> str:
        """
        Sends conversation input messages to Azure AI agent reference.
        """
        if self._openai_client is None:
            self._init_client()

        if self._openai_client is None:
            raise RuntimeError("Azure AI Project Client is not initialized. Please verify credentials/network.")

        response = self._openai_client.responses.create(
            input=messages,
            extra_body={"agent_reference": self._build_agent_reference()},
        )
        return getattr(response, "output_text", str(response))

    def stream_agent(self, messages: List[Dict[str, str]]):
        """
        Yields tokens bit-by-bit from Azure AI agent reference stream.
        """
        if self._openai_client is None:
            self._init_client()

        if self._openai_client is None:
            raise RuntimeError("Azure AI Project Client is not initialized. Please verify credentials/network.")

        stream = self._openai_client.responses.create(
            input=messages,
            extra_body={"agent_reference": self._build_agent_reference()},
            stream=True,
        )

        for event in stream:
            # Check for text deltas in the streaming events
            delta = getattr(event, "delta", None)
            if delta:
                yield str(delta)

azure_agent_client = AzureAgentClient()
