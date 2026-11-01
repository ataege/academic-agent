import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  calculateCourseStats,
  compareDepartments,
  getCourseGradeDistribution,
  getDepartmentStatistics,
  getInstitutionOverview,
  getProblemCourses,
} from "../src/analysis/department-stats.ts";
import {
  dataWithStudents,
  failedCourse,
  makeEnrollment,
  makeStudent,
  passedCourse,
  sampleData,
} from "./helpers.ts";

Deno.test("getDepartmentStatistics summarises the sample departments", () => {
  const computerEngineering = getDepartmentStatistics("CENG", sampleData);
  assertEquals(computerEngineering.departmentName, "Computer Engineering");
  assertEquals(computerEngineering.totalStudents, 4);
  assertAlmostEquals(computerEngineering.averageGPA, 2.55, 1e-9);
  assertEquals(computerEngineering.atRiskCount, 2);
  assertEquals(computerEngineering.probationCount, 1);
  assertEquals(computerEngineering.courseStats.length, 15);

  const softwareEngineering = getDepartmentStatistics("SENG", sampleData);
  assertEquals(softwareEngineering.totalStudents, 2);
  assertAlmostEquals(softwareEngineering.averageGPA, 3.025, 1e-9);
  assertEquals(softwareEngineering.atRiskCount, 0);
  assertEquals(softwareEngineering.probationCount, 0);
  assertEquals(softwareEngineering.courseStats.length, 8);
});

Deno.test("getDepartmentStatistics counts low GPA or warning status as at risk", () => {
  const stats = getDepartmentStatistics(
    "CENG",
    dataWithStudents(
      makeStudent({ gpa: 1.9 }),
      makeStudent({ gpa: 3.0, status: "warning" }),
      makeStudent({ gpa: 2.5, status: "probation" }),
      makeStudent({ gpa: 2.0 }),
    ),
  );

  assertEquals(stats.atRiskCount, 2);
  assertEquals(stats.probationCount, 1);
});

Deno.test("getDepartmentStatistics returns zeros for a department with no students", () => {
  const stats = getDepartmentStatistics("CENG", dataWithStudents());

  assertEquals(stats.totalStudents, 0);
  assertEquals(stats.averageGPA, 0);
  assertEquals(stats.atRiskCount, 0);
});

Deno.test("getDepartmentStatistics throws for an unknown department", () => {
  assertThrows(
    () => getDepartmentStatistics("NOPE", sampleData),
    Error,
    "NOPE",
  );
});

Deno.test("calculateCourseStats counts every attempt at a retaken course", () => {
  // MATH102: 7 completed attempts, 2 FF, including STU003's fail then pass
  const stats = calculateCourseStats("MATH102", sampleData);

  assertEquals(stats.courseName, sampleData.courses[1].name);
  assertEquals(stats.totalEnrollments, 7);
  assertAlmostEquals(stats.passRate, (5 / 7) * 100, 1e-9);
  assertAlmostEquals(stats.failRate, (2 / 7) * 100, 1e-9);
  assertAlmostEquals(stats.averageScore, 430.2 / 7, 1e-9);
  assertEquals(stats.atRiskCount, 1); // STU005 is retaking it with a 52 midterm
});

Deno.test("calculateCourseStats returns zeros when nobody has finished the course", () => {
  const stats = calculateCourseStats("CENG402", sampleData);

  assertEquals(stats.totalEnrollments, 0);
  assertEquals(stats.passRate, 0);
  assertEquals(stats.failRate, 0);
  assertEquals(stats.averageScore, 0);
});

Deno.test("calculateCourseStats ignores in-progress students in rates but not at-risk counts", () => {
  const inProgress = (midterm: number | null) =>
    makeStudent({
      enrollments: [
        makeEnrollment({ course_id: "CENG201", midterm_score: midterm }),
      ],
    });

  const stats = calculateCourseStats(
    "CENG201",
    dataWithStudents(inProgress(59), inProgress(60), inProgress(null)),
  );

  assertEquals(stats.totalEnrollments, 0);
  assertEquals(stats.failRate, 0);
  assertEquals(stats.atRiskCount, 1);
});

Deno.test("calculateCourseStats throws for an unknown course", () => {
  assertThrows(
    () => calculateCourseStats("NOPE999", sampleData),
    Error,
    "NOPE999",
  );
});

Deno.test("getInstitutionOverview summarises the sample institution", () => {
  const overview = getInstitutionOverview(sampleData);

  assertEquals(overview.universityName, "Tech University");
  assertEquals(overview.currentSemester, "2024-2025 Fall");
  assertEquals(overview.totalStudents, 6);
  assertAlmostEquals(overview.averageGPA, 16.25 / 6, 1e-9);
  assertEquals(overview.statusDistribution, {
    active: 4,
    warning: 1,
    probation: 1,
  });
  assertEquals(
    overview.departmentSummary.map((dept) => [dept.id, dept.studentCount]),
    [["CENG", 4], ["SENG", 2]],
  );
});

Deno.test("getInstitutionOverview copes with no students and no current semester", () => {
  const overview = getInstitutionOverview({
    ...dataWithStudents(),
    semesters: [],
  });

  assertEquals(overview.averageGPA, 0);
  assertEquals(overview.currentSemester, "Unknown");
  assertEquals(overview.departmentSummary[0].avgGPA, 0);
});

Deno.test("getProblemCourses sorts by fail rate and applies the threshold strictly", () => {
  const problemCourseIds = (threshold?: number) =>
    getProblemCourses(sampleData, threshold).map((course) => course.courseId);

  assertEquals(problemCourseIds(15), ["MATH102", "CENG102"]);
  assertEquals(problemCourseIds(), ["MATH102"]); // CENG102 is exactly 20%
});

Deno.test("getProblemCourses ignores courses with too few results to judge", () => {
  const twoFailures = dataWithStudents(
    makeStudent({ enrollments: [failedCourse("CENG201")] }),
    makeStudent({ enrollments: [failedCourse("CENG201")] }),
  );
  const threeFailures = dataWithStudents(
    ...twoFailures.students,
    makeStudent({ enrollments: [failedCourse("CENG201")] }),
  );

  assertEquals(getProblemCourses(twoFailures), []);
  assertEquals(
    getProblemCourses(threeFailures).map((course) => course.courseId),
    ["CENG201"],
  );
});

Deno.test("getCourseGradeDistribution counts completed grades only", () => {
  assertEquals(getCourseGradeDistribution("MATH102", sampleData), {
    BA: 1,
    FD: 2,
    FF: 2,
    CC: 1,
    DC: 1,
  });
  assertEquals(
    getCourseGradeDistribution(
      "CENG201",
      dataWithStudents(
        makeStudent({
          enrollments: [
            passedCourse("CENG201", "AA"),
            makeEnrollment({ course_id: "CENG201" }),
          ],
        }),
      ),
    ),
    { AA: 1 },
  );
  assertEquals(getCourseGradeDistribution("NOPE999", sampleData), {});
});

Deno.test("compareDepartments ranks departments by average GPA", () => {
  const { bestPerforming, needsAttention, comparison } = compareDepartments(
    sampleData,
  );

  assertEquals(bestPerforming, "SENG");
  assertEquals(needsAttention, "CENG");
  assertEquals(comparison.map((dept) => dept.atRiskPercentage), [50, 0]);
});

Deno.test("compareDepartments returns blanks with no departments", () => {
  assertEquals(compareDepartments({ ...sampleData, departments: [] }), {
    comparison: [],
    bestPerforming: "",
    needsAttention: "",
  });
});
