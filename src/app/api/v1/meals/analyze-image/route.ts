import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    count: 3,
    records: [
      { food: "白米饭", food_en: "White Rice", grams: 200, calories: 260, protein_g: 4, fat_g: 0.6, carbs_g: 58, confidence: 0.92, source_model: "gpt-4o", lang: "zh" },
      { food: "鸡胸肉", food_en: "Chicken Breast", grams: 150, calories: 247, protein_g: 46, fat_g: 5.3, carbs_g: 0, confidence: 0.88, source_model: "gpt-4o", lang: "zh" },
      { food: "西兰花", food_en: "Broccoli", grams: 100, calories: 34, protein_g: 2.8, fat_g: 0.4, carbs_g: 7, confidence: 0.95, source_model: "gpt-4o", lang: "zh" },
    ],
    model: { switched: false },
  });
}
