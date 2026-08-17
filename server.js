import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.GEMINI_API_KEY;

function send(res, status, data, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

async function body(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

async function gemini(path, payload) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured.");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${path}`, {
    method: "POST",
    headers: {
      "x-goog-api-key": API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!r.ok) throw new Error(parsed?.error?.message || `Gemini API error ${r.status}`);
  return parsed;
}

function pcmToWav(base64, sampleRate = 24000, channels = 1, bits = 16) {
  const pcm = Buffer.from(base64, "base64");
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  const out = Buffer.alloc(44 + pcm.length);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(bits, 34);
  out.write("data", 36);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out.toString("base64");
}

async function generateScript(input) {
  const prompt = `You are an expert Burmese AI Audio Director and Video Dubbing Engine.
Create a timestamp-synchronized Burmese voiceover script for Gemini TTS.

USER INPUT:
Speaker Name: ${input.speakerName || "Narrator"}
Role: ${input.role || "Narrator"}
Scene: ${input.scene || ""}
Style: ${input.style || "cinematic, natural, expressive"}
Pacing: ${input.pacing || "medium"}
Burmese speaking tone: ${input.tone || "သဘာဝကျသော မြန်မာစကားပြောဟန်"}
Duration: ${input.duration || 60} seconds
Source / story text:
${input.story || ""}

OUTPUT EXACTLY in this structure:
AUDIO PROFILE
Name: ...
Role: ...

THE SCENE
...

DIRECTOR'S NOTES
* Style: ...
* Pacing: ...
* Tone: ...

TIMED TRANSCRIPT (VOICEOVER READY)
[00:00 - 00:05] [tag] Burmese speech...
...

Rules:
- Write natural spoken Burmese, not formal written Burmese.
- Use English inline audio tags such as [excited], [dramatic], [fast], [whispers], [laughs], [serious], [sighs], [gasp], [panicked].
- Keep timestamps sequential and cover the requested duration.
- Prefer 4–7 seconds per line.
- Do not add explanations outside the requested structure.`;

  const result = await gemini("interactions", {
    model: "gemini-3.6-flash",
    input: prompt
  });
  return result.output_text || "";
}

async function generateAudio(input) {
  const prompt = `Perform this Burmese voiceover transcript as a professional narrator.
Overall style: ${input.style || "cinematic, natural, expressive"}.
Pacing: ${input.pacing || "medium"}.
Speaking tone: ${input.tone || "natural spoken Burmese"}.
Respect the English audio tags embedded in the transcript. The tags are delivery directions and should not be spoken aloud.

Transcript:
${input.transcript}`;

  const result = await gemini("interactions", {
    model: "gemini-3.1-flash-tts-preview",
    input: prompt,
    response_format: { type: "audio" },
    generation_config: {
      speech_config: [{ voice: input.voice || "Kore" }]
    }
  });

  const audio = result?.output_audio?.data;
  if (!audio) throw new Error("Gemini returned no audio.");
  return pcmToWav(audio);
}

async function serveFile(res, pathname) {
  const safe = pathname === "/" ? "/index.html" : pathname;
  const file = public / safe.replace(/^\/+/, "");
  if (!existsSync(file)) return send(res, 404, "Not found", "text/plain");
  const ext = path.extname(file);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  send(res, 200, await readFile(file), types[ext] || "application/octet-stream");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET") return serveFile(res, url.pathname);

    if (req.method === "POST" && url.pathname === "/api/script") {
      const data = await body(req);
      const script = await generateScript(data);
      return send(res, 200, { script });
    }

    if (req.method === "POST" && url.pathname === "/api/audio") {
      const data = await body(req);
      const wavBase64 = await generateAudio(data);
      return send(res, 200, { audio: `data:audio/wav;base64,${wavBase64}` });
    }

    return send(res, 404, { error: "Route not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Burmese Gemini TTS app running at http://localhost:${PORT}`);
});