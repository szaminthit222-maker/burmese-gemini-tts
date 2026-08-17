# Burmese Gemini TTS Director

A deploy-ready web app for creating timestamp-synchronized Burmese voiceover scripts and generating Gemini TTS audio.

## Requirements

- Node.js 20+
- A Gemini API key

Google's current Gemini TTS documentation lists `gemini-3.1-flash-tts-preview` for expressive TTS and English inline audio tags such as `[whispers]`, `[laughs]`, `[excited]`, etc.:
https://ai.google.dev/gemini-api/docs/speech-generation

## Run locally

1. Copy `.env.example` to `.env`.
2. Put your Gemini API key in `.env`.
3. Export the variables in your shell, or use a process manager that loads `.env`.
4. Run:

```bash
npm start
```

Open `http://localhost:3000`.

## Important

The example server reads `GEMINI_API_KEY` from the server environment. Do NOT put a real API key in `public/index.html`.

For production deployment, configure `GEMINI_API_KEY` as a secret/environment variable in your hosting provider.
