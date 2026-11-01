import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  calculateGraduationProgress,
  checkGraduationEligibility,
  getGraduationTimeline,
  getRecommendedNextCourses,
} from "../src/analysis/graduation.ts";
import {
  failedCourse,
  makeEnrollment,
  makeStudent,
  passedCourse,
  sampleData,
  sampleStudent,
} from "./helpers.ts";

const recommendedIds = (
  ...args: Parameters<typeof getRecommendedNextCourses>
) => getRecommendedNextCourses(...args).map((course) => course.id);

Deno.test("calculateGraduationProgress reports a sample student's requirements", () => {
  const progress = calculateGraduationProgress(
    sampleStudent("STU001"),
    sampleData,
  );

  assertEquals(progress.department, "Computer Engineering");
  assertEquals(progress.completedRequired, [
    "CENG101",
    "CENG102",
    "CENG201",
    "CENG202",
    "MATH101",
    "MATH102",
    "MATH201",
  ]);
  assertEquals(progress.remainingRequired, [
    "CENG301",
    "CENG302",
    "CENG401",
    "CENG402",
  ]);
  assertEquals(progress.electiveCredits, 3); // MATH202 isn't required for CENG
  assertEquals(progress.electiveCreditsNeeded, 15);
  assertEquals(progress.creditsRemaining, 68);
  assertEquals(progress.estimatedSemesters, 4);
  assertEquals(progress.gpaStatus, "meets");
});

Deno.test("calculateGraduationProgress handles a student with no completed courses", () => {
  const progress = calculateGraduationProgress(makeStudent(), sampleData);

  assertEquals(progress.completedRequired, []);
  assertEquals(progress.remainingRequired.length, 11);
  assertEquals(progress.electiveCredits, 0);
  assertEquals(progress.electiveCreditsNeeded, 18);
  assertEquals(progress.creditsRemaining, 140);
  assertEquals(progress.estimatedSemesters, 8);
});

Deno.test("calculateGraduationProgress doesn't count failed or in-progress courses", () => {
  const student = makeStudent({
    enrollments: [
      failedCourse("MATH101"),
      makeEnrollment({ course_id: "CENG101" }),
    ],
  });

  const { completedRequired, remainingRequired } = calculateGraduationProgress(
    student,
    sampleData,
  );

  assertEquals(completedRequired, []);
  assert(remainingRequired.includes("MATH101"));
  assert(remainingRequired.includes("CENG101"));
});

Deno.test("calculateGraduationProgress counts a retaken course once it is passed", () => {
  // STU003 failed MATH101, CENG102 and MATH102, then passed each retake
  const { completedRequired, remainingRequired } = calculateGraduationProgress(
    sampleStudent("STU003"),
    sampleData,
  );

  assertEquals(completedRequired, [
    "CENG101",
    "CENG102",
    "CENG201",
    "MATH101",
    "MATH102",
  ]);
  assertEquals(remainingRequired, [
    "CENG202",
    "CENG301",
    "CENG302",
    "CENG401",
    "CENG402",
    "MATH201",
  ]);
});

Deno.test("calculateGraduationProgress never reports negative credits remaining", () => {
  const progress = calculateGraduationProgress(
    makeStudent({ completed_credits: 150 }),
    sampleData,
  );

  assertEquals(progress.creditsRemaining, 0);
  assertEquals(progress.estimatedSemesters, 0);
});

Deno.test("calculateGraduationProgress compares GPA with the department minimum", () => {
  const gpaStatus = (gpa: number) =>
    calculateGraduationProgress(makeStudent({ gpa }), sampleData).gpaStatus;

  assertEquals(gpaStatus(2.0), "meets");
  assertEquals(gpaStatus(1.99), "below");
});

Deno.test("calculateGraduationProgress throws for an unknown department", () => {
  assertThrows(
    () =>
      calculateGraduationProgress(
        makeStudent({ department_id: "NOPE" }),
        sampleData,
      ),
    Error,
    "NOPE",
  );
});

Deno.test("getRecommendedNextCourses offers only courses without prerequisites to a new student", () => {
  assertEquals(recommendedIds(makeStudent(), sampleData), [
    "MATH101",
    "CENG101",
    "MATH202",
  ]);
});

Deno.test("getRecommendedNextCourses offers a failed course but not what it unlocks", () => {
  const recommended = recommendedIds(
    makeStudent({ enrollments: [failedCourse("MATH101")] }),
    sampleData,
  );

  assert(recommended.includes("MATH101"));
  assert(!recommended.includes("MATH102"));
  assert(!recommended.includes("MATH201"));
});

Deno.test("getRecommendedNextCourses won't treat an in-progress course as a passed prerequisite", () => {
  const recommended = recommendedIds(
    makeStudent({ enrollments: [makeEnrollment({ course_id: "MATH101" })] }),
    sampleData,
  );

  assert(!recommended.includes("MATH101"));
  assert(!recommended.includes("MATH102"));
});

Deno.test("getRecommendedNextCourses unlocks a course once prerequisites are passed", () => {
  const recommended = recommendedIds(
    makeStudent({ enrollments: [passedCourse("MATH101")] }),
    sampleData,
  );

  assert(!recommended.includes("MATH101"));
  assert(recommended.includes("MATH102"));
});

Deno.test("getRecommendedNextCourses never offers a course whose prerequisite isn't in the catalogue", () => {
  const dataWithOrphanCourse = {
    ...sampleData,
    courses: [
      ...sampleData.courses,
      {
        ...sampleData.courses[0],
        id: "CENG999",
        code: "CENG 999",
        prerequisites: ["NOPE999"],
      },
    ],
  };

  assert(
    !recommendedIds(makeStudent(), dataWithOrphanCourse, 50).includes(
      "CENG999",
    ),
  );
});

Deno.test("getRecommendedNextCourses puts required courses first and respects the limit", () => {
  const student = makeStudent({
    current_semester: 5,
    enrollments: [passedCourse("CENG101"), passedCourse("CENG102")],
  });

  // CENG201 is required, so it beats electives closer to semester 5
  assertEquals(recommendedIds(student, sampleData, 1), ["CENG201"]);
});

Deno.test("getRecommendedNextCourses includes required math for other departments", () => {
  const recommended = recommendedIds(
    makeStudent({ department_id: "SENG" }),
    sampleData,
  );

  assert(recommended.includes("MATH101")); // Owned by CENG, required by SENG
  assert(!recommended.includes("MATH202")); // Owned by CENG, not required by SENG
});

Deno.test("checkGraduationEligibility accepts a student meeting every requirement", () => {
  const requiredCourses = sampleData.departments[0].graduation_requirements
    .required_courses;
  // 18 elective credits: 3 + 3 + 3 + 3 + 6
  const electives = ["CENG350", "CENG360", "CENG370", "MATH202", "SENG402"];

  const result = checkGraduationEligibility(
    makeStudent({
      gpa: 2.0,
      completed_credits: 140,
      enrollments: [...requiredCourses, ...electives].map((courseId) =>
        passedCourse(courseId)
      ),
    }),
    sampleData,
  );

  assertEquals(result, { eligible: true, missingRequirements: [] });
});

Deno.test("checkGraduationEligibility lists every missing requirement", () => {
  const result = checkGraduationEligibility(
    makeStudent({ gpa: 1.5 }),
    sampleData,
  );

  assertEquals(result.eligible, false);
  assertEquals(result.missingRequirements.length, 4);
});

Deno.test("getGraduationTimeline flags a low GPA as a risk", () => {
  const { onTrack, riskFactors } = getGraduationTimeline(
    makeStudent({ gpa: 1.5, completed_credits: 20 }),
    sampleData,
  );

  assertEquals(riskFactors, ["GPA below graduation requirement"]);
  assertEquals(onTrack, false);
});

Deno.test("getGraduationTimeline flags many required courses late in the degree", () => {
  // 10 credits remaining suggests 1 semester, but all 11 required courses remain
  const { semestersRemaining, riskFactors } = getGraduationTimeline(
    makeStudent({ completed_credits: 130, current_semester: 8 }),
    sampleData,
  );

  assertEquals(semestersRemaining, 1);
  assertEquals(riskFactors, ["Many required courses remaining"]);
});
