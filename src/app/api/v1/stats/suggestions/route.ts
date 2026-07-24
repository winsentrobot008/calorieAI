import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    suggestions: [
      { icon: "🥗", title: "增加蔬菜摄入", detail: "今日蔬菜摄入偏少，建议晚餐补充一份绿叶蔬菜。" },
      { icon: "💧", title: "记得补充水分", detail: "当前饮水 1.2L，建议每日达到 2L。" },
    ],
    model: { switched: false },
  });
}
