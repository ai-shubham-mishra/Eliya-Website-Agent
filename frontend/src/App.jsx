import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Copy, Check, RotateCcw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function App() {
  const [sessionId, setSessionId] = useState(() => {
    return localStorage.getItem('eliya_session_id') || generateUUID();
  });
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'system',
      content:
        '👋 Welcome to the Eliya Agent interface. Send a message to start a conversation. Your session affinity is tracked via the `X-Session-Id` header.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentStatus, setAgentStatus] = useState({ online: false, text: 'Checking connection...' });
  const [copied, setCopied] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('eliya_session_id', sessionId);
  }, [sessionId]);

  useEffect(() => {
    checkHealth();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function checkHealth() {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        setAgentStatus({ online: true, text: `Online (${data.agent_name || 'Agent'})` });
      } else {
        setAgentStatus({ online: false, text: `Degraded (HTTP ${res.status})` });
      }
    } catch {
      setAgentStatus({ online: false, text: 'Offline (API unreachable)' });
    }
  }

  async function handleNewSession() {
    if (confirm('Start a new session? Current conversation context will be reset.')) {
      if (sessionId) {
        try {
          await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, { method: 'DELETE' });
        } catch (e) {
          console.warn('Could not reset session on backend:', e);
        }
      }
      const newId = generateUUID();
      setSessionId(newId);
      setMessages([
        {
          id: generateUUID(),
          role: 'system',
          content: `✨ New session started (${newId.slice(0, 8)}...). Send a message to begin.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }

  function handleCopySession() {
    if (sessionId) {
      navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const prompt = inputMessage.trim();
    if (!prompt || isStreaming) return;

    const userMessageId = generateUUID();
    const assistantMessageId = generateUUID();
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Append user message
    const newMessages = [
      ...messages,
      { id: userMessageId, role: 'user', content: prompt, time: timeNow },
    ];
    setMessages(newMessages);
    setInputMessage('');
    setIsStreaming(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          message: prompt,
          session_id: sessionId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: `Error: ${errData.detail || response.statusText || 'Request failed'}`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        setIsStreaming(false);
        return;
      }

      // Check session ID from response header
      const returnedSessionId = response.headers.get('X-Session-Id');
      if (returnedSessionId && returnedSessionId !== sessionId) {
        setSessionId(returnedSessionId);
      }

      // Add placeholder assistant message
      setMessages((prev) => [
        ...prev,
        { id: assistantMessageId, role: 'assistant', content: '', time: timeNow, streaming: true },
      ]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop(); // keep last incomplete chunk

        for (const block of blocks) {
          if (!block.trim()) continue;
          const eventMatch = block.match(/^event:\s*(.+)$/m);
          const dataMatch = block.match(/^data:\s*(.+)$/m);

          const eventType = eventMatch ? eventMatch[1].trim() : 'message';
          const dataStr = dataMatch ? dataMatch[1].trim() : '';

          if (eventType === 'session' && dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.session_id) {
                setSessionId(parsed.session_id);
              }
            } catch (err) {
              console.error('Session parse error:', err);
            }
          } else if (eventType === 'token' && dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.delta || '';
              if (delta) {
                accumulatedText += delta;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: accumulatedText, streaming: true }
                      : msg
                  )
                );
              }
            } catch (err) {
              console.error('Token parse error:', err);
            }
          } else if (eventType === 'done') {
            break;
          }
        }
      }

      // Mark streaming complete
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, streaming: false } : msg
        )
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: `Network error: Could not reach API at ${API_BASE_URL}. Ensure the service is online.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <div className="header-info">
          <div className="agent-avatar">AI</div>
          <div>
            <h1>Eliya Website Agent</h1>
            <span className={`status-badge ${agentStatus.online ? 'online' : 'offline'}`}>
              <span className="status-dot"></span>
              <span>{agentStatus.text}</span>
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            onClick={handleNewSession}
            className="btn btn-secondary"
            title="Start a fresh session"
            disabled={isStreaming}
          >
            <RotateCcw size={15} />
            <span>New Session</span>
          </button>
        </div>
      </header>

      {/* Session Affinity Bar */}
      <div className="session-bar">
        <div className="session-id-display">
          <span className="label">Session ID (X-Session-Id):</span>
          <code>{sessionId}</code>
        </div>
        <button
          onClick={handleCopySession}
          className="btn-icon"
          title="Copy Session ID"
        >
          {copied ? <Check size={16} color="#107c41" /> : <Copy size={16} />}
        </button>
      </div>

      {/* Messages Viewport */}
      <main className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className={`message-bubble ${msg.streaming ? 'token-fade' : ''}`}>
              {msg.role === 'assistant' ? (
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                  {msg.streaming && <span className="streaming-cursor" />}
                </div>
              ) : msg.role === 'system' ? (
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
            {msg.role !== 'system' && <div className="message-time">{msg.time}</div>}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Bar */}
      <footer className="chat-input-wrapper">
        <form onSubmit={handleSubmit} className="chat-form">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask Eliya website agent anything..."
            disabled={isStreaming}
            autoFocus
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isStreaming || !inputMessage.trim()}
          >
            <span>Send</span>
            <Send size={16} />
          </button>
        </form>
      </footer>
    </div>
  );
}
