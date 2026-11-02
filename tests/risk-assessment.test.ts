import { assert, assertEquals } from "@std/assert";
import {
  assessStudentRisk,
  getAtRiskStudents,
  getAtRiskStudentsByDepartment,
  summarizeRiskStatus,
} from "../src/analysis/risk-assessment.ts";
import type { Student } from "../src/types/academic.ts";
import {
  dataWithStudents,
  failedCourse,
  makeEnrollment,
  makeStudent,
  sampleData,
  sampleStudent,
} from "./helpers.ts";

const assess = (overrides: Partial<Student> = {}) =>
  assessStudentRisk(makeStudent(overrides), sampleData);

const inProgress = (
  courseId: string,
  midterm: number | null,
  attendance = 100,
) =>
  makeEnrollment({ course_id: courseId, midterm_score: midterm, attendance });

Deno.test("assessStudentRisk grades the sample students", () => {
  const expectedLevels: [string, string][] = [
    ["STU001", "normal"],
    ["STU002", "normal"],
    ["STU003", "critical"],
    ["STU004", "normal"],
    ["STU005", "warning"],
    ["STU006", "normal"],
  ];

  for (const [studentId, riskLevel] of expectedLevels) {
    assertEquals(
      assessStudentRisk(sampleStudent(studentId), sampleData).riskLevel,
      riskLevel,
      studentId,
    );
  }
});

Deno.test("assessStudentRisk finds nothing for a student with no courses", () => {
  const assessment = assess();

  assertEquals(assessment.riskLevel, "normal");
  assertEquals(assessment.factors, []);
  assertEquals(assessment.recommendations, []);
});

Deno.test("assessStudentRisk applies the GPA thresholds at their boundaries", () => {
  const expectedLevels: [number, string][] = [
    [1.49, "critical"],
    [1.5, "warning"],
    [1.99, "warning"],
    [2.0, "normal"],
  ];

  for (const [gpa, riskLevel] of expectedLevels) {
    assertEquals(assess({ gpa }).riskLevel, riskLevel, `GPA ${gpa}`);
  }
});

Deno.test("assessStudentRisk treats probation as critical even with a good GPA", () => {
  const assessment = assess({ gpa: 3.5, status: "probation" });

  assertEquals(assessment.riskLevel, "critical");
  assert(assessment.recommendations.length > 0);
});

Deno.test("assessStudentRisk gives warning status general advice when nothing else applies", () => {
  const assessment = assess({ status: "warning" });

  assertEquals(assessment.riskLevel, "warning");
  assert(assessment.recommendations.length > 0);
});

Deno.test("assessStudentRisk raises the level with the number of failing midterms", () => {
  const oneFailing = assess({ enrollments: [inProgress("CENG201", 49)] });
  const twoFailing = assess({
    enrollments: [inProgress("CENG201", 49), inProgress("MATH201", 10)],
  });

  assertEquals(oneFailing.riskLevel, "warning");
  assertEquals(twoFailing.riskLevel, "critical");
  assertEquals(twoFailing.factors.length, 2);
});

Deno.test("assessStudentRisk notes an at-risk midterm without raising the level", () => {
  const atRisk = assess({ enrollments: [inProgress("CENG201", 50)] });
  const passing = assess({ enrollments: [inProgress("CENG201", 60)] });

  assertEquals(atRisk.riskLevel, "normal");
  assertEquals(atRisk.factors.length, 1);
  assertEquals(passing.factors, []);
});

Deno.test("assessStudentRisk ignores a course with no midterm yet", () => {
  assertEquals(
    assess({ enrollments: [inProgress("CENG201", null)] }).factors,
    [],
  );
});

Deno.test("assessStudentRisk notes low attendance without raising the level", () => {
  const criticalAttendance = assess({
    enrollments: [inProgress("CENG201", 90, 69)],
  });
  const lowAttendance = assess({
    enrollments: [inProgress("CENG201", 90, 79)],
  });
  const fineAttendance = assess({
    enrollments: [inProgress("CENG201", 90, 80)],
  });

  assertEquals(criticalAttendance.riskLevel, "normal");
  assertEquals(criticalAttendance.factors.length, 1);
  assertEquals(criticalAttendance.recommendations.length, 1);
  assertEquals(lowAttendance.riskLevel, "normal");
  assertEquals(lowAttendance.factors.length, 1);
  assertEquals(lowAttendance.recommendations, []);
  assertEquals(fineAttendance.factors, []);
});

Deno.test("assessStudentRisk looks only at the current semester, not past failures", () => {
  assertEquals(
    assess({ enrollments: [failedCourse("MATH101")] }).factors,
    [],
  );
});

Deno.test("assessStudentRisk skips an enrollment in an unknown course", () => {
  assertEquals(
    assess({ enrollments: [inProgress("NOPE999", 10, 10)] }).factors,
    [],
  );
});

Deno.test("getAtRiskStudents lists only at-risk students, critical first", () => {
  const warningFirst = dataWithStudents(
    makeStudent({ id: "WARN", status: "warning" }),
    makeStudent({ id: "FINE" }),
    makeStudent({ id: "CRIT", status: "probation" }),
  );

  assertEquals(
    getAtRiskStudents(warningFirst).map((assessment) => assessment.studentId),
    ["CRIT", "WARN"],
  );
});

Deno.test("getAtRiskStudentsByDepartment filters by department", () => {
  const atRiskIds = (departmentId: string) =>
    getAtRiskStudentsByDepartment(sampleData, departmentId).map(
      (assessment) => assessment.studentId,
    );

  assertEquals(atRiskIds("CENG"), ["STU003", "STU005"]);
  assertEquals(atRiskIds("SENG"), []);
  assertEquals(atRiskIds("NOPE"), []);
});

Deno.test("summarizeRiskStatus counts students overall and by department", () => {
  assertEquals(summarizeRiskStatus(sampleData), {
    total: 6,
    critical: 1,
    warning: 1,
    normal: 4,
    byDepartment: {
      CENG: { critical: 1, warning: 1 },
      SENG: { critical: 0, warning: 0 },
    },
  });
});
