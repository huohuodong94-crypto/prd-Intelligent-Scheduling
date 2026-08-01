"use client";

import Link from "next/link";
import { useState } from "react";

import { Btn, PageHeader, Panel, StepBar } from "@/components/ui";
import type { SchedulePlanSummary } from "@/lib/contracts/scheduling";
import PrepareStep from "./PrepareStep";
import ForecastStep from "./ForecastStep";
import StaffingStep from "./StaffingStep";
import GenerateStep from "./GenerateStep";

type InitialData = {
  plan: SchedulePlanSummary;
  activeStep?: number;
};

const STEPS = ["排班准备", "业务预测", "人力预测", "自动排班"];

export default function ScheduleWizardPage({
  planId,
  readOnly,
  initialData,
}: {
  planId: string;
  readOnly: boolean;
  initialData?: InitialData;
}) {
  // 向导客户端只保存当前步骤；计划、预测、人力与推荐都以服务端为准。
  const [activeStep, setActiveStep] = useState(initialData?.activeStep ?? 0);

  return (
    <div className="space-y-3">
      <PageHeader
        crumbs={["劳动力管理", "排班管理", "排班计划", planId]}
        title={readOnly ? "查看排班计划" : "四步排班向导"}
        extra={<Link href="/schedule/plans"><Btn>返回计划列表</Btn></Link>}
      />
      <Panel className="px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <StepBar steps={STEPS} active={activeStep} />
          <div className="flex gap-1">{STEPS.map((step, index) => <Btn key={step} size="sm" disabled={activeStep === index} onClick={() => setActiveStep(index)}>{index + 1}</Btn>)}</div>
        </div>
        <div className="mt-2 text-[11px] text-[var(--text-muted)]">固定三班：09:00–13:00、13:00–17:00、17:00–21:00。管理员仅可查看，所有修改只允许所属门店店长执行。</div>
      </Panel>

      {activeStep === 0 && <PrepareStep planId={planId} readOnly={readOnly} onNext={() => setActiveStep(1)} />}
      {activeStep === 1 && <ForecastStep planId={planId} readOnly={readOnly} onPrev={() => setActiveStep(0)} onNext={() => setActiveStep(2)} />}
      {activeStep === 2 && <StaffingStep planId={planId} onBackToForecast={() => setActiveStep(1)} onNext={() => setActiveStep(3)} />}
      {activeStep === 3 && <GenerateStep planId={planId} readOnly={readOnly} onPrev={() => setActiveStep(2)} />}
    </div>
  );
}
