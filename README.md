<div align="center">
  <img src="logo.svg" height="90" style="vertical-align: middle;" />
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="aScribe_logo_clean-cropped.svg">
    <img src="logo-text.svg" height="80" alt="aScribe" style="vertical-align: middle;" />
  </picture>
</div>

# aScribe

Audio transcription application with speaker diarization, AI summaries, and multi-provider support.

Fork of [Scriberr](https://github.com/rishikanthc/Scriberr), significantly extended for the ARCS agency stack.

## Features

- Local transcription via WhisperX, Parakeet, Canary, Voxtral
- Cloud transcription via AssemblyAI, Deepgram, OpenAI Whisper
- Speaker diarization (PyAnnote, SortFormer)
- AI summaries and chat (OpenAI-compatible)
- Collections for grouping and batch summarizing recordings
- CLI watcher for automated folder upload
- Webhook callbacks on job completion
- French / English UI

## Quick start (Docker)

```bash
docker run -d \
  -p 8080:8080 \
  -v ascribe_data:/app/data \
  -e ASSEMBLYAI_API_KEY=your_key \
  -e OPENAI_API_KEY=your_key \
  ascribe:latest
```

Or with Docker Compose:

```bash
docker compose up -d
```

## Build from source

```bash
make build       # produces ./ascribe binary
make build-cli   # produces CLI binaries in bin/cli/
```

Requires Go 1.24+, Node 20+.

## Key environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite path (default `data/ascribe.db`) |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key |
| `DEEPGRAM_API_KEY` | Deepgram API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `HF_TOKEN` | Hugging Face token (required for PyAnnote diarization) |
| `APP_ENV` | Set to `production` for secure cookies |
| `WHISPERX_ENV` | UV environment root (default `data/whisperx-env`) |

## License

MIT — see [LICENSE](LICENSE).
