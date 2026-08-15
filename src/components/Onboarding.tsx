"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  type Gender,
  type WeightGoal,
  calculateRecommendedCalories,
  markOnboarded,
  saveProfile,
} from "@/lib/profile-store";

/**
 * 极简 Onboarding（Cal AI Style）：
 *   Step 1 性别 → Step 2 当前体重与目标 → Step 3 每日卡路里目标（自动推荐可微调）。
 */
export default function Onboarding({
  onComplete,
  onSkip,
}: {
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(1);
  const [gender, setGender] = useState<Gender>("female");
  const [weight, setWeight] = useState("60");
  const [height, setHeight] = useState("165");
  const [age, setAge] = useState("28");
  const [goal, setGoal] = useState<WeightGoal>("lose");
  const [calories, setCalories] = useState(1500);

  const recommended = useMemo(
    () =>
      calculateRecommendedCalories({
        gender,
        weightKg: Number(weight) || 60,
        goal,
        heightCm: Number(height) || 165,
        age: Number(age) || 28,
      }),
    [gender, weight, height, age, goal]
  );

  const finish = () => {
    const w = Math.max(30, Number(weight) || 60);
    const target = Math.max(1200, Number(calories) || recommended);
    saveProfile({
      gender,
      weightKg: w,
      goal,
      heightCm: Number(height) || undefined,
      age: Number(age) || undefined,
      dailyCalories: target,
    });
    markOnboarded();
    onComplete();
  };

  const canNext =
    (step === 1 && !!gender) ||
    (step === 2 && (Number(weight) || 0) >= 30) ||
    step === 3;

  return (
    <div className="modal-overlay onboarding-overlay">
      <div className="modal-content onboarding-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("onboarding_title")}</h2>
          <button className="modal-close" onClick={onSkip} aria-label={t("onboarding_skip")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="onboarding-progress">
          {[1, 2, 3].map((s) => (
            <span key={s} className={`onboarding-dot ${s <= step ? "active" : ""}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="onboarding-step">
            <p className="onboarding-label">{t("onboarding_gender")}</p>
            <div className="onboarding-options">
              {(["female", "male", "other"] as Gender[]).map((g) => (
                <button
                  key={g}
                  className={`onboarding-option ${gender === g ? "active" : ""}`}
                  onClick={() => setGender(g)}
                >
                  <span className="onboarding-option-icon">
                    {g === "female" ? "♀" : g === "male" ? "♂" : "✦"}
                  </span>
                  {t(`onboarding_gender_${g}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <p className="onboarding-label">{t("onboarding_weight")} (kg)</p>
            <input
              className="form-input onboarding-input"
              type="number"
              inputMode="decimal"
              min={30}
              max={300}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="60"
            />
            <p className="onboarding-label">{t("onboarding_goal")}</p>
            <div className="onboarding-options onboarding-options-col">
              {(["lose", "maintain", "gain"] as WeightGoal[]).map((g) => (
                <button
                  key={g}
                  className={`onboarding-option ${goal === g ? "active" : ""}`}
                  onClick={() => setGoal(g)}
                >
                  {t(`goal_${g}`)}
                </button>
              ))}
            </div>
            <div className="onboarding-meta-grid">
              <div className="form-group">
                <label className="form-label">{t("onboarding_height")} (cm)</label>
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  min={120}
                  max={230}
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t("onboarding_age")}</label>
                <input
                  className="form-input"
                  type="number"
                  inputMode="numeric"
                  min={14}
                  max={90}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <p className="onboarding-label">{t("onboarding_calories_title")}</p>
            <p className="onboarding-hint">{t("onboarding_calories_hint")}</p>
            <input
              className="form-input onboarding-input onboarding-cal-input"
              type="number"
              inputMode="numeric"
              min={1200}
              max={6000}
              value={calories}
              onChange={(e) => setCalories(Number(e.target.value))}
            />
            <p className="onboarding-recommended">
              {t("onboarding_recommended")}: <b>{recommended}</b> kcal
            </p>
            <button
              className="btn-link"
              onClick={() => setCalories(recommended)}
            >
              {t("onboarding_use_recommended")}
            </button>
          </div>
        )}

        <div className="onboarding-actions">
          {step > 1 && (
            <button className="btn-secondary onboarding-btn" onClick={() => setStep(step - 1)}>
              {t("admin_back_home")}
            </button>
          )}
          {step < 3 ? (
            <button
              className="btn-primary onboarding-btn onboarding-btn-primary"
              disabled={!canNext}
              onClick={() => setStep(step + 1)}
            >
              {t("onboarding_next")}
            </button>
          ) : (
            <button className="btn-primary onboarding-btn onboarding-btn-primary" onClick={finish}>
              {t("onboarding_start")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
