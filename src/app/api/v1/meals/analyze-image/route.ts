import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/v1/meals/analyze-image
 *
 * 接收上传的食物图片，将其 Base64 编码后发送给视觉 AI 模型识别。
 *
 * 支持的环境变量（按优先级）:
 *   - GEMINI_API_KEY       → Google Gemini Vision
 *   - OPENAI_API_KEY       → OpenAI GPT-4o Vision
 *
 * 如果均未配置或全部调用失败，返回明确错误（NO_VISION_KEY / VISION_PROVIDER_ERROR），
 * 不再返回固定 Mock 数据，避免把演示数据误当真实识别结果。
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mealType = formData.get("meal_type")?.toString() || "unknown";

    if (!file) {
      return NextResponse.json({ detail: "请上传图片文件" }, { status: 400 });
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ detail: "不支持的图片格式，请上传 JPEG/PNG/WebP" }, { status: 400 });
    }

    // Read file as base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const mimeType = file.type;

    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // Try Gemini Vision first, then OpenAI；任一成功即返回真实识别结果
    let lastError: Error | null = null;

    if (geminiKey) {
      try {
        const result = await analyzeWithGemini(base64, mimeType, mealType, geminiKey);
        return NextResponse.json(result);
      } catch (err: any) {
        lastError = err;
        console.error("[Vision] Gemini failed:", err.message);
      }
    }

    // Fallback to OpenAI Vision
    if (openaiKey) {
      try {
        const result = await analyzeWithOpenAI(base64, mimeType, mealType, openaiKey);
        return NextResponse.json(result);
      } catch (err: any) {
        lastError = err;
        console.error("[Vision] OpenAI failed:", err.message);
      }
    }

    // 全部提供商失败：返回可诊断错误，绝不静默回退到固定 Mock 数据
    if (lastError) {
      console.error("[Vision] All providers failed:", lastError.message);
      return NextResponse.json(
        { detail: "AI 视觉识别失败: " + lastError.message, code: "VISION_PROVIDER_ERROR" },
        { status: 502 }
      );
    }

    // 无任何密钥：明确报错（NO_VISION_KEY），不再返回固定 Mock 的白米饭
    console.warn("[Vision] No API key configured (GEMINI_API_KEY / OPENAI_API_KEY)");
    return NextResponse.json(
      { detail: "未配置 AI 视觉密钥（GEMINI_API_KEY / OPENAI_API_KEY），无法识图", code: "NO_VISION_KEY" },
      { status: 503 }
    );
  } catch (error: any) {
    console.error("[Vision Error]", error);
    return NextResponse.json({ detail: "图像分析失败: " + error.message }, { status: 500 });
  }
}

/**
 * 使用 Google Gemini API 分析食物图片
 */
async function analyzeWithGemini(
  base64: string,
  mimeType: string,
  mealType: string,
  apiKey: string
) {
  const prompt = `你是一位专业的营养师。请分析这张食物照片，返回 JSON 数组格式的食物列表。
每个对象包含: food(中文名), food_en(英文名), grams(估计份量克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
餐次类型: ${mealType}
只返回 JSON 数组，不要其他文字。`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const records = parseRecords(text);

  return {
    count: records.length,
    records: Array.isArray(records) ? records : [],
    model: { switched: false, provider: "gemini" },
  };
}

/**
 * 使用 OpenAI GPT-4o Vision API 分析食物图片
 */
async function analyzeWithOpenAI(
  base64: string,
  mimeType: string,
  mealType: string,
  apiKey: string
) {
  const prompt = `你是一位专业的营养师。请分析这张食物照片，返回 JSON 数组格式的食物列表。
每个对象包含: food(中文名), food_en(英文名), grams(估计份量克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
餐次类型: ${mealType}
只返回 JSON 数组，不要其他文字。`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "[]";
  const records = parseRecords(text);

  return {
    count: records.length,
    records: Array.isArray(records) ? records : [],
    model: { switched: false, provider: "openai" },
  };
}

/**
 * 稳健解析 AI 返回的食物 JSON 数组：
 * 支持纯 JSON、Markdown 代码块包裹，以及前后附带说明文字的场景；
 * 无法解析时抛出明确错误，交由上层返回可诊断的 502。
 */
function parseRecords(text: string): any[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const tryParse = (raw: string): any[] | null => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleaned);
  if (direct !== null) return direct;

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted !== null) return extracted;
  }

  throw new Error("AI 返回内容无法解析为食物 JSON 数组");
}
