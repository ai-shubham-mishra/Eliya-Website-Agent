import threading
import uuid
from typing import Dict, List

class SessionManager:
    """
    In-memory session manager with thread-safe locking.
    Maintains conversation history per session ID.
    Enables sticky session affinity by pinning interactions to a session ID.
    """
    def __init__(self):
        self._sessions: Dict[str, List[Dict[str, str]]] = {}
        self._lock = threading.Lock()

    def get_or_create_session_id(self, candidate_session_id: str | None = None) -> str:
        with self._lock:
            if candidate_session_id and candidate_session_id.strip():
                session_id = candidate_session_id.strip()
                if session_id not in self._sessions:
                    self._sessions[session_id] = []
                return session_id
            
            new_id = str(uuid.uuid4())
            self._sessions[new_id] = []
            return new_id

    def add_message(self, session_id: str, role: str, content: str) -> None:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = []
            self._sessions[session_id].append({"role": role, "content": content})

    def get_messages(self, session_id: str) -> List[Dict[str, str]]:
        with self._lock:
            return list(self._sessions.get(session_id, []))

    def clear_session(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id] = []
                return True
            return False

    def list_sessions(self) -> List[str]:
        with self._lock:
            return list(self._sessions.keys())

session_manager = SessionManager()
