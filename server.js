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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  res.end(
    typeof data === "string"
      ? data
      : JSON.stringify(data)
  );
}

async function body(req) {
  let data = "";

  for await (const chunk of req) {
    data += chunk;
  }

  if (!data) return {};

  try {
    return JSON.parse(data);
  } catch {
    throw new Error("Invalid JSON request.");
  }
}

async function gemini(apiPath, payload) {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${apiPath}`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const text = await response.text();

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      parsed?.error?.message ||
      `Gemini API error ${response.status}`
    );
  }

  return parsed;
}

function pcmToWav(
  base64,
  sampleRate = 24000,
  channels = 1,
  bits = 16
) {
  const pcm = Buffer.from(base64, "base64");

  const byteRate =
    sampleRate * channels * bits / 8;

  const blockAlign =
    channels * bits / 8;

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

/* =========================
   SCRIPT GENERATOR
========================= */

async function generateScript(input) {
  const prompt = `
You are an expert Burmese AI Audio Director and Video Dubbing Engine.

Create a timestamp-synchronized Burmese voiceover script for Gemini TTS.

Speaker Name:
${input.speakerName || "Narrator"}

Role:
${input.role || "Narrator"}

Scene:
${input.scene || ""}

Style:
${input.style || "cinematic, natural, expressive"}

Pacing:
${input.pacing || "medium"}

Burmese speaking tone:
${input.tone || "သဘာဝကျသော မြန်မာစကားပြောဟန်"}

Duration:
${input.duration || 60} seconds

Source / story text:
${input.story || ""}

OUTPUT EXACTLY:

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
[00:05 - 00:10] [tag] Burmese speech...

RULES:

- Write natural spoken Burmese.
- Do not use overly formal Burmese.
- Use English audio tags such as:
  [excited]
  [dramatic]
  [fast]
  [whispers]
  [laughs]
  [serious]
  [sighs]
  [gasp]
  [panicked]

- Audio tags must NOT be spoken aloud.
- Keep timestamps sequential.
- Cover the requested duration.
- Prefer 4–7 seconds per line.
- Do not add explanations outside the requested structure.
`;

  const result = await gemini("interactions", {
    model: "gemini-3.6-flash",
    input: prompt
  });

  return result?.output_text || "";
}

/* =========================
   AUDIO GENERATOR
========================= */

async function generateAudio(input) {
  if (!input.transcript) {
    throw new Error("Transcript is required.");
  }

  const prompt = `
Perform this Burmese voiceover transcript
as a professional narrator.

Overall style:
${input.style || "cinematic, natural, expressive"}

Pacing:
${input.pacing || "medium"}

Speaking tone:
${input.tone || "natural spoken Burmese"}

The English audio tags are delivery directions.
DO NOT speak the tags aloud.

Transcript:

${input.transcript}
`;

  const result = await gemini("interactions", {
    model: "gemini-3.1-flash-tts-preview",
    input: prompt,
    response_format: {
      type: "audio"
    },
    generation_config: {
      speech_config: [
        {
          voice: input.voice || "Kore"
        }
      ]
    }
  });

  const audio =
    result?.output_audio?.data;

  if (!audio) {
    throw new Error("Gemini returned no audio.");
  }

  return pcmToWav(audio);
}

/* =========================
   SERVE WEBSITE
========================= */

async function serveFile(res, pathname) {
  const requestedPath =
    pathname === "/"
      ? "index.html"
      : pathname.replace(/^\/+/, "");

  if (requestedPath.includes("..")) {
    return send(
      res,
      403,
      "Forbidden",
      "text/plain; charset=utf-8"
    );
  }

  const filePath = path.join(
    process.cwd(),
    requestedPath
  );

  if (!existsSync(filePath)) {
    return send(
      res,
      404,
      "Not found",
      "text/plain; charset=utf-8"
    );
  }

  const ext =
    path.extname(filePath).toLowerCase();

  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };

  const file =
    await readFile(filePath);

  res.writeHead(200, {
    "Content-Type":
      types[ext] ||
      "application/octet-stream",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(file);
}

/* =========================
   SERVER
========================= */

const server = http.createServer(
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type"
        });

        return res.end();
      }

      const url = new URL(
        req.url,
        `http://${req.headers.host}`
      );

      /* Website */

      if (req.method === "GET") {
        return serveFile(
          res,
          url.pathname
        );
      }

      /* Generate Script */

      if (
        req.method === "POST" &&
        url.pathname === "/api/script"
      ) {
        const data = await body(req);

        const script =
          await generateScript(data);

        return send(res, 200, {
          success: true,
          script
        });
      }

      /* Generate Audio */

      if (
        req.method === "POST" &&
        url.pathname === "/api/audio"
      ) {
        const data = await body(req);

        const wavBase64 =
          await generateAudio(data);

        return send(res, 200, {
          success: true,
          audio:
            `data:audio/wav;base64,${wavBase64}`
        });
      }

      /* Health Check */

      if (
        req.method === "GET" &&
        url.pathname === "/api/health"
      ) {
        return send(res, 200, {
          status: "ok",
          gemini: Boolean(API_KEY),
          service: "Burmese Gemini TTS"
        });
      }

      return send(res, 404, {
        error: "Route not found"
      });

    } catch (error) {
      console.error(
        "SERVER ERROR:",
        error
      );

      return send(res, 500, {
        success: false,
        error:
          error?.message ||
          "Server error"
      });
    }
  }
);

/* =========================
   START
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Burmese Gemini TTS app running on port ${PORT}`
    );
  }
);
