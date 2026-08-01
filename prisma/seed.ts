import { PrismaClient } from "@prisma/client";
import { embed } from "../src/lib/embedding";
import { dateOnlyToDate } from "../src/lib/contracts/store";
import { toDateStr } from "../src/lib/dates";

const prisma = new PrismaClient();

// 可复现的伪随机（LCG）：seed 固定 → 每次 db:reset 得到同一批演示数据，
// 便于对着同一组客流反复验证预测结果。
let _rngState = 20260717;
function rng(): number {
  _rngState = (_rngState * 1103515245 + 12345) & 0x7fffffff;
  return _rngState / 0x7fffffff;
}
function rngInt(min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}
// Box-Muller：标准正态
function rngNormal(mean: number, sd: number): number {
  const u = Math.max(rng(), 1e-9);
  const v = Math.max(rng(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const SHIFT_LIST = ["morning", "afternoon", "evening"] as const;
// PRD §4.1：早 0.8 / 午 1.2 / 晚 1.0
const SHIFT_FACTOR: Record<string, number> = {
  morning: 0.8,
  afternoon: 1.2,
  evening: 1.0,
};
// PRD §4.1：周一~周四 1.0，周五 1.2，周六/周日 1.5
function dowFactor(dow: number): number {
  if (dow === 5) return 1.2;
  if (dow === 0 || dow === 6) return 1.5;
  return 1.0;
}
const EVENT_LABELS: Array<{ label: string; factor: number }> = [
  { label: "promo", factor: 1.3 },
  { label: "new_arrival", factor: 1.15 },
  { label: "holiday", factor: 1.4 },
];

// 测试数据：2 个门店、每店 5 名员工 + 1 名经理，另加 1 名系统管理员。
// 登录：任意下方手机号 + 固定验证码 123456。

const STORE_A_EMPLOYEES = ["小王", "小李", "小张", "小赵", "小孙"];
const STORE_B_EMPLOYEES = ["小周", "小吴", "小郑", "小冯", "小陈"];

// 预置业务规则库（RAG 知识来源）。内容尽量覆盖 AI 助手 / 审批合规常见问题。
const RULES: Array<{ title: string; category: string; content: string }> = [
  {
    title: "年假制度",
    category: "leave",
    content:
      "员工入职满一年可享受年假，标准额度为每年 10 天（按 80 小时计）。年假需提前至少 1 天在系统「请假」页面提交申请，选择「年假」类型，可按全天或时段申请，系统自动计算时长并从年假余额中扣减。年假余额不足时无法提交。",
  },
  {
    title: "病假制度",
    category: "leave",
    content:
      "员工因病无法出勤可申请病假，在「请假」页面选择「病假」类型。连续病假超过 3 天（24 小时）需提供医疗证明或填写事由，否则审批时会被标记为存疑。病假额度为每年 5 天（40 小时）。",
  },
  {
    title: "请假申请流程",
    category: "leave",
    content:
      "请假流程：员工在「请假」页面发起申请（选择年假或病假、全天或时段、起止时间）→ 提交后进入待审批状态 → 店铺经理在「审批」页面查看并通过或驳回。审批通过前请假不生效。",
  },
  {
    title: "查询假期余额",
    category: "leave",
    content:
      "员工可通过 AI 助手询问「我还有多少年假」查看当前年假与病假余额，也可在请假页面查看。余额以小时为单位，8 小时约等于 1 个工作日。",
  },
  {
    title: "打卡规则",
    category: "attendance",
    content:
      "员工到岗后，在「打卡」页面输入店铺经理当场展示的 6 位动态码，并选择上班或下班方向。动态码按当前门店和时间窗口生成，员工不能自行选择或切换门店；系统记录打卡时间、方向和来源。当前 Web 范围不提供地理围栏或一次性码，动态码不代表物理在店证明。",
  },
  {
    title: "排班规则",
    category: "schedule",
    content:
      "门店按周排班，分早班（09:00-13:00）、午班（13:00-17:00）、晚班（17:00-21:00）三个班次。排班需满足：请假期间不排班、每人每周工时不超过 40 小时、两个班次之间至少间隔 8 小时。经理可手动排班，也可使用 AI 智能排班推荐（由优化引擎计算）。",
  },
  {
    title: "AI 智能排班说明",
    category: "schedule",
    content:
      "AI 智能排班由优化引擎计算，保证满足硬约束并尽量满足人数需求。经理可用自然语言描述偏好（如“这周多给小王排早班”），系统解析为软约束交给引擎，算完后给出自然语言解释。排班结果不足以覆盖需求时会提示人数缺口。",
  },
  {
    title: "加班与工时上限",
    category: "schedule",
    content:
      "每名员工每周排班工时上限默认为 40 小时，可由管理员配置。系统在排班时强制不超过该上限；如门店需求超过现有人手上限，系统会返回人数缺口提示，需经理协调加班或调配人手。",
  },
];

export async function seedDatabase() {
  _rngState = 20260717;
  console.log("清理旧数据...");
  await prisma.aiInteractionLog.deleteMany();
  await prisma.monthlyAttendanceAuditEvent.deleteMany();
  await prisma.monthlyAttendanceConfirmation.deleteMany();
  await prisma.attendanceAuditEvent.deleteMany();
  await prisma.attendanceExceptionConfirmation.deleteMany();
  await prisma.attendancePunchState.deleteMany();
  await prisma.shiftSwapRequest.deleteMany();
  await prisma.punchCorrection.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.trafficForecast.deleteMany();
  await prisma.scheduleImportBatch.deleteMany();
  await prisma.schedulePlan.deleteMany();
  await prisma.unavailableSlot.deleteMany();
  await prisma.trafficRecord.deleteMany();
  await prisma.storeEvent.deleteMany();
  await prisma.v2SConfig.deleteMany();
  await prisma.minStaffingConfig.deleteMany();
  await prisma.storeOperatingDay.deleteMany();
  await prisma.workGroupMember.deleteMany();
  await prisma.workGroup.deleteMany();
  await prisma.workArea.deleteMany();
  await prisma.ruleChunk.deleteMany();
  await prisma.user.deleteMany();
  await prisma.store.deleteMany();

  console.log("创建门店...");
  const storeA = await prisma.store.create({
    data: {
      id: "store-wangjing",
      name: "望京旗舰店",
      code: "WJ",
      address: "北京市朝阳区望京路 1 号",
      active: true,
    },
  });
  const storeB = await prisma.store.create({
    data: {
      id: "store-zhongguancun",
      name: "中关村店",
      code: "ZG",
      address: "北京市海淀区中关村大街 2 号",
      active: true,
    },
  });

  console.log("创建营业日配置...");
  for (const store of [storeA, storeB]) {
    await prisma.storeOperatingDay.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        storeId: store.id,
        dayOfWeek,
        isOpen: dayOfWeek !== 0,
        openTime: "09:00",
        closeTime: "21:00",
      })),
    });
  }

  console.log("创建管理员...");
  await prisma.user.create({
    data: {
      id: "user-admin",
      phone: "13900000000",
      name: "系统管理员",
      role: "admin",
      storeId: null,
    },
  });

  console.log("创建经理与员工...");
  const managerA = await prisma.user.create({
    data: {
      id: "user-manager-wangjing",
      phone: "13800000001",
      name: "李经理",
      role: "manager",
      storeId: storeA.id,
      lastWeekHours: 0,
    },
  });
  const managerB = await prisma.user.create({
    data: {
      id: "user-manager-zhongguancun",
      phone: "13800000002",
      name: "王经理",
      role: "manager",
      storeId: storeB.id,
      lastWeekHours: 0,
    },
  });

  const seedEmployees = async (
    storeId: string,
    names: string[],
    phonePrefix: string,
    employeePrefix: string
  ) => {
    const employees = [];
    for (let i = 0; i < names.length; i++) {
      // 前 2 人收银，其余销售（PRD §2.1 两层模型：店长/管理员无岗位）
      const position = i < 2 ? "cashier" : "sales";
      const parttime = i === names.length - 1; // 每店 1 名兼职，周上限 24h
      const hire = i === 0
        ? new Date(2026, 4, 1)
        : new Date(2020 + i, i, i + 1);
      employees.push(await prisma.user.create({
        data: {
          id: `user-employee-${employeePrefix.toLowerCase()}-${String(i + 1).padStart(2, "0")}`,
          phone: `${phonePrefix}${String(i + 1).padStart(2, "0")}`,
          employeeNo: `${employeePrefix}-${String(i + 1).padStart(3, "0")}`,
          name: names[i],
          role: "employee",
          storeId,
          position,
          hireDate: hire,
          employmentType: parttime ? "parttime" : "fulltime",
          maxWeeklyHours: parttime ? 24 : 40,
          salesAbility: position === "cashier" ? "none" : (["high", "mid", "mid", "low"][i % 4] as string),
          performanceBand: (["always", "frequently", "frequently", "almost_always", "sometimes"][i % 5] as string),
          // 保留字段但不再决定业务值：上周工时由 scheduleBuild 从上周 Schedule 回算（T9）
          lastWeekHours: 0,
          annualLeaveBalance: 80,
          sickLeaveBalance: 40,
        },
      }));
    }
    return employees;
  };
  const employeesA = await seedEmployees(storeA.id, STORE_A_EMPLOYEES, "138100000", "WJ");
  const employeesB = await seedEmployees(storeB.id, STORE_B_EMPLOYEES, "138200000", "ZG");

  console.log("创建下周排班计划与 Task 7 演示数据...");
  await prisma.schedulePlan.createMany({
    data: [
      {
        id: "plan-wangjing-2026-07-20",
        storeId: storeA.id,
        weekOf: "2026-07-20",
        mode: "work5rest2",
        status: "published",
        version: 1,
        createdById: managerA.id,
        publishedAt: new Date("2026-07-19T08:00:00+08:00"),
      },
      {
        id: "plan-zhongguancun-2026-07-20",
        storeId: storeB.id,
        weekOf: "2026-07-20",
        mode: "work5rest2",
        status: "draft",
        version: 0,
        createdById: managerB.id,
      },
    ],
  });

  const task7Date = dateOnlyToDate("2026-07-20");
  await prisma.schedule.createMany({
    data: [
      {
        id: "seed-schedule-wj-01-morning",
        storeId: storeA.id,
        userId: employeesA[0].id,
        date: task7Date,
        shiftType: "morning",
        weekOf: "2026-07-20",
        source: "manual",
        planId: "plan-wangjing-2026-07-20",
      },
      {
        id: "seed-schedule-wj-02-morning",
        storeId: storeA.id,
        userId: employeesA[1].id,
        date: task7Date,
        shiftType: "morning",
        weekOf: "2026-07-20",
        source: "manual",
        planId: "plan-wangjing-2026-07-20",
      },
    ],
  });
  await prisma.punchCorrection.createMany({
    data: [
      {
        id: "seed-approved-correction-wj-02",
        userId: employeesA[1].id,
        date: task7Date,
        direction: "in",
        requestedTime: new Date("2026-07-20T09:00:00+08:00"),
        reason: "漏打上班卡",
        status: "approved",
        createdAt: new Date("2026-07-19T16:30:00+08:00"),
        decidedById: managerA.id,
        decidedAt: new Date("2026-07-19T18:00:00+08:00"),
        decisionReason: "已核对门店记录",
      },
      {
        id: "seed-proxy-correction-wj-01",
        userId: employeesA[0].id,
        date: dateOnlyToDate("2026-07-21"),
        direction: "in",
        requestedTime: new Date("2026-07-21T09:00:00+08:00"),
        reason: "店长代提交漏打卡",
        status: "pending",
        createdAt: new Date("2026-07-19T16:49:02+08:00"),
      },
    ],
  });
  await prisma.attendanceRecord.createMany({
    data: [
      {
        id: "seed-attendance-wj-01-in",
        userId: employeesA[0].id,
        storeId: storeA.id,
        time: new Date("2026-07-20T09:10:00+08:00"),
        direction: "in",
        viaCode: true,
        corrected: false,
        clockWindow: "seed-wj-01-20260720-0910",
      },
      {
        id: "seed-attendance-wj-01-out",
        userId: employeesA[0].id,
        storeId: storeA.id,
        time: new Date("2026-07-20T12:50:00+08:00"),
        direction: "out",
        viaCode: true,
        corrected: false,
        clockWindow: "seed-wj-01-20260720-1250",
      },
      {
        id: "seed-attendance-wj-02-correction-in",
        userId: employeesA[1].id,
        storeId: storeA.id,
        time: new Date("2026-07-20T09:00:00+08:00"),
        direction: "in",
        viaCode: false,
        corrected: true,
      },
    ],
  });
  await prisma.leaveRequest.create({
    data: {
      id: "seed-proxy-leave-wj-01",
      userId: employeesA[0].id,
      type: "annual",
      startTime: new Date("2026-07-22T09:00:00+08:00"),
      endTime: new Date("2026-07-22T13:00:00+08:00"),
      isFullDay: false,
      hours: 4,
      reason: "店长代提交年假",
      status: "pending",
      createdAt: new Date("2026-07-19T16:49:02+08:00"),
    },
  });
  await prisma.attendanceExceptionConfirmation.createMany({
    data: [
      {
        id: "seed-exception-wj-01-late",
        storeId: storeA.id,
        userId: employeesA[0].id,
        date: task7Date,
        type: "late",
        status: "confirmed",
        active: true,
        revision: 2,
        confirmedById: managerA.id,
        confirmedAt: new Date("2026-07-20T13:30:00+08:00"),
      },
      {
        id: "seed-exception-wj-01-early-leave",
        storeId: storeA.id,
        userId: employeesA[0].id,
        date: task7Date,
        type: "early_leave",
        status: "unconfirmed",
        active: true,
        revision: 1,
      },
    ],
  });

  console.log("创建工作区域、工作组与成员有效期...");
  for (const [store, manager, employees, prefix] of [
    [storeA, managerA, employeesA, "WJ"],
    [storeB, managerB, employeesB, "ZG"],
  ] as const) {
    const floor = await prisma.workArea.create({
      data: {
        id: `area-${prefix.toLowerCase()}-floor`,
        storeId: store.id,
        name: "卖场",
        code: "FLOOR",
        active: true,
      },
    });
    const checkout = await prisma.workArea.create({
      data: {
        id: `area-${prefix.toLowerCase()}-checkout`,
        storeId: store.id,
        name: "收银区",
        code: "CHECKOUT",
        active: true,
      },
    });
    const traffic = await prisma.workGroup.create({
      data: {
        id: `group-${prefix.toLowerCase()}-traffic`,
        storeId: store.id,
        name: "客流组",
        leaderId: manager.id,
        volumeType: "traffic",
        active: true,
      },
    });
    const delivery = await prisma.workGroup.create({
      data: {
        id: `group-${prefix.toLowerCase()}-delivery`,
        storeId: store.id,
        name: "交付组",
        leaderId: manager.id,
        volumeType: "delivery",
        active: true,
      },
    });
    for (let i = 0; i < employees.length; i++) {
      await prisma.workGroupMember.create({
        data: {
          id: `membership-${prefix.toLowerCase()}-${String(i + 1).padStart(2, "0")}`,
          workGroupId: i < 3 ? traffic.id : delivery.id,
          userId: employees[i].id,
          workAreaId: employees[i].position === "cashier" ? checkout.id : floor.id,
          effectiveFrom: new Date(2026, 0, 1),
          effectiveTo: null,
        },
      });
    }
  }

  console.log("创建最低人力配置...");
  // TODO(T11): seed 将全量重写（10 店 + 客流仿真 + 活动日历），此处为 T2 的最小可跑通版本
  const shifts = ["morning", "afternoon", "evening"] as const;
  for (const store of [storeA, storeB]) {
    for (let dow = 0; dow <= 6; dow++) {
      const isWeekend = dow === 0 || dow === 6;
      for (const s of shifts) {
        // 收银各班次 1 人；销售各班次 2 人，周末 +1
        for (const position of ["cashier", "sales"] as const) {
          await prisma.minStaffingConfig.create({
            data: {
              storeId: store.id,
              dayOfWeek: dow,
              timeSlot: s,
              position,
              minHeadcount: position === "cashier" ? 1 : isWeekend ? 3 : 2,
            },
          });
        }
      }
    }
  }

  console.log("创建 V2S 折算配置...");
  // PRD §3.1.1 默认值：周一~周四 30/60，周五 35/70，周末 40/80
  for (const store of [storeA, storeB]) {
    for (let dow = 0; dow <= 6; dow++) {
      const [lower, upper] =
        dow === 0 || dow === 6 ? [40, 80] : dow === 5 ? [35, 70] : [30, 60];
      await prisma.v2SConfig.create({
        data: { storeId: store.id, dayOfWeek: dow, v2sLower: lower, v2sUpper: upper },
      });
    }
  }

  console.log("创建活动日历...");
  // 历史 8 周内撒 2~3 条（让历史客流带上事件效应），未来 4 周内撒 3~5 条
  const thisMonday = new Date("2026-07-13T00:00:00");
  const eventFactorByKey = new Map<string, number>(); // storeId_YYYY-MM-DD -> factor
  for (const store of [storeA, storeB]) {
    const picks: Array<{ offsetDay: number }> = [];
    for (let i = 0; i < rngInt(2, 3); i++) picks.push({ offsetDay: -rngInt(1, 56) });
    for (let i = 0; i < rngInt(3, 5); i++) picks.push({ offsetDay: rngInt(0, 27) });
    for (const p of picks) {
      const d = new Date(thisMonday);
      d.setDate(d.getDate() + p.offsetDay);
      const ev = EVENT_LABELS[rngInt(0, EVENT_LABELS.length - 1)];
      const key = `${store.id}_${toDateStr(d)}`;
      if (eventFactorByKey.has(key)) continue; // 同店同日只保留一个活动，避免系数叠加
      eventFactorByKey.set(key, ev.factor);
      await prisma.storeEvent.create({
        data: {
          storeId: store.id,
          date: new Date(toDateStr(d) + "T00:00:00"),
          label: ev.label,
          factor: ev.factor,
        },
      });
    }
  }

  console.log("生成 8 周历史客流（PRD §4.1 公式）...");
  for (const store of [storeA, storeB]) {
    const base = rngInt(80, 150); // 每店基线客流
    const rows: Array<{
      storeId: string;
      date: Date;
      timeSlot: string;
      visitors: number;
    }> = [];
    // 过去 8 周（56 天），截止到上周日
    for (let back = 56; back >= 1; back--) {
      const d = new Date(thisMonday);
      d.setDate(d.getDate() - back);
      const ds = toDateStr(d);
      const event = eventFactorByKey.get(`${store.id}_${ds}`) ?? 1.0;
      for (const s of SHIFT_LIST) {
        const raw =
          base * dowFactor(d.getDay()) * SHIFT_FACTOR[s] * event * rngNormal(1, 0.1);
        rows.push({
          storeId: store.id,
          date: new Date(ds + "T00:00:00"),
          timeSlot: s,
          visitors: Math.max(0, Math.floor(raw)), // 向下取整且 ≥0
        });
      }
    }
    await prisma.trafficRecord.createMany({ data: rows });
    console.log(`  ${store.name}：base=${base}，${rows.length} 条客流`);
  }

  console.log("写入 RAG 规则库并计算 embedding...");
  for (const r of RULES) {
    const vec = await embed(r.title + "。" + r.content);
    await prisma.ruleChunk.create({
      data: {
        title: r.title,
        category: r.category,
        content: r.content,
        embedding: JSON.stringify(vec),
      },
    });
  }

  console.log("\n完成！测试账号（验证码均为 123456）：");
  console.log("  管理员:        13900000000");
  console.log("  望京店经理:    13800000001（李经理）");
  console.log("  望京店员工:    13810000001 ~ 13810000005（小王/小李/小张/小赵/小孙）");
  console.log("  中关村店经理:  13800000002（王经理）");
  console.log("  中关村店员工:  13820000001 ~ 13820000005（小周/小吴/小郑/小冯/小陈）");
}

if (!process.env.VITEST) {
  seedDatabase()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
