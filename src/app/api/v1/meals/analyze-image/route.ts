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
 * 如果均未配置，降级返回模拟数据（演示模式）。
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

    // Try Gemini Vision first
    if (geminiKey) {
      try {
        const result = await analyzeWithGemini(base64, mimeType, mealType, geminiKey);
        return NextResponse.json(result);
      } catch (err: any) {
        console.error("[Vision] Gemini failed:", err.message);
      }
    }

    // Fallback to OpenAI Vision
    if (openaiKey) {
      try {
        const result = await analyzeWithOpenAI(base64, mimeType, mealType, openaiKey);
        return NextResponse.json(result);
      } catch (err: any) {
        console.error("[Vision] OpenAI failed:", err.message);
      }
    }

    // No API key configured — return mock data for demo
    console.warn("[Vision] No API key configured, returning mock data");
    return NextResponse.json({
      count: 3,
      records: [
        { food: "白米饭", food_en: "White Rice", grams: 200, calories: 260, protein_g: 4, fat_g: 0.6, carbs_g: 58, confidence: 0.92, source_model: "mock", lang: "zh" },
        { food: "鸡胸肉", food_en: "Chicken Breast", grams: 150, calories: 247, protein_g: 46, fat_g: 5.3, carbs_g: 0, confidence: 0.88, source_model: "mock", lang: "zh" },
        { food: "西兰花", food_en: "Broccoli", grams: 100, calories: 34, protein_g: 2.8, fat_g: 0.4, carbs_g: 7, confidence: 0.95, source_model: "mock", lang: "zh" },
      ],
      model: { switched: false, provider: "mock" },
    });
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
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const records = JSON.parse(cleaned);

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
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const records = JSON.parse(cleaned);

  return {
    count: records.length,
    records: Array.isArray(records) ? records : [],
    model: { switched: false, provider: "openai" },
  };
}
