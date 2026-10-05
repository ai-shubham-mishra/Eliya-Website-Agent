from typing import List, Optional
from pydantic import BaseModel, Field

class ChatMessage(BaseModel):
    role: str = Field(..., description="Role of the speaker (user, assistant, system)")
    content: str = Field(..., description="Content of the message")

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User prompt to send to the agent")
    session_id: Optional[str] = Field(None, description="Optional session id if not provided via X-Session-Id header")

class ChatResponse(BaseModel):
    session_id: str = Field(..., description="Session ID mapped to the client")
    response: str = Field(..., description="Agent response output")
    history_length: int = Field(..., description="Number of messages in current session")

class SessionHistoryResponse(BaseModel):
    session_id: str
    messages: List[ChatMessage]

class HealthResponse(BaseModel):
    status: str
    agent_name: str
    agent_version: str
    endpoint: str
