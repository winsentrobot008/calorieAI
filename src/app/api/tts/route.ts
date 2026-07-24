import { NextRequest, NextResponse } from "next/server";

/**
 * Edge-TTS API Route
 *
 * 接收文本内容，通过 Microsoft Edge 的 TTS 服务合成语音，返回 audio/mpeg 音频流。
 * 支持 Vercel Edge Runtime（无服务器函数），开箱即用。
 *
 * POST /api/tts
 * Body: { text: string; voice?: string }
 *
 * 可用中文语音:
 *   - zh-CN-XiaoxiaoNeural (女声, 默认)
 *   - zh-CN-YunxiNeural   (男声)
 *   - zh-CN-YunyangNeural (男声, 新闻)
 */
export async function POST(request: NextRequest) {
  try {
    const { text, voice = "zh-CN-XiaoxiaoNeural" } = await request.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "\u8BF7\u63D0\u4F9B\u6709\u6548\u7684\u6587\u672C\u5185\u5BB9" }, { status: 400 });
    }

    if (text.length > 1000) {
      return NextResponse.json({ error: "\u6587\u672C\u957F\u5EA6\u4E0D\u80FD\u8D85\u8FC7 1000 \u4E2A\u5B57\u7B26" }, { status: 400 });
    }

    // Build SSML request for Edge TTS
    const escapedText = escapeXml(text.trim());
    const voiceAttr = 'voice name="' + voice + '"';
    const ssml =
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">\n' +
      '  <' + voiceAttr + '>' + escapedText + '</voice>\n' +
      '</speak>';

    const ttsResponse = await fetch(
      "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1",
      {
        method: "POST",
        headers: {
          "User-Agent": "CalorieAI",
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
          "Ocp-Apim-Subscription-Key": process.env.TTS_SUBSCRIPTION_KEY || "",
        },
        body: ssml,
      }
    );

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      console.error("[TTS Error]", ttsResponse.status, errorText);

      // Fallback: if no API Key configured, return simulated audio (demo mode)
      if (ttsResponse.status === 401 || ttsResponse.status === 403) {
        return generateFallbackAudio(text.trim());
      }

      return NextResponse.json(
        { error: "\u8BED\u97F3\u5408\u6210\u5931\u8D25: " + ttsResponse.status },
        { status: ttsResponse.status }
      );
    }

    const audioBuffer = await ttsResponse.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("[TTS Error]", error);
    return generateFallbackAudio("\u8BED\u97F3\u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
  }
}

/**
 * Generate simulated audio (sine wave WAV) for demo / fallback scenarios.
 * Works in Vercel deployment without Azure TTS Key configured.
 */
async function generateFallbackAudio(text: string): Promise<NextResponse> {
  const sampleRate = 24000;
  const durationSec = Math.max(2, Math.min(text.length * 0.15, 15));
  const numSamples = Math.floor(sampleRate * durationSec);

  // Generate sine wave with fade in/out
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples);
    const freq = 220 + Math.sin(t * 0.5) * 60;
    samples[i] = Math.floor(
      Math.sin(2 * Math.PI * freq * t) * 8000 * envelope
    );
  }

  // Build WAV header + PCM data
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  const dataSize = numSamples * 2;

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const wavBuffer = new Uint8Array(44 + dataSize);
  wavBuffer.set(new Uint8Array(wavHeader), 0);
  wavBuffer.set(new Uint8Array(samples.buffer), 44);

  return new NextResponse(wavBuffer, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": wavBuffer.length.toString(),
      "X-TTS-Fallback": "true",
    },
  });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * XML escaping - uses a replacement map to avoid HTML entity encoding issues
 */
function escapeXml(str: string): string {
  const amp = String.fromCharCode(38); // &
  const lt = String.fromCharCode(60);  // <
  const gt = String.fromCharCode(62);  // >
  const quot = String.fromCharCode(34); // "
  const apos = String.fromCharCode(39); // '

  const map: Record<string, string> = {};
  map[amp] = amp + "amp;";
  map[lt] = amp + "lt;";
  map[gt] = amp + "gt;";
  map[quot] = amp + "quot;";
  map[apos] = amp + "apos;";

  return str.replace(/[&<>"']/g, (ch) => map[ch] || ch);
}
