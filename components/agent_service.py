import logging
from typing import Dict, List
from components.session_manager import session_manager
from utils.azure_client import azure_agent_client

logger = logging.getLogger("agent_api.service")

class AgentService:
    def __init__(self):
        self.session_manager = session_manager
        self.azure_client = azure_agent_client

    def process_message(self, session_id: str, user_message: str) -> Dict[str, any]:
        # 1. Record user message in session
        self.session_manager.add_message(session_id=session_id, role="user", content=user_message)
        
        # 2. Retrieve entire conversation history for context continuity
        conversation_history = self.session_manager.get_messages(session_id)
        
        # 3. Call Azure agent reference
        try:
            agent_reply = self.azure_client.ask_agent(messages=conversation_history)
        except Exception as e:
            logger.error(f"Error calling Azure agent: {e}", exc_info=True)
            # Retain a meaningful error message for user
            agent_reply = f"[Agent Service Error] {str(e)}"
        
        # 4. Record assistant reply
        self.session_manager.add_message(session_id=session_id, role="assistant", content=agent_reply)
        
        updated_history = self.session_manager.get_messages(session_id)
        return {
            "session_id": session_id,
            "response": agent_reply,
            "history_length": len(updated_history),
        }

    def stream_message(self, session_id: str, user_message: str):
        """
        Streams agent response tokens bit by bit.
        Yields chunk strings and saves full response to session history when done.
        """
        # 1. Record user message
        self.session_manager.add_message(session_id=session_id, role="user", content=user_message)
        conversation_history = self.session_manager.get_messages(session_id)

        full_reply_parts = []
        try:
            for token in self.azure_client.stream_agent(messages=conversation_history):
                full_reply_parts.append(token)
                yield token
        except Exception as e:
            logger.error(f"Error streaming Azure agent tokens: {e}", exc_info=True)
            err_msg = f"\n\n[Agent Stream Error: {str(e)}]"
            full_reply_parts.append(err_msg)
            yield err_msg
        finally:
            full_reply = "".join(full_reply_parts)
            if full_reply:
                self.session_manager.add_message(session_id=session_id, role="assistant", content=full_reply)

    def get_history(self, session_id: str) -> List[Dict[str, str]]:
        return self.session_manager.get_messages(session_id)

    def reset_session(self, session_id: str) -> bool:
        return self.session_manager.clear_session(session_id)

agent_service = AgentService()
