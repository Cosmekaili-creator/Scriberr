# Real-time transcription with live speaker naming — implementation plan

Audience: Sonnet 4.6, implementing in `/home/arcs/scriberr` (Go module `ascribe`, frontend in `web/frontend/src/`).

## 1. Goals recap

Two tiers, branched by the selected transcription provider:

- **Tier 1 (cloud, real-time)** — AssemblyAI and Deepgram. Browser streams audio → server → provider real-time WS. Partial/final transcript segments flow back via existing SSE broadcaster. Browser also buffers the full recording locally and uploads it after stop, so the final `TranscriptionJob` has both an audio file and a complete transcript.
- **Tier 2 (local models)** — WhisperX, Parakeet, Canary, Voxtral. Recording ends → upload triggers transcription automatically → on completion, if >1 speaker, a "Name your speakers" wizard pops with sample quotes per speaker. Wizard also reopenable from transcript view.

Both tiers produce a normal `models.TranscriptionJob`. Downstream features (summary, chat, notes, collections, playback) must work unchanged.

## 2. Architecture summary

```
[Browser]                           [Go server]                          [Provider]
  Mic ─┬─► WaveSurfer Record ─► webm Blob ──upload (HTTP)──┐
       │                                                    │
       └─► AudioWorklet ─► PCM16 16k frames ──WS audio─► RealtimeSession ──WS─► AssemblyAI v3
                                                              │                  / Deepgram Live
                                                              ▼
                                                       SSE broadcaster ──► Browser live panel
                                                              ▼
                                                       Persist incremental
                                                       transcript to DB
                                                              ▼
                                                       On finalize: attach audio,
                                                       mark job completed
```

Two browser→server channels per session:
1. **WS** `/api/v1/transcription/realtime/ws?session_id=…&token=…` — binary PCM16 audio frames (client→server) + JSON control msgs.
2. **HTTP POST** `/api/v1/transcription/realtime/:id/finalize` — multipart upload of the complete recorded blob after the WS closes.

SSE (server→browser) is unchanged: same `/api/v1/events` global stream, keyed by `jobID`, just new event types.

## 3. Data model changes

`internal/models/transcription.go`

Add two fields on `TranscriptionJob`:

```go
// Streaming/realtime mode (cloud provider live transcription)
StreamingMode bool   `json:"streaming_mode" gorm:"type:boolean;default:false"`
SessionID     string `json:"session_id,omitempty" gorm:"type:varchar(36);index"`
```

- `StreamingMode = true` ⇒ job was created via realtime path. UI uses this to know transcript is being populated incrementally.
- `SessionID` correlates the job with the in-memory `RealtimeSession`. After finalize, it remains for audit but the session is gone from memory.

Also allow `AudioPath` to be temporarily empty: when a realtime job is created the audio is not yet uploaded. The `gorm:"type:text;not null"` constraint must be relaxed — change to `gorm:"type:text"` (drop `not null`). Add a SQLite migration helper in `internal/database/` (or just rely on GORM AutoMigrate — fields are additive, AutoMigrate handles `ALTER TABLE ADD COLUMN`, but it will not drop the existing NOT NULL on `audio_path` on SQLite. Workaround: set placeholder `AudioPath = "pending"` in the create call and overwrite on finalize. Use this approach — no SQL migration needed.)

No new tables. Speaker mappings reuse the existing `speaker_mappings` table via the existing `SpeakerMappingRepository`.

## 4. Backend — Tier 1 (real-time cloud streaming)

### 4.1 New dependency

Add `github.com/gorilla/websocket v1.5.x` to `go.mod` (used for both client-to-provider WS and the server's accept side).

```bash
PATH=/usr/local/go/bin:$PATH go get github.com/gorilla/websocket
```

### 4.2 New package: `internal/transcription/realtime/`

Files:

#### `provider.go` — interface

```go
package realtime

import "context"

// ProviderEvent is what the upstream provider sends back; the session translates
// these into SSE messages and DB updates.
type ProviderEvent struct {
    Kind        string  // "partial" | "final_segment" | "speaker" | "error" | "open" | "close"
    Text        string  // partial or segment text
    Start       float64 // seconds from session start
    End         float64
    Speaker     string  // raw provider speaker label (e.g. "A", "0", "speaker_0")
    Confidence  float64
    Err         error
}

type ProviderClient interface {
    // Start opens the WS to the upstream provider and returns a channel of events.
    // Cancel ctx to terminate. Caller is responsible for draining the channel.
    Start(ctx context.Context, apiKey string, params map[string]any) (<-chan ProviderEvent, error)
    // WriteAudio sends a binary frame (PCM16 mono 16kHz LE) to the provider.
    WriteAudio(frame []byte) error
    // Close gracefully closes the upstream WS (sends end-of-stream sentinel where supported).
    Close() error
}
```

#### `session.go` — per-session state

```go
type Session struct {
    ID         string
    JobID      string
    UserID     uint
    Provider   string // "assemblyai" | "deepgram"
    StartedAt  time.Time

    client      ProviderClient
    cancel      context.CancelFunc
    broadcaster *sse.Broadcaster
    jobRepo     repository.JobRepository

    mu               sync.Mutex
    segments         []interfaces.TranscriptSegment // committed
    words            []interfaces.TranscriptWord    // committed
    speakerCounter   map[string]int                 // first-seen ordering
    lastPartial      string
    closed           bool
}

// Run consumes events from the ProviderClient and drives SSE + persistence.
// Returns when the upstream channel closes or ctx is cancelled.
func (s *Session) Run(ctx context.Context, events <-chan ProviderEvent) { ... }

// WriteAudio forwards a frame from the browser WS to the upstream provider.
func (s *Session) WriteAudio(frame []byte) error { ... }

// Close terminates the upstream connection, flushes the final transcript JSON to
// the DB, broadcasts a realtime_session_ended event, and marks the session closed.
// Does NOT set job status — that happens on finalize.
func (s *Session) Close() error { ... }

// Snapshot returns the current accumulated transcript as a JSON blob compatible
// with the existing transcript shape ({ text, segments, word_segments }).
func (s *Session) Snapshot() ([]byte, error) { ... }
```

`Run` loop logic:

- On `partial`: update `lastPartial`, broadcast `realtime_partial` SSE event (no DB write).
- On `final_segment`: append to `s.segments`, register speaker in `speakerCounter` if new (and broadcast `realtime_speaker` once), broadcast `realtime_segment`. Throttle DB persistence to every N seconds or every M segments (recommended: every 5s or every 3 segments, whichever comes first) — call `jobRepo.UpdateTranscript(ctx, jobID, snapshotJSON)`.
- On `error`: broadcast `realtime_error`. If non-recoverable, also close.
- On `close`: flush final snapshot to DB, broadcast `realtime_session_ended`.

Speaker normalization: map raw provider labels through `normalizeSpeaker(raw)` → `"SPEAKER_00"`, `"SPEAKER_01"`, … (matches the convention used elsewhere in the codebase; see how Deepgram already formats `"Speaker %d"` — pick one canonical form and use it consistently; recommend `SPEAKER_NN` to match WhisperX). Store the normalized label as the segment's `Speaker`.

#### `manager.go` — in-memory registry

```go
type Manager struct {
    mu       sync.RWMutex
    sessions map[string]*Session
    // jobRepo / broadcaster / config injected at construction
}

func NewManager(jobRepo repository.JobRepository, br *sse.Broadcaster, cfg *config.Config) *Manager
func (m *Manager) Create(jobID string, userID uint, provider string, params map[string]any) (*Session, error)
func (m *Manager) Get(sessionID string) (*Session, bool)
func (m *Manager) Remove(sessionID string)
// Reaper goroutine: every 60s, close+remove sessions idle for >5 min.
func (m *Manager) startReaper(ctx context.Context)
```

The manager creates and stores the `Session`, instantiates the right `ProviderClient` (AssemblyAI or Deepgram), and kicks off `session.Run` in a goroutine.

#### `assemblyai_stream.go`

Implements `ProviderClient` for AssemblyAI Universal Streaming v3.

- Endpoint: `wss://streaming.assemblyai.com/v3/ws`
- Query params: `sample_rate=16000`, `format_turns=true`, `token=<apiKey>` *(use temporary token if available; v3 accepts the API key as `Authorization: Bearer` header on the WS handshake — gorilla supports custom headers via `websocket.Dialer.Dial(url, http.Header{...})`)*.
- Audio frames: send as binary WS messages, 50ms or 100ms of PCM16 mono LE at 16kHz (i.e. 1600 or 3200 samples = 3200 or 6400 bytes per frame). Provider accepts variable sizes; pick 100ms.
- Inbound messages (JSON):
  - `Begin` → emit `open`
  - `Turn` → fields: `transcript`, `turn_order`, `end_of_turn` (bool), `turn_is_formatted`, optional `words[]` with `start`, `end` (ms), `speaker` (when speaker labels enabled). Emit `partial` when `end_of_turn=false`; on `end_of_turn=true` emit `final_segment` with the formatted text.
  - `Termination` → emit `close`
- Send `{"type":"Terminate"}` JSON on graceful shutdown.
- Reconnect policy: on transient error (network drop within 30s) attempt one reconnect with exponential backoff (1s → 2s, max 2 attempts), preserving session state. On reconnect failure, emit `error` with `recoverable=false`.

NOTE on speaker labels: AssemblyAI Universal Streaming v3 has more limited diarization than batch. If `params["diarize"]` is true and the API doesn't return speaker IDs in turns, fall back to attributing all segments to a single `SPEAKER_00` and let the wizard rename it. Document this in code comments.

#### `deepgram_stream.go`

Implements `ProviderClient` for Deepgram Live.

- Endpoint: `wss://api.deepgram.com/v1/listen`
- Query params: `model=nova-2`, `encoding=linear16`, `sample_rate=16000`, `channels=1`, `interim_results=true`, `punctuate=true`, `smart_format=true`, `diarize=true` (if `params["diarize"]`), `language=<code>` if set.
- Auth: `Authorization: Token <apiKey>` header on the WS handshake.
- Audio frames: binary WS messages, same 100ms PCM16 cadence.
- Inbound messages: JSON `{"type":"Results", "is_final": bool, "channel":{"alternatives":[{...words[]}]}, ...}`. Each word has `start`, `end`, `speaker` (int when diarize=true). Build segments by speaker changes (reuse the `groupWordsIntoSegments` pattern from `deepgram.go`). Emit `partial` when `is_final=false`, `final_segment` per speaker-grouped chunk when `is_final=true`.
- Send `{"type":"CloseStream"}` JSON on graceful shutdown.
- Same reconnect policy as AssemblyAI.

### 4.3 New HTTP handlers — `internal/api/realtime_handlers.go`

Three endpoints; all live under the existing `transcription` group with `AuthMiddleware`.

#### `POST /api/v1/transcription/realtime/start`

Body:
```json
{
  "title": "optional",
  "provider": "assemblyai" | "deepgram",
  "language": "en",
  "diarize": true,
  "api_key": "optional override"
}
```

Logic:
1. `currentUserID(c)` → reject if no user.
2. Generate `jobID = uuid.New().String()`, `sessionID = uuid.New().String()`.
3. Build `WhisperXParams` with `ModelFamily` set to `FamilyAssemblyAI` or `FamilyDeepgram`, `Diarize: true`, language, api_key override. This makes downstream code consistent.
4. Create `TranscriptionJob{ID: jobID, UserID, Title, Status: StatusProcessing, StreamingMode: true, SessionID: sessionID, AudioPath: "pending", Parameters: params, Diarization: true}` via `jobRepo.Create`.
5. Resolve API key: per-request override → `cfg.AssemblyAIKey` / `cfg.DeepgramKey` from env. Reject 400 if none.
6. `manager.Create(jobID, userID, provider, paramsMap)` — kicks off the upstream WS.
7. Broadcast `job_update` (status=processing, streaming=true).
8. Return `{"job_id":..., "session_id":..., "ws_url":"/api/v1/transcription/realtime/ws?session_id=..."}`.

#### `GET /api/v1/transcription/realtime/ws`

WebSocket upgrade. Auth via `?token=<JWT>` query parameter because browsers cannot set headers on the WS handshake. Pull token, validate via `authService.ValidateToken(token)`. If invalid → 401 before upgrade. Compare token's userID against the session's userID after lookup.

Steps:
1. Read `session_id` from query.
2. Validate token, get `userID`.
3. `session, ok := manager.Get(sessionID)` — 404 if not found, 403 if `session.UserID != userID`.
4. Upgrade with `gorilla/websocket.Upgrader{ CheckOrigin: func(r *http.Request) bool { ... reuse CORS config ... } }`.
5. Read loop:
   - Binary message → `session.WriteAudio(payload)`.
   - Text message JSON `{"type":"stop"}` → `session.Close()`, exit loop.
   - Ping/pong handled by gorilla defaults.
6. On read error or context done: don't auto-close session (allow reconnect within 30s). Set an idle deadline on the session; the reaper closes it.

#### `POST /api/v1/transcription/realtime/:id/finalize`

Multipart form with `audio` file (the complete webm/mp3 blob the browser buffered).

1. `requireJobOwner(c, jobID)`.
2. Reject if `!job.StreamingMode`.
3. Save the file via `fileService.SaveUpload` to `cfg.UploadDir`. Optionally convert webm → mp3 (reuse the existing UploadAudio conversion block).
4. Update job: `AudioPath = filePath`, `Status = StatusCompleted`. Persist `Transcript` one final time using `session.Snapshot()` if session still exists.
5. Create a `TranscriptionJobExecution` record for parity with normal jobs (started_at = session.StartedAt, completed_at = now, parameters = job.Parameters, status = completed).
6. `manager.Remove(sessionID)` (which calls `session.Close()` if still alive).
7. Broadcast `job_update` with status=completed.
8. Return the updated job JSON.

If the upstream session has died but transcript was persisted, finalize still succeeds — the user keeps their audio.

#### Wiring in `internal/api/router.go`

In the `transcription` group (after `transcription.Use(middleware.AuthMiddleware(authService))`):

```go
realtime := transcription.Group("/realtime")
{
    realtime.POST("/start", handler.StartRealtimeSession)
    realtime.POST("/:id/finalize", handler.FinalizeRealtimeSession) // no compression
}
// WS endpoint must bypass compression and most middleware noise:
// register it on the parent group without compression middleware, but keep auth (token-in-query).
transcription.GET("/realtime/ws", handler.RealtimeWebSocket)
```

Note: the WS handler validates the JWT itself (from `?token=`) — `AuthMiddleware` won't accept tokens in query strings. Skip `AuthMiddleware` for this one route by registering it on a sibling group that does not apply the middleware, or special-case the middleware to also check `?token=`. **Recommended**: register on a new group `v1.Group("/transcription").GET("/realtime/ws", handler.RealtimeWebSocket)` with **no** `AuthMiddleware` and have the handler validate the token from the query.

#### Handler wiring in `internal/api/handlers.go`

Add to `Handler` struct:
```go
realtimeManager *realtime.Manager
```

Extend `NewHandler` signature and `cmd/server/main.go` to construct the manager:
```go
realtimeMgr := realtime.NewManager(jobRepo, broadcaster, cfg)
```
Pass into `NewHandler`.

### 4.4 Config additions

`internal/config/config.go` — confirm `AssemblyAIKey` and `DeepgramKey` are already read from env (they are, per `internal/api/handlers.go` usage). If a `RealtimeIdleTimeout` knob is desired, default to `5 * time.Minute`.

### 4.5 `cmd/server/main.go` changes

After `broadcaster := sse.NewBroadcaster()`:

```go
realtimeMgr := realtime.NewManager(jobRepo, broadcaster, cfg)
// start its reaper
go realtimeMgr.StartReaper(rootCtx)
```

Pass `realtimeMgr` to `api.NewHandler`. On shutdown call `realtimeMgr.Shutdown()` (closes all sessions).

## 5. Backend — Tier 2 (auto-trigger + wizard support)

No new backend endpoints required for Tier 2. The wizard reuses the existing `GET /api/v1/transcription/:id/speakers` and `POST /api/v1/transcription/:id/speakers` endpoints in `speaker_mapping_handlers.go`.

**One small backend helper** to make the wizard's "quote excerpts per speaker" data fetch easy: extend `GET /api/v1/transcription/:id/speakers` to optionally return sample segments. Add `?include_samples=true` query parameter; when set, the response shape becomes:

```json
{
  "mappings": [ { "id":..., "original_speaker": "SPEAKER_00", "custom_name": "..." }, ... ],
  "samples": {
    "SPEAKER_00": [ { "start": 12.3, "text": "Welcome everyone..." }, ... ]
  }
}
```

(Keep backward compatibility: without the query param, return the existing array shape.)

Implementation in `speaker_mapping_handlers.go`:
1. After loading mappings, if `c.Query("include_samples") == "true"`, load the job transcript, parse JSON segments, and for each distinct speaker pick up to 3 segments with the longest text (filter out very short utterances < 20 chars), sorted by start time. Return the new shape.

## 6. SSE event types

Defined in `internal/sse/broadcaster.go` only as string constants — currently free-form. Document the new types in a top-of-file comment block in `realtime/session.go`:

| Event type | Payload shape | When |
|------------|---------------|------|
| `job_update` (existing) | `{ job_id, status, error?, streaming? }` | Job status transitions |
| `realtime_partial` | `{ session_id, job_id, text, speaker?, start_ms, end_ms }` | Interim text, replaces prior partial in UI |
| `realtime_segment` | `{ session_id, job_id, segment_index, start, end, text, speaker }` | Committed segment, append to UI |
| `realtime_speaker` | `{ session_id, job_id, original_speaker, first_seen_at }` | New speaker label appears (first time) |
| `realtime_error` | `{ session_id, job_id, error, recoverable }` | Transient or fatal upstream error |
| `realtime_session_ended` | `{ session_id, job_id, segment_count }` | Upstream WS closed cleanly |

All broadcasts use `broadcaster.Broadcast(jobID, eventType, payload)` so existing per-job and `*` global subscribers both receive them.

## 7. Frontend — Tier 1 (real-time flow)

### 7.1 New files under `web/frontend/src/features/transcription/realtime/`

#### `audioWorklet.ts` (loaded as a worklet module)

A `PCMDownsamplerProcessor` AudioWorkletProcessor that:
- Receives Float32 frames at the AudioContext's native sample rate (typically 48000).
- Downsamples to 16000 via simple averaging.
- Quantizes Float32 → Int16 LE.
- Posts `ArrayBuffer` chunks of ~100ms (1600 samples = 3200 bytes) via `port.postMessage`.

Distribute as a string-or-URL module loaded with `audioContext.audioWorklet.addModule(workletUrl)`. Vite handles `?worker&url` and `?url` imports; use `new URL('./audioWorklet.ts', import.meta.url)` pattern.

#### `useRealtimeStream.ts` — hook

Inputs: `{ provider, language, diarize, title }`.

Returns:
```ts
{
  status: 'idle' | 'starting' | 'streaming' | 'stopping' | 'ended' | 'error',
  jobId: string | null,
  sessionId: string | null,
  segments: LiveSegment[],     // committed
  partial: string,             // current interim text
  speakers: string[],          // first-seen order, normalized labels
  error: string | null,
  start: (mediaStream: MediaStream) => Promise<void>,
  stop: () => Promise<void>,   // closes WS, returns when finalize HTTP completes
  finalize: (audioBlob: Blob) => Promise<TranscriptionJob>,
}
```

Behavior:
1. `start(stream)`:
   - POST `/api/v1/transcription/realtime/start` → get `{ job_id, session_id, ws_url }`.
   - Build absolute WS URL (`window.location.protocol === 'https:' ? 'wss:' : 'ws:'` + host + ws_url + `&token=` + jwt).
   - Open WS, set `binaryType = 'arraybuffer'`.
   - Create `AudioContext({ sampleRate: 16000 })` (browsers may not honor; if so, downsampling in the worklet handles it).
   - `audioCtx.createMediaStreamSource(stream)` → `audioWorkletNode` → `port.onmessage` posts the `ArrayBuffer` directly to `ws.send`.
   - Subscribe to SSE channel for `jobId` via the existing global SSE provider; on `realtime_segment`, push to `segments`; on `realtime_partial`, replace `partial`; on `realtime_speaker`, add to `speakers`; on `realtime_session_ended`, transition state.
2. `stop()`:
   - Send `ws.send(JSON.stringify({type:'stop'}))`, close WS.
   - Disconnect AudioWorklet, close AudioContext.
3. `finalize(blob)`:
   - POST multipart to `/api/v1/transcription/realtime/:jobId/finalize` with the blob as `audio`.
   - Invalidate TanStack Query cache for the audio files list.
   - Return the updated job.

Auth: reuse the existing `authStore` to grab the JWT for the query-string token.

#### `LiveTranscriptPanel.tsx`

Renders a vertically scrolling list of `segments` + a faded "current partial" line at the bottom. Each segment shows:
- timestamp (mm:ss)
- speaker pill (clickable to rename inline — see 7.3)
- text

Auto-scrolls to bottom unless the user scrolls up (track a `pinnedToBottom` boolean). Reuse styling tokens from `TranscriptView.tsx` (`--bg-main`, `--brand-solid`, etc).

#### `RealtimeRecorderDialog.tsx`

A sibling of `AudioRecorder.tsx`. Same outer Dialog shell, same title input + mic selector. Differences:
- After clicking "Start Recording":
  - Start MediaRecorder (webm/opus via existing `getSupportedAudioMimeType()`) to buffer chunks locally.
  - Call `useRealtimeStream.start(mediaStream)`.
- Live transcript panel renders in place of the empty waveform area while streaming.
- "Stop" button → `MediaRecorder.stop()` (gathers final Blob) → `useRealtimeStream.stop()` → `useRealtimeStream.finalize(blob)`.
- On success, close dialog and navigate to the audio detail view for the new `jobId`.

Inline speaker rename in the live panel: click a speaker pill → input → on commit, POST to `/api/v1/transcription/:id/speakers` with the **full current mapping** (read existing + overwrite). Reuse the same call the existing `TranscriptView.tsx` uses (line 374 path).

### 7.2 Provider branching at recorder open

`Header.tsx` currently mounts `<AudioRecorder>` and `<SystemAudioRecorder>`. Add a third dialog `<RealtimeRecorderDialog>` and route based on the user's default profile:

In `useGlobalUpload` (or a new `useRecorderProvider` hook), fetch the user's default profile (`GET /api/v1/user/default-profile` — already exists). If `profile.parameters.model_family ∈ { "assemblyai", "deepgram" }`, open `RealtimeRecorderDialog`. Otherwise open the existing `AudioRecorder`.

Add a small UI affordance in `AudioRecorder`'s settings dropdown: "Provider: AssemblyAI (real-time)" badge so users see why behavior differs.

### 7.3 Reuse the existing SSE provider

The codebase already has an SSE consumer in `src/contexts/ChatEventsContext.tsx` (chat) and the job_update broadcasts feed `useAudioFiles.ts` invalidations. **Verify and reuse** the existing global SSE connection wrapper (search for `/api/v1/events/` consumer). If a generic `useJobEvents(jobId, onEvent)` hook doesn't exist yet, add one at `src/features/transcription/hooks/useJobEvents.ts`:

```ts
export function useJobEvents(jobId: string | null, handlers: {
  onJobUpdate?: (e: JobUpdate) => void
  onRealtimePartial?: (e: RealtimePartial) => void
  onRealtimeSegment?: (e: RealtimeSegment) => void
  onRealtimeSpeaker?: (e: RealtimeSpeaker) => void
  onRealtimeError?: (e: RealtimeError) => void
  onRealtimeEnded?: (e: RealtimeEnded) => void
}): void
```

It opens an `EventSource('/api/v1/events/?job_id=' + jobId)` with the JWT cookie carrying auth, dispatches by `event.type`, and cleans up on unmount.

## 8. Frontend — Tier 2 (auto-trigger + speaker wizard)

### 8.1 Auto-submit on recording end

Modify `AudioRecorder.tsx` `handleUpload`: after the existing `onRecordingComplete(blob, title)` call (which uploads the file), unconditionally trigger transcription with the user's default profile.

Implementation: have `useGlobalUpload`'s upload flow accept an `autoTranscribe: boolean` flag. When true, after `UploadAudio` returns the new `jobID`, POST to `/api/v1/transcription/:id/start` with the user's default profile parameters. (The existing `AutoTranscriptionEnabled` user setting still controls behavior for drag-drop uploads; the recorder always sets `autoTranscribe: true` regardless of that flag.)

### 8.2 Speaker wizard

New shared component used by both Tier 1 (optional) and Tier 2 (auto-pop):

#### `src/features/transcription/components/SpeakerWizardModal.tsx`

Props:
```ts
{
  jobId: string,
  open: boolean,
  onClose: () => void,
  onSaved?: (mappings: Record<string, string>) => void,
}
```

Behavior:
1. Open → `GET /api/v1/transcription/:jobId/speakers?include_samples=true`.
2. Render one card per speaker in first-seen order. Each card shows:
   - Auto-numbered title ("Speaker 1", "Speaker 2", ...)
   - Up to 3 quote excerpts: `"… {text} …"` with the timestamp as a clickable link that calls `onSeek` if the modal is reopened from the detail view (otherwise no-op).
   - An `<Input>` for the real name, prefilled with the existing custom name if any.
3. Footer: `[Skip]` `[Save names]`. Save sends `POST /api/v1/transcription/:jobId/speakers` with only the cards whose input is non-empty.
4. On save, invalidate TanStack Query keys: `['speakers', jobId]` and `['transcript', jobId]`. Call `onSaved`.

Reuse Radix Dialog primitive and Tailwind tokens. Match `TranscriptionConfigDialog.tsx`'s visual style.

#### Auto-open trigger

New hook `src/features/transcription/hooks/useSpeakerWizardAutoOpen.ts`:

```ts
export function useSpeakerWizardAutoOpen(): {
  pendingJobId: string | null,
  dismiss: () => void,
}
```

- Subscribes to the global SSE stream (`?job_id=*`) for `job_update` events with `status === 'completed'`.
- For each, fetches `/api/v1/transcription/:id/speakers?include_samples=true` (cheap).
- If the response has > 1 distinct speaker AND no custom mappings yet AND the job is owned by the current user → sets `pendingJobId`.
- Persist a dismissed-set in `localStorage` (`scriberr_wizard_dismissed`) so closing the wizard doesn't re-pop on the next SSE event for the same job.

Mount the auto-opener once at the top level (in the `<MainLayout>` or `<Header>` or in a new global provider). Render `<SpeakerWizardModal jobId={pendingJobId} open={!!pendingJobId} onClose={dismiss} />`.

### 8.3 Reopen from transcript view

Add a button to `web/frontend/src/components/transcript/TranscriptToolbar.tsx` (or wherever the toolbar lives — confirm path during impl): "Name speakers" — opens the same modal for the current job.

## 9. i18n keys to add

Add to `web/frontend/src/i18n/en.ts` (and mirror in `fr.ts`):

```
'realtime.recorder.title': 'Live Transcription',
'realtime.recorder.description': 'Record audio while we transcribe in real time.',
'realtime.status.starting': 'Connecting to {provider}…',
'realtime.status.streaming': 'Live',
'realtime.status.stopping': 'Finalizing…',
'realtime.status.ended': 'Recording saved.',
'realtime.error.connectionLost': 'Connection lost. Reconnecting…',
'realtime.error.providerFailed': 'Transcription provider failed: {error}',
'realtime.live.waiting': 'Listening…',
'realtime.live.partialHint': '(working…)',

'speakerWizard.title': 'Name your speakers',
'speakerWizard.description': '{count} voices were detected. Add names so you remember who said what.',
'speakerWizard.speakerLabel': 'Speaker {n}',
'speakerWizard.namePlaceholder': 'e.g. Alice',
'speakerWizard.sampleQuote': '"{text}"',
'speakerWizard.skip': 'Skip',
'speakerWizard.save': 'Save names',
'speakerWizard.saving': 'Saving…',
'speakerWizard.reopenButton': 'Name speakers',

'detail.transcript.streamingBadge': 'Live',
```

## 10. File-by-file checklist

### New files
| Path | Purpose |
|------|---------|
| `internal/transcription/realtime/provider.go` | ProviderClient interface + ProviderEvent type |
| `internal/transcription/realtime/session.go` | Session lifecycle, run loop, snapshot, DB persistence |
| `internal/transcription/realtime/manager.go` | In-memory registry + reaper |
| `internal/transcription/realtime/assemblyai_stream.go` | AssemblyAI Universal Streaming v3 client |
| `internal/transcription/realtime/deepgram_stream.go` | Deepgram Live client |
| `internal/transcription/realtime/normalize.go` | Speaker label normalization + helpers |
| `internal/api/realtime_handlers.go` | StartRealtimeSession / RealtimeWebSocket / FinalizeRealtimeSession |
| `web/frontend/src/features/transcription/realtime/audioWorklet.ts` | PCM downsampler worklet |
| `web/frontend/src/features/transcription/realtime/useRealtimeStream.ts` | Hook orchestrating WS + capture |
| `web/frontend/src/features/transcription/realtime/LiveTranscriptPanel.tsx` | Live display |
| `web/frontend/src/features/transcription/realtime/RealtimeRecorderDialog.tsx` | Tier 1 recorder dialog |
| `web/frontend/src/features/transcription/components/SpeakerWizardModal.tsx` | Shared wizard |
| `web/frontend/src/features/transcription/hooks/useSpeakerWizardAutoOpen.ts` | SSE-driven auto-pop |
| `web/frontend/src/features/transcription/hooks/useJobEvents.ts` | Generic SSE consumer hook (if not already present) |

### Modified files
| Path | Change |
|------|--------|
| `internal/models/transcription.go` | Add `StreamingMode` + `SessionID` fields; relax `AudioPath` not-null (or use `"pending"` placeholder) |
| `internal/api/handlers.go` | Add `realtimeManager` to `Handler` struct + constructor |
| `internal/api/router.go` | Register `/realtime/start`, `/realtime/:id/finalize`, `/realtime/ws` |
| `internal/api/speaker_mapping_handlers.go` | Add `?include_samples=true` to GetSpeakerMappings |
| `cmd/server/main.go` | Construct `realtime.Manager`, pass into NewHandler, start reaper, shut down on exit |
| `go.mod` / `go.sum` | Add `github.com/gorilla/websocket` |
| `web/frontend/src/components/AudioRecorder.tsx` | Auto-trigger transcription after upload using default profile |
| `web/frontend/src/components/Header.tsx` | Branch to RealtimeRecorderDialog when default profile is a real-time provider |
| `web/frontend/src/contexts/GlobalUploadContext.tsx` | Add `autoTranscribe` flag to recording upload path |
| `web/frontend/src/components/transcript/TranscriptToolbar.tsx` (or equivalent) | Add "Name speakers" button |
| `web/frontend/src/components/layout/MainLayout.tsx` (or App root) | Mount `useSpeakerWizardAutoOpen` + modal |
| `web/frontend/src/i18n/en.ts` + `fr.ts` | New keys |

## 11. Build / deploy notes (for the implementer)

Rebuild and redeploy after any change:
```bash
cd /home/arcs/scriberr
PATH=/usr/local/go/bin:$PATH make build         # local check
sudo -A docker build -t scriberr-arcs:latest .
sudo -A docker compose -f /opt/arcs/docker-compose.yml up -d --force-recreate scriberr
sudo -A docker logs arcs-scriberr --tail=80 -f
```

If frontend `dist/` ends up root-owned: `sudo -A chown -R arcs:arcs web/frontend/dist/`.

## 12. Phasing — recommended build order

Each phase produces something testable.

### Phase A — speaker wizard for existing local jobs (no real-time, minimal risk)
1. Extend `GetSpeakerMappings` with `?include_samples=true`.
2. Build `SpeakerWizardModal` + `useSpeakerWizardAutoOpen`.
3. Auto-trigger transcription from `AudioRecorder` (`autoTranscribe: true`).
4. Add "Name speakers" button on transcript toolbar.
5. Test: record with current WhisperX setup → wizard pops on completion.

### Phase B — backend realtime scaffolding (no provider yet)
1. Add data model fields + `realtime` package with a mock provider (returns fake partials/segments on a timer).
2. Add HTTP handlers + WS endpoint + router wiring.
3. Wire SSE event types.
4. Test with `curl --no-buffer` on `/events` and a tiny WS client to confirm the round-trip.

### Phase C — Deepgram first (synchronous-ish, easier protocol)
1. Implement `deepgram_stream.go`.
2. Wire `RealtimeRecorderDialog` end-to-end against Deepgram only.
3. Test: record → live partials/finals visible → stop → audio file present → reopen detail view → playback works.

### Phase D — AssemblyAI Universal Streaming
1. Implement `assemblyai_stream.go`.
2. Add provider branching in the dialog.
3. Test with AssemblyAI provider selected in default profile.

### Phase E — polish
1. Inline speaker rename during live capture.
2. Reconnect-on-transient-error.
3. Wizard auto-open on Tier 1 jobs too (same SSE path triggers it; check that `realtime_session_ended` doesn't bypass `job_update` — finalize sets status=completed, so it should fire).
4. i18n French translations.

## 13. Things to verify / decisions deferred

- **AssemblyAI v3 speaker labels in streaming**: docs are thinner than batch. If turns don't include speakers, ship a single-speaker live experience for AssemblyAI and rely on the wizard to rename later. Confirm against current AssemblyAI docs at implementation time.
- **Token-in-query for WS**: technically less secure than headers; mitigations: use short-lived tokens (the existing JWT TTL is fine), don't log query strings (verify `pkg/logger` doesn't), and consider rotating to a one-shot session-bound token returned by `/realtime/start` rather than passing the full JWT. **Recommended**: have `/realtime/start` return a single-use `ws_token` that the manager stores and the WS handler validates against — never put the JWT in a query string.
- **Sample rate**: some browsers (esp. Safari) won't let you force `AudioContext({sampleRate: 16000})`. The AudioWorklet must downsample regardless.
- **MediaRecorder + parallel AudioWorklet on the same stream**: works in all evergreen browsers — `MediaStream` tracks support multiple consumers.
- **Reaper TTL**: 5 minutes idle. Tune if users complain about premature cutoffs.
- **Persistence cadence**: every 5s or 3 segments to DB. SQLite is fine but avoid hammering it. If real-time write latency matters, batch in-memory and flush.
- **Backwards compatibility for `audio_path` NOT NULL**: prefer the `"pending"` placeholder approach over a destructive migration. Add a UI guard: if a job has `streaming_mode=true && audio_path == "pending"`, don't render the audio player.
