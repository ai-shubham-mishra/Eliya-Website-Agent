# Eliya Website Chat Agent

Lightweight conversational API for the Eliya Website Agent powered by **Azure AI Services**, with **Managed Identity**, **Sticky Session Affinity**, and real-time **SSE Token Streaming**.

Includes a standalone **React + Vite** demo chat interface ready for deployment on **Vercel**.

---

## Architecture Overview

```
                                      ┌──────────────────────────────────────────────────┐
                                      │              Azure Container Apps                │
┌─────────────────────────┐           │   (as-eliya-website-chat-agent-stg)              │
│    Frontend Clients     │  HTTPS    │                                                  │
│   (Vercel / Websites)   │──────────►│  Ingress (Sticky Sessions: X-Session-Id)         │
│                         │           │  FastAPI (Port 8000)                             │
└─────────────────────────┘           │     ├── System-Assigned Managed Identity         │
                                      │     │   (Zero static passwords/secrets)          │
                                      └─────┼────────────────────────────────────────────┘
                                            │ DefaultAzureCredential
                                            ▼
                              ┌──────────────────────────────────────────────────────────┐
                              │            Azure AI Services / Foundry Project           │
                              │  (as-eliya-aiservices-stg / as-eliya-website-agent-stg)   │
                              └──────────────────────────────────────────────────────────┘
```

- **Backend API (`main.py`)**: Stateless FastAPI service handling sessions, streaming tokens, and calling Azure AI Agent models.
- **Session Affinity**: Tracked via the `X-Session-Id` header (and companion cookie), maintaining conversation context across interactions.
- **Authentication**:
  - **Azure Production**: Uses **System-Assigned Managed Identity** (`DefaultAzureCredential`) with zero secrets stored in container environments.
  - **Local Development**: Automatically uses host `az login` or development Service Principal credentials.
- **Frontend (`frontend/`)**: Standalone Vite + React application with Markdown rendering (`react-markdown`), token fade animation, and Vercel configuration.

---

## Project Structure

```
Eliya-Website-Agent/
├── .github/
│   └── workflows/
│       └── deploy-stg.yml        # CI/CD workflow deploying to Azure Container Apps
├── components/
│   ├── agent_service.py          # Orchestrates agent calls & conversation history
│   ├── models.py                 # Pydantic request/response schemas
│   └── session_manager.py        # Thread-safe in-memory session manager
├── utils/
│   ├── azure_client.py           # Azure AI Project Client with DefaultAzureCredential
│   └── config.py                 # Application settings & environment configuration
├── frontend/                     # Standalone React + Vite project (Deployable on Vercel)
│   ├── src/
│   │   ├── App.jsx               # Chat interface with streaming & markdown
│   │   ├── index.css             # Styles & token fade animations
│   │   └── main.jsx              # React root entry
│   ├── index.html                # Vite HTML template
│   ├── package.json              # React dependencies
│   ├── vite.config.js            # Vite configuration
│   └── vercel.json               # Vercel SPA routing config
├── Dockerfile                    # Container definition for FastAPI backend
├── docker-compose.local.yml      # Local container orchestration
├── main.py                       # FastAPI application entry point
├── requirements.txt              # Python dependencies
└── README.md
```

---

## API Reference

### Base URLs
- **Local Development**: `http://localhost:8000`
- **Staging (Azure)**: `https://as-eliya-website-chat-agent-stg.<env-fqdn>`
- **Interactive Swagger Docs**: `GET /docs`

---

### 1. Stream Chat (Server-Sent Events) - *Recommended*
Stream tokens bit-by-bit in real-time as they are produced by the agent.

- **Method**: `POST`
- **Path**: `/api/chat/stream`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Session-Id: <uuid>` *(Optional: generated automatically if omitted)*
- **Body**:
  ```json
  {
    "message": "What is Eliya Studio?",
    "session_id": "optional-uuid"
  }
  ```

- **SSE Stream Format**:
  ```
  event: session
  data: {"session_id": "782e9bef-21bc-47a3-8bad-b5bb21f02fb2"}

  event: token
  data: {"delta": "ELIYA"}

  event: token
  data: {"delta": " Studio is"}

  event: token
  data: {"delta": " a web-based"}

  event: done
  data: {}
  ```

---

### 2. Synchronous Chat
Send a message and receive the full response in a single JSON payload.

- **Method**: `POST`
- **Path**: `/api/chat`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Session-Id: <uuid>`
- **Body**:
  ```json
  {
    "message": "How does pricing work?"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "session_id": "782e9bef-21bc-47a3-8bad-b5bb21f02fb2",
    "response": "ELIYA offers two pricing packages: Pay as you go and Full Service...",
    "history_length": 4
  }
  ```

---

### 3. Health Check
Liveness and configuration probe.

- **Method**: `GET`
- **Path**: `/health`
- **Response** (`200 OK`):
  ```json
  {
    "status": "healthy",
    "agent_name": "as-eliya-website-agent-stg",
    "agent_version": "2",
    "endpoint": "https://as-eliya-aiservices-stg.services.ai.azure.com/api/projects/as-eliya-aiservices-stg-project"
  }
  ```

---

### 4. Session History
Retrieve stored messages for a specific session.

- **Method**: `GET`
- **Path**: `/api/sessions/{session_id}/history`
- **Response** (`200 OK`):
  ```json
  {
    "session_id": "782e9bef-21bc-47a3-8bad-b5bb21f02fb2",
    "messages": [
      { "role": "user", "content": "What is Eliya Studio?" },
      { "role": "assistant", "content": "ELIYA Studio is..." }
    ]
  }
  ```

---

### 5. Reset Session
Clear conversation history for a session.

- **Method**: `DELETE`
- **Path**: `/api/sessions/{session_id}`
- **Response** (`200 OK`):
  ```json
  { "message": "Session '782e9bef-21bc-47a3-8bad-b5bb21f02fb2' has been reset." }
  ```

---

## Session Handling & Sticky Session Affinity

### How Session Affinity Works
1. Every client request should include an `X-Session-Id` header (e.g. stored in browser `localStorage`).
2. If omitted, the API generates a new UUID and returns it via:
   - Response header: `X-Session-Id: <uuid>`
   - Response cookie: `affinity_session_id=<uuid>`
3. In **Azure Container Apps**, sticky sessions (`--sticky-sessions true`) route subsequent requests with the same session cookie to the same replica, minimizing cross-container overhead and keeping active conversational context local.

---

## Client Integration Guide

### 1. Integrating in JavaScript / React / Next.js

Below is a complete helper function showing how to call the streaming endpoint bit-by-bit:

```javascript
// agentClient.js
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://as-eliya-website-chat-agent-stg.<fqdn>';

export async function sendChatMessage({
  message,
  sessionId,
  onToken,
  onSessionId,
  onError,
}) {
  try {
    const response = await fetch(`${API_URL}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId || '',
      },
      body: JSON.stringify({
        message,
        session_id: sessionId || null,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat API error: ${response.statusText}`);
    }

    // Capture Session ID from response header
    const returnedSessionId = response.headers.get('X-Session-Id');
    if (returnedSessionId && onSessionId) {
      onSessionId(returnedSessionId);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop(); // Retain incomplete trailing fragment

      for (const block of blocks) {
        if (!block.trim()) continue;
        const eventMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*(.+)$/m);

        const eventType = eventMatch ? eventMatch[1].trim() : 'message';
        const dataStr = dataMatch ? dataMatch[1].trim() : '';

        if (eventType === 'session' && dataStr) {
          const { session_id } = JSON.parse(dataStr);
          if (session_id && onSessionId) onSessionId(session_id);
        } else if (eventType === 'token' && dataStr) {
          const { delta } = JSON.parse(dataStr);
          if (delta && onToken) onToken(delta);
        } else if (eventType === 'done') {
          return;
        }
      }
    }
  } catch (err) {
    if (onError) onError(err);
    else console.error(err);
  }
}
```

#### Usage in a Component:
```javascript
let accumulatedText = "";

await sendChatMessage({
  message: "Tell me about Eliya pricing",
  sessionId: localStorage.getItem("my_session_id"),
  onSessionId: (newId) => localStorage.setItem("my_session_id", newId),
  onToken: (token) => {
    accumulatedText += token;
    setAssistantMessage(accumulatedText);
  },
  onError: (err) => console.error(err),
});
```

---

### 2. Integrating via cURL

**Streaming (Server-Sent Events):**
```bash
curl -N -X POST http://localhost:8000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: test-session-123" \
  -d '{"message": "What is incrementality testing?"}'
```

**Synchronous JSON:**
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: test-session-123" \
  -d '{"message": "What is incrementality testing?"}'
```

---

## Deployment Guide

### A. Deploying Backend API to Azure Container Apps

The CI/CD workflow is located in [`.github/workflows/deploy-stg.yml`](.github/workflows/deploy-stg.yml).

#### 1. Required GitHub Repository Secrets
Under your GitHub Repository **Settings** -> **Secrets and variables** -> **Actions**, add:
- `AZURE_CLIENT_ID`: Service Principal Application/Client ID (for GitHub Actions runner)
- `AZURE_CLIENT_SECRET`: Service Principal Secret
- `AZURE_SUBSCRIPTION_ID`: Azure Subscription ID (`f89f8231-029f-4e99-a160-ebe6125601dc`)
- `AZURE_TENANT_ID`: Microsoft Entra Tenant ID (`3ee5e224-5fb6-4034-b069-518f5fdca06e`)
- `SLACK_BOT_TOKEN` *(Optional)*: Bot token for deployment notifications
- `SLACK_CHANNEL_ID` *(Optional)*: Slack channel ID

#### 2. Triggering Deployment
Pushing commits to the `staging` branch automatically triggers the build:
```bash
git checkout staging
git add .
git commit -m "Deploy website chat agent"
git push origin staging
```

The workflow will:
1. Build the Docker image via Azure Container Registry (`aseliyaacr`).
2. Deploy or update Container App `as-eliya-website-chat-agent-stg` in resource group `az-analytics-studio-staging`.
3. Enable `--system-assigned` Managed Identity.
4. Automatically assign `AcrPull`, `Cognitive Services OpenAI User`, and `Azure AI Developer` roles to the Container App's Managed Identity.
5. Configure `--sticky-sessions true` on the external ingress.
6. Verify deployment by probing `https://<FQDN>/health`.

---

### B. Deploying Frontend to Vercel

The `frontend/` folder is a standalone React SPA configured for Vercel.

1. Go to [Vercel Dashboard](https://vercel.com/new).
2. Import the `Eliya-Website-Agent` repository.
3. Configure project settings:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add Environment Variable:
   - `VITE_API_URL`: The HTTPS URL of your deployed Azure Container App (e.g., `https://as-eliya-website-chat-agent-stg.calmrock-xxxx.switzerlandnorth.azurecontainerapps.io`).
5. Click **Deploy**.

---

## Local Development Setup

### 1. Running the API Locally

```bash
# Activate your python virtual environment
source venv/bin/activate

# Install requirements
pip install -r requirements.txt

# Run uvicorn with hot reload
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

*Note: When running locally, ensure you have logged in to Azure CLI (`az login`) with your account.*

### 2. Running the Frontend Locally

```bash
cd frontend

# Install node dependencies
npm install

# Start Vite dev server
npm run dev
```
The React frontend will be accessible at `http://localhost:3000`.

### 3. Running with Docker Compose

To test the entire containerized stack locally:
```bash
docker-compose -f docker-compose.local.yml up --build
```
- API: `http://localhost:8000`
- Frontend: `http://localhost:3000`
