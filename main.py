import json
import logging
from typing import Optional, List
from fastapi import FastAPI, Header, Response, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from utils.config import settings
from components.models import (
    ChatRequest,
    ChatResponse,
    SessionHistoryResponse,
    HealthResponse,
    ChatMessage,
)
from components.agent_service import agent_service
from components.session_manager import session_manager
from utils.azure_client import azure_agent_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("agent_api")

app = FastAPI(
    title="Eliya Website Agent API",
    description="Lightweight API for Azure AI Agent with Session Affinity and Managed Identity support",
    version="1.0.0",
)

# Enable CORS for local development and frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id", settings.SESSION_HEADER_NAME],
)

@app.get("/health", response_model=HealthResponse, tags=["System"])
def health_check():
    """Health check endpoint showing configuration and agent target."""
    return HealthResponse(
        status="healthy",
        agent_name=settings.AGENT_NAME,
        agent_version=azure_agent_client.get_effective_version(),
        endpoint=settings.AZURE_AI_PROJECT_ENDPOINT,
    )

@app.post("/api/chat", response_model=ChatResponse, tags=["Agent"])
def chat_with_agent(
    payload: ChatRequest,
    response: Response,
    x_session_id: Optional[str] = Header(None, alias="X-Session-Id"),
):
    """
    Send a message to the agent, maintaining session continuity.
    Uses 'X-Session-Id' header for sticky sessions and affinity.
    """
    # 1. Resolve session ID (priority: Header -> Body -> New generated ID)
    candidate_id = x_session_id or payload.session_id
    session_id = session_manager.get_or_create_session_id(candidate_id)

    # 2. Set response header & cookie for session affinity
    response.headers["X-Session-Id"] = session_id
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_id,
        httponly=False,
        samesite="lax",
    )

    # 3. Process conversation with agent
    result = agent_service.process_message(session_id=session_id, user_message=payload.message)

    return ChatResponse(
        session_id=result["session_id"],
        response=result["response"],
        history_length=result["history_length"],
    )

@app.post("/api/chat/stream", tags=["Agent"])
def chat_stream_with_agent(
    payload: ChatRequest,
    x_session_id: Optional[str] = Header(None, alias="X-Session-Id"),
):
    """
    Stream tokens bit-by-bit via Server-Sent Events (SSE).
    Uses 'X-Session-Id' header for sticky sessions and affinity.
    """
    candidate_id = x_session_id or payload.session_id
    session_id = session_manager.get_or_create_session_id(candidate_id)

    def event_generator():
        # First send session metadata
        yield f"event: session\ndata: {json.dumps({'session_id': session_id})}\n\n"
        
        # Stream tokens bit by bit
        for token in agent_service.stream_message(session_id=session_id, user_message=payload.message):
            yield f"event: token\ndata: {json.dumps({'delta': token})}\n\n"

        # Signal completion
        yield "event: done\ndata: {}\n\n"

    headers = {
        "X-Session-Id": session_id,
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream",
    }
    return StreamingResponse(event_generator(), headers=headers, media_type="text/event-stream")

@app.get("/api/sessions/{session_id}/history", response_model=SessionHistoryResponse, tags=["Sessions"])
def get_session_history(session_id: str):
    """Retrieve message history for a given session."""
    raw_history = agent_service.get_history(session_id)
    return SessionHistoryResponse(
        session_id=session_id,
        messages=[ChatMessage(**msg) for msg in raw_history],
    )

@app.delete("/api/sessions/{session_id}", tags=["Sessions"])
def reset_session(session_id: str):
    """Reset or clear conversation state for a specific session."""
    cleared = agent_service.reset_session(session_id)
    if not cleared:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found.",
        )
    return {"message": f"Session '{session_id}' has been reset."}

@app.get("/api/sessions", tags=["Sessions"])
def list_active_sessions():
    """List active session IDs."""
    return {"sessions": session_manager.list_sessions()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)
