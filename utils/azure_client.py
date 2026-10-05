import logging
from typing import Any, Dict, List
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from utils.config import settings

logger = logging.getLogger("agent_api.azure")

class AzureAgentClient:
    def __init__(self):
        self._project_client: AIProjectClient | None = None
        self._openai_client = None
        self._init_client()

    def _init_client(self):
        try:
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
            self._openai_client = self._project_client.get_openai_client()
            logger.info("Successfully initialized Azure AI Project Client with Managed Identity / DefaultAzureCredential.")
        except Exception as e:
            logger.warning(f"Could not initialize Azure AI Project Client: {e}. Will retry on request or return detailed error.")
            self._project_client = None
            self._openai_client = None

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
            extra_body={
                "agent_reference": {
                    "name": settings.AGENT_NAME,
                    "version": settings.AGENT_VERSION,
                    "type": "agent_reference",
                }
            },
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
            extra_body={
                "agent_reference": {
                    "name": settings.AGENT_NAME,
                    "version": settings.AGENT_VERSION,
                    "type": "agent_reference",
                }
            },
            stream=True,
        )

        for event in stream:
            # Check for text deltas in the streaming events
            delta = getattr(event, "delta", None)
            if delta:
                yield str(delta)

azure_agent_client = AzureAgentClient()
