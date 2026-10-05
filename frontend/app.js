// frontend/app.js

// The frontend is a standalone static demo client, decoupled from the API.
// Point this at wherever main.py's FastAPI server is running.
const API_BASE_URL = "http://localhost:8000";

let currentSessionId = localStorage.getItem("eliya_session_id") || "";

// DOM Elements
const messagesList = document.getElementById("messagesList");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const sessionIdDisplay = document.getElementById("sessionIdDisplay");
const copySessionBtn = document.getElementById("copySessionBtn");
const newSessionBtn = document.getElementById("newSessionBtn");
const agentStatus = document.getElementById("agentStatus");
const statusText = document.getElementById("statusText");

// Initialize Session ID
function initSession() {
  // Configure marked for line breaks & link sanitization
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }

  if (!currentSessionId) {
    currentSessionId = generateUUID();
    localStorage.setItem("eliya_session_id", currentSessionId);
  }
  updateSessionDisplay();
  checkHealth();
}

function renderMarkdown(rawText) {
  if (window.marked && window.DOMPurify) {
    const parsed = marked.parse(rawText);
    return DOMPurify.sanitize(parsed);
  }
  // Fallback to basic text escaping
  const div = document.createElement("div");
  div.textContent = rawText;
  return div.innerHTML;
}

function generateUUID() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function updateSessionDisplay() {
  sessionIdDisplay.textContent = currentSessionId || "None";
}

// Health check
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (res.ok) {
      const data = await res.json();
      agentStatus.className = "status-badge online";
      statusText.textContent = `Online (${data.agent_name})`;
    } else {
      agentStatus.className = "status-badge offline";
      statusText.textContent = `Degraded (HTTP ${res.status})`;
    }
  } catch (err) {
    agentStatus.className = "status-badge offline";
    statusText.textContent = "Offline (Localhost unavailable)";
  }
}

// Append message bubble to UI
function appendMessage(role, text) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;

  const bubbleDiv = document.createElement("div");
  bubbleDiv.className = "message-bubble";
  if (role === "assistant") {
    bubbleDiv.innerHTML = renderMarkdown(text);
  } else {
    bubbleDiv.textContent = text;
  }

  const timeDiv = document.createElement("div");
  timeDiv.className = "message-time";
  timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgDiv.appendChild(bubbleDiv);
  msgDiv.appendChild(timeDiv);

  messagesList.appendChild(msgDiv);
  messagesList.scrollTop = messagesList.scrollHeight;
  return bubbleDiv;
}

// Create an assistant message bubble specifically for live streaming
function createStreamingMessageBubble() {
  const msgDiv = document.createElement("div");
  msgDiv.className = "message assistant";

  const bubbleDiv = document.createElement("div");
  bubbleDiv.className = "message-bubble";

  const timeDiv = document.createElement("div");
  timeDiv.className = "message-time";
  timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgDiv.appendChild(bubbleDiv);
  msgDiv.appendChild(timeDiv);

  messagesList.appendChild(msgDiv);
  messagesList.scrollTop = messagesList.scrollHeight;

  return bubbleDiv;
}

// Typing Indicator
let typingElement = null;
function showTypingIndicator() {
  if (typingElement) return;
  typingElement = document.createElement("div");
  typingElement.className = "message assistant typing";
  typingElement.innerHTML = `
    <div class="message-bubble typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;
  messagesList.appendChild(typingElement);
  messagesList.scrollTop = messagesList.scrollHeight;
}

function hideTypingIndicator() {
  if (typingElement) {
    typingElement.remove();
    typingElement = null;
  }
}

// Send Message handler with Bit-by-Bit Streaming & Subtle Fade Typing Animation
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  // Render user message
  appendMessage("user", text);
  messageInput.value = "";
  messageInput.disabled = true;
  sendBtn.disabled = true;
  showTypingIndicator();

  let accumulatedText = "";
  let streamBubble = null;
  let cursorSpan = null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": currentSessionId, // Key session affinity header
      },
      body: JSON.stringify({
        message: text,
        session_id: currentSessionId,
      }),
    });

    if (!response.ok) {
      hideTypingIndicator();
      const errData = await response.json().catch(() => ({}));
      appendMessage("assistant", `Error: ${errData.detail || response.statusText || "Request failed"}`);
      return;
    }

    // Capture Session ID from response header
    const returnedSessionId = response.headers.get("X-Session-Id");
    if (returnedSessionId) {
      currentSessionId = returnedSessionId;
      localStorage.setItem("eliya_session_id", currentSessionId);
      updateSessionDisplay();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      // Keep trailing incomplete fragment in buffer
      buffer = lines.pop();

      for (const block of lines) {
        if (!block.trim()) continue;
        const eventMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*(.+)$/m);

        const eventType = eventMatch ? eventMatch[1].trim() : "message";
        const dataStr = dataMatch ? dataMatch[1].trim() : "";

        if (eventType === "session" && dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.session_id) {
              currentSessionId = parsed.session_id;
              localStorage.setItem("eliya_session_id", currentSessionId);
              updateSessionDisplay();
            }
          } catch (err) {
            console.error("Session parse error:", err);
          }
        } else if (eventType === "token" && dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.delta || "";
            if (delta) {
              // Hide typing indicator upon first token
              hideTypingIndicator();

              if (!streamBubble) {
                streamBubble = createStreamingMessageBubble();
                cursorSpan = document.createElement("span");
                cursorSpan.className = "streaming-cursor";
              }

              accumulatedText += delta;

              // Render Markdown HTML
              const renderedHtml = renderMarkdown(accumulatedText);
              streamBubble.innerHTML = renderedHtml;

              // Add subtle fade token animation wrapper & blinking cursor
              streamBubble.classList.add("token-fade");
              streamBubble.appendChild(cursorSpan);

              messagesList.scrollTop = messagesList.scrollHeight;
            }
          } catch (err) {
            console.error("Token parse error:", err);
          }
        } else if (eventType === "done") {
          break;
        }
      }
    }

    // Remove streaming cursor upon completion
    if (cursorSpan) {
      cursorSpan.remove();
    }
  } catch (err) {
    hideTypingIndicator();
    if (cursorSpan) cursorSpan.remove();
    appendMessage("assistant", `Network error: Could not reach ${API_BASE_URL}. Ensure the API server is running.`);
  } finally {
    hideTypingIndicator();
    if (cursorSpan) cursorSpan.remove();
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
});

// Start a fresh session
newSessionBtn.addEventListener("click", async () => {
  if (confirm("Start a new session? Current conversation context will be reset.")) {
    if (currentSessionId) {
      try {
        await fetch(`${API_BASE_URL}/api/sessions/${currentSessionId}`, {
          method: "DELETE",
        });
      } catch (e) {
        console.warn("Could not delete session on backend:", e);
      }
    }

    currentSessionId = generateUUID();
    localStorage.setItem("eliya_session_id", currentSessionId);
    updateSessionDisplay();

    // Clear messages
    messagesList.innerHTML = `
      <div class="message system-message">
        <div class="message-bubble">
          ✨ New session started (${currentSessionId.substring(0, 8)}...). Send a message to begin.
        </div>
      </div>
    `;
  }
});

// Copy Session ID
copySessionBtn.addEventListener("click", () => {
  if (currentSessionId) {
    navigator.clipboard.writeText(currentSessionId).then(() => {
      copySessionBtn.textContent = "✅";
      setTimeout(() => {
        copySessionBtn.textContent = "📋";
      }, 1500);
    });
  }
});

// Initial boot
initSession();
